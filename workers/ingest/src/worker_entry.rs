use alphaping_crypto::{DirectionalKeys, open, seal, unwrap_key};
use alphaping_protocol::{
    MAX_ENVELOPE_BYTES, PROTOCOL_VERSION, decode_message, decompress_message, encode_message,
    v1::{AckStatus, DurableAck, EncryptedEnvelope, EnvelopeHeader, MachineReport},
};
use prost::Message;
use serde::Deserialize;
use worker::{
    Context, D1Database, Date, Env, Headers, Method, Request, Response, Result as WorkerResult,
    event, js_sys::Uint8Array, wasm_bindgen::JsValue,
};

use crate::{MAX_SAFE_SEQUENCE, MachineRollup, validate_report};

const MAX_CLOCK_SKEW_MS: i64 = 5 * 60_000;

#[derive(Debug, Deserialize)]
struct AgentKeyRow {
    machine_pk: f64,
    workspace_pk: f64,
    applied_config_revision: f64,
    wrapped_data_key: Vec<u8>,
    nonce_prefix: Vec<u8>,
    valid_from: f64,
    valid_until: f64,
}

#[derive(Debug, Deserialize)]
struct ReplayRow {
    highest_sequence: f64,
}

#[derive(Debug, Deserialize)]
struct SlotRow {
    report_id: Option<Vec<u8>>,
    payload_hash: Option<Vec<u8>>,
}

#[derive(Debug, Deserialize)]
struct BlockRow {
    report_0: Option<Vec<u8>>,
    report_1: Option<Vec<u8>>,
    report_2: Option<Vec<u8>>,
    report_3: Option<Vec<u8>>,
}

#[derive(Debug, Deserialize)]
struct StoredRollup {
    sample_count: f64,
    cpu_avg_permille: f64,
    cpu_max_permille: f64,
    memory_avg_bytes: f64,
    storage_max_bytes: f64,
    network_rx_bytes: f64,
    network_tx_bytes: f64,
}

#[derive(Debug)]
enum IngestError {
    BadRequest,
    Unauthorized,
    Conflict,
    Internal(worker::Error),
}

impl From<worker::Error> for IngestError {
    fn from(error: worker::Error) -> Self {
        Self::Internal(error)
    }
}

fn number(value: i64) -> JsValue {
    JsValue::from_f64(value as f64)
}

fn unsigned(value: u64) -> JsValue {
    JsValue::from_f64(value as f64)
}

fn text(value: &str) -> JsValue {
    JsValue::from_str(value)
}

fn blob(value: &[u8]) -> JsValue {
    Uint8Array::from(value).into()
}

fn now_ms() -> i64 {
    i64::try_from(Date::now().as_millis()).unwrap_or(i64::MAX)
}

fn block_start(nominal_minute_ms: i64) -> i64 {
    nominal_minute_ms.div_euclid(300_000) * 300_000
}

fn report_slot(nominal_minute_ms: i64) -> usize {
    ((nominal_minute_ms - block_start(nominal_minute_ms)) / 60_000) as usize
}

fn wrapping_aad(agent_id: &str, key_epoch: u32) -> Vec<u8> {
    let mut aad = Vec::with_capacity(agent_id.len() + 4);
    aad.extend_from_slice(agent_id.as_bytes());
    aad.extend_from_slice(&key_epoch.to_be_bytes());
    aad
}

async fn load_agent_key(
    db: &D1Database,
    agent_id: &str,
    key_epoch: u32,
) -> Result<AgentKeyRow, IngestError> {
    db.prepare(
        "SELECT m.telemetry_pk AS machine_pk, w.telemetry_pk AS workspace_pk,
                a.applied_config_revision, k.wrapped_data_key, k.nonce_prefix,
                k.valid_from, k.valid_until
         FROM agents a
         JOIN machines m ON m.id = a.machine_id
         JOIN workspaces w ON w.id = a.workspace_id
         JOIN agent_keys k ON k.agent_id = a.id
         WHERE a.id = ? AND a.status = 'active' AND k.key_epoch = ?
           AND a.revoked_at IS NULL AND k.revoked_at IS NULL",
    )
    .bind(&[text(agent_id), unsigned(u64::from(key_epoch))])?
    .first::<AgentKeyRow>(None)
    .await?
    .ok_or(IngestError::Unauthorized)
}

async fn check_replay(
    db: &D1Database,
    agent_id: &str,
    key_epoch: u32,
    sequence: u64,
) -> Result<(), IngestError> {
    let replay = db
        .prepare(
            "SELECT highest_sequence FROM agent_replay_state WHERE agent_id = ? AND key_epoch = ?",
        )
        .bind(&[text(agent_id), unsigned(u64::from(key_epoch))])?
        .first::<ReplayRow>(None)
        .await?;
    if replay.is_some_and(|row| sequence <= row.highest_sequence as u64) {
        return Err(IngestError::Unauthorized);
    }
    Ok(())
}

async fn classify_slot(
    db: &D1Database,
    report: &MachineReport,
    payload_hash: &[u8],
) -> Result<bool, IngestError> {
    let slot = report_slot(report.nominal_minute_ms);
    let query = format!(
        "SELECT report_id_{slot} AS report_id, payload_hash_{slot} AS payload_hash
         FROM telemetry_blocks_5m WHERE machine_pk = ? AND block_start = ?"
    );
    let existing = db
        .prepare(query)
        .bind(&[
            unsigned(report.machine_pk),
            number(block_start(report.nominal_minute_ms)),
        ])?
        .first::<SlotRow>(None)
        .await?;
    let Some(existing) = existing else {
        return Ok(false);
    };
    match (existing.report_id, existing.payload_hash) {
        (None, None) => Ok(false),
        (Some(report_id), Some(hash)) if report_id == report.report_id && hash == payload_hash => {
            Ok(true)
        }
        _ => Err(IngestError::Conflict),
    }
}

fn replay_statement(
    db: &D1Database,
    agent_id: &str,
    key_epoch: u32,
    sequence: u64,
    now: i64,
) -> Result<worker::D1PreparedStatement, IngestError> {
    Ok(db
        .prepare(
            "INSERT INTO agent_replay_state
             (agent_id, key_epoch, highest_sequence, window_bitmap, updated_at)
             VALUES (?, ?, ?, X'01', ?)
             ON CONFLICT(agent_id, key_epoch) DO UPDATE SET
               highest_sequence = excluded.highest_sequence,
               window_bitmap = X'01',
               updated_at = excluded.updated_at
             WHERE excluded.highest_sequence > agent_replay_state.highest_sequence",
        )
        .bind(&[
            text(agent_id),
            unsigned(u64::from(key_epoch)),
            unsigned(sequence),
            number(now),
        ])?)
}

fn block_statement(
    db: &D1Database,
    report: &MachineReport,
    payload_hash: &[u8],
    compressed_payload: &[u8],
) -> Result<worker::D1PreparedStatement, IngestError> {
    let slot = report_slot(report.nominal_minute_ms);
    let report_column = format!("report_{slot}");
    let id_column = format!("report_id_{slot}");
    let hash_column = format!("payload_hash_{slot}");
    let query = format!(
        "INSERT INTO telemetry_blocks_5m
          (machine_pk, workspace_pk, block_start, {report_column}, {id_column}, {hash_column}, schema_version, flags)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(machine_pk, block_start) DO UPDATE SET
          {report_column} = excluded.{report_column},
          {id_column} = excluded.{id_column},
          {hash_column} = excluded.{hash_column},
          schema_version = excluded.schema_version
         WHERE telemetry_blocks_5m.{id_column} IS NULL
            OR (telemetry_blocks_5m.{id_column} = excluded.{id_column}
                AND telemetry_blocks_5m.{hash_column} = excluded.{hash_column})"
    );
    Ok(db.prepare(query).bind(&[
        unsigned(report.machine_pk),
        unsigned(report.workspace_pk),
        number(block_start(report.nominal_minute_ms)),
        blob(compressed_payload),
        blob(&report.report_id),
        blob(payload_hash),
        unsigned(u64::from(report.schema_version)),
    ])?)
}

fn latest_statement(
    db: &D1Database,
    agent_id: &str,
    report: &MachineReport,
    now: i64,
) -> Result<worker::D1PreparedStatement, IngestError> {
    let latest = report.samples.last().ok_or(IngestError::BadRequest)?;
    Ok(db
        .prepare(
            "INSERT INTO machine_latest
              (machine_pk, workspace_pk, agent_id, observed_at, received_at, state,
               cpu_permille, memory_used_bytes, memory_total_bytes, storage_used_bytes,
               storage_total_bytes, network_rx_bps, network_tx_bps, network_rx_total,
               network_tx_total, report_id)
             VALUES (?, ?, ?, ?, ?, 'healthy', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(machine_pk) DO UPDATE SET
               workspace_pk = excluded.workspace_pk,
               agent_id = excluded.agent_id,
               observed_at = excluded.observed_at,
               received_at = excluded.received_at,
               state = excluded.state,
               cpu_permille = excluded.cpu_permille,
               memory_used_bytes = excluded.memory_used_bytes,
               memory_total_bytes = excluded.memory_total_bytes,
               storage_used_bytes = excluded.storage_used_bytes,
               storage_total_bytes = excluded.storage_total_bytes,
               network_rx_bps = excluded.network_rx_bps,
               network_tx_bps = excluded.network_tx_bps,
               network_rx_total = excluded.network_rx_total,
               network_tx_total = excluded.network_tx_total,
               report_id = excluded.report_id
             WHERE excluded.observed_at >= machine_latest.observed_at",
        )
        .bind(&[
            unsigned(report.machine_pk),
            unsigned(report.workspace_pk),
            text(agent_id),
            number(latest.observed_at_ms),
            number(now),
            unsigned(u64::from(latest.cpu_permille)),
            unsigned(latest.memory_used_bytes),
            unsigned(latest.memory_total_bytes),
            unsigned(latest.storage_used_bytes),
            unsigned(latest.storage_total_bytes),
            unsigned(latest.network_rx_bytes_per_second),
            unsigned(latest.network_tx_bytes_per_second),
            unsigned(latest.network_rx_bytes_total),
            unsigned(latest.network_tx_bytes_total),
            blob(&report.report_id),
        ])?)
}

fn rollup_statement(
    db: &D1Database,
    table: &str,
    report: &MachineReport,
    bucket_start: i64,
    rollup: &MachineRollup,
) -> Result<worker::D1PreparedStatement, IngestError> {
    let query = format!(
        "INSERT INTO {table}
          (machine_pk, workspace_pk, bucket_start, sample_count, cpu_avg_permille,
           cpu_max_permille, memory_avg_bytes, storage_max_bytes, network_rx_bytes, network_tx_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(machine_pk, bucket_start) DO UPDATE SET
           sample_count = excluded.sample_count,
           cpu_avg_permille = excluded.cpu_avg_permille,
           cpu_max_permille = excluded.cpu_max_permille,
           memory_avg_bytes = excluded.memory_avg_bytes,
           storage_max_bytes = excluded.storage_max_bytes,
           network_rx_bytes = excluded.network_rx_bytes,
           network_tx_bytes = excluded.network_tx_bytes"
    );
    Ok(db.prepare(query).bind(&[
        unsigned(report.machine_pk),
        unsigned(report.workspace_pk),
        number(bucket_start),
        unsigned(rollup.sample_count),
        unsigned(rollup.cpu_average_permille()),
        unsigned(u64::from(rollup.cpu_max_permille)),
        unsigned(rollup.memory_average_bytes()),
        unsigned(rollup.storage_max_bytes),
        unsigned(rollup.network_rx_bytes),
        unsigned(rollup.network_tx_bytes),
    ])?)
}

async fn closed_rollups(
    db: &D1Database,
    report: &MachineReport,
) -> Result<Vec<worker::D1PreparedStatement>, IngestError> {
    if report_slot(report.nominal_minute_ms) != 4 {
        return Ok(Vec::new());
    }
    let five_start = block_start(report.nominal_minute_ms);
    let block = db
        .prepare(
            "SELECT report_0, report_1, report_2, report_3 FROM telemetry_blocks_5m
             WHERE machine_pk = ? AND block_start = ?",
        )
        .bind(&[unsigned(report.machine_pk), number(five_start)])?
        .first::<BlockRow>(None)
        .await?;
    let mut five = MachineRollup::default();
    if let Some(block) = block {
        for payload in [
            block.report_0,
            block.report_1,
            block.report_2,
            block.report_3,
        ]
        .into_iter()
        .flatten()
        {
            let stored: MachineReport =
                decompress_message(&payload).map_err(|_| IngestError::BadRequest)?;
            five.add_report(&stored);
        }
    }
    five.add_report(report);
    let mut statements = vec![rollup_statement(
        db,
        "machine_rollups_5m",
        report,
        five_start,
        &five,
    )?];

    let minute_in_hour = report.nominal_minute_ms.rem_euclid(3_600_000) / 60_000;
    if minute_in_hour != 59 {
        return Ok(statements);
    }
    let hour_start = report.nominal_minute_ms.div_euclid(3_600_000) * 3_600_000;
    let previous = db
        .prepare(
            "SELECT sample_count, cpu_avg_permille, cpu_max_permille, memory_avg_bytes,
                    storage_max_bytes, network_rx_bytes, network_tx_bytes
             FROM machine_rollups_5m
             WHERE machine_pk = ? AND bucket_start >= ? AND bucket_start < ?
             ORDER BY bucket_start",
        )
        .bind(&[
            unsigned(report.machine_pk),
            number(hour_start),
            number(five_start),
        ])?
        .all()
        .await?
        .results::<StoredRollup>()?;
    let mut hour = MachineRollup::default();
    for stored in previous {
        let count = stored.sample_count as u64;
        hour.sample_count = hour.sample_count.saturating_add(count);
        hour.cpu_total_permille = hour
            .cpu_total_permille
            .saturating_add((stored.cpu_avg_permille as u64).saturating_mul(count));
        hour.cpu_max_permille = hour.cpu_max_permille.max(stored.cpu_max_permille as u32);
        hour.memory_total_bytes = hour
            .memory_total_bytes
            .saturating_add((stored.memory_avg_bytes as u64).saturating_mul(count));
        hour.storage_max_bytes = hour.storage_max_bytes.max(stored.storage_max_bytes as u64);
        hour.network_rx_bytes = hour
            .network_rx_bytes
            .saturating_add(stored.network_rx_bytes as u64);
        hour.network_tx_bytes = hour
            .network_tx_bytes
            .saturating_add(stored.network_tx_bytes as u64);
    }
    hour.sample_count = hour.sample_count.saturating_add(five.sample_count);
    hour.cpu_total_permille = hour
        .cpu_total_permille
        .saturating_add(five.cpu_total_permille);
    hour.cpu_max_permille = hour.cpu_max_permille.max(five.cpu_max_permille);
    hour.memory_total_bytes = hour
        .memory_total_bytes
        .saturating_add(five.memory_total_bytes);
    hour.storage_max_bytes = hour.storage_max_bytes.max(five.storage_max_bytes);
    hour.network_rx_bytes = hour.network_rx_bytes.saturating_add(five.network_rx_bytes);
    hour.network_tx_bytes = hour.network_tx_bytes.saturating_add(five.network_tx_bytes);
    statements.push(rollup_statement(
        db,
        "machine_rollups_1h",
        report,
        hour_start,
        &hour,
    )?);
    Ok(statements)
}

async fn durable_ack(
    telemetry_db: &D1Database,
    header: &EnvelopeHeader,
    report: &MachineReport,
    agent_id: &str,
    agent_key: &AgentKeyRow,
    keys: &DirectionalKeys,
    nonce_prefix: [u8; 4],
    compressed_payload: &[u8],
    duplicate: bool,
) -> Result<Response, IngestError> {
    let now = now_ms();
    let mut statements = vec![replay_statement(
        telemetry_db,
        agent_id,
        header.key_epoch,
        header.sequence,
        now,
    )?];
    if !duplicate {
        let hash = blake3::hash(compressed_payload);
        statements.push(block_statement(
            telemetry_db,
            report,
            hash.as_bytes(),
            compressed_payload,
        )?);
        statements.push(latest_statement(telemetry_db, agent_id, report, now)?);
        statements.extend(closed_rollups(telemetry_db, report).await?);
    }
    telemetry_db.batch(statements).await?;
    let acknowledgement = DurableAck {
        report_id: report.report_id.clone(),
        status: if duplicate {
            AckStatus::Duplicate as i32
        } else {
            AckStatus::Committed as i32
        },
        committed_at_ms: now,
        config_revision: agent_key.applied_config_revision as u64,
    };
    let response_header = EnvelopeHeader {
        protocol_version: PROTOCOL_VERSION,
        agent_id: header.agent_id.clone(),
        key_epoch: header.key_epoch,
        sequence: header.sequence,
        sent_at_ms: now,
        report_id: report.report_id.clone(),
    };
    let aad = encode_message(&response_header);
    let ciphertext = seal(
        &keys.server_to_client,
        nonce_prefix,
        header.sequence,
        &aad,
        &encode_message(&acknowledgement),
    )
    .map_err(|_| IngestError::Unauthorized)?;
    let body = EncryptedEnvelope {
        header: Some(response_header),
        ciphertext,
    }
    .encode_to_vec();
    let headers = Headers::new();
    headers.set("content-type", "application/x-protobuf")?;
    headers.set("cache-control", "no-store")?;
    Ok(Response::from_bytes(body)?.with_headers(headers))
}

async fn handle_report(mut request: Request, env: Env) -> Result<Response, IngestError> {
    if request.method() != Method::Post {
        return Err(IngestError::BadRequest);
    }
    if request
        .headers()
        .get("content-length")?
        .and_then(|value| value.parse::<usize>().ok())
        .is_some_and(|length| length > MAX_ENVELOPE_BYTES)
    {
        return Err(IngestError::BadRequest);
    }
    let body = request.bytes().await?;
    if body.len() > MAX_ENVELOPE_BYTES {
        return Err(IngestError::BadRequest);
    }
    let envelope: EncryptedEnvelope = decode_message(&body).map_err(|_| IngestError::BadRequest)?;
    let header = envelope.header.ok_or(IngestError::BadRequest)?;
    if header.protocol_version != PROTOCOL_VERSION
        || header.sequence == 0
        || header.sequence > MAX_SAFE_SEQUENCE
        || (now_ms() - header.sent_at_ms).abs() > MAX_CLOCK_SKEW_MS
    {
        return Err(IngestError::Unauthorized);
    }
    let agent_id = std::str::from_utf8(&header.agent_id).map_err(|_| IngestError::Unauthorized)?;
    let control_db = env.d1("CONTROL_DB")?;
    let telemetry_db = env.d1("TELEMETRY_DB")?;
    let agent_key = load_agent_key(&control_db, agent_id, header.key_epoch).await?;
    let now = now_ms();
    if now < agent_key.valid_from as i64 || now > agent_key.valid_until as i64 {
        return Err(IngestError::Unauthorized);
    }
    check_replay(&telemetry_db, agent_id, header.key_epoch, header.sequence).await?;
    if agent_key.wrapped_data_key.len() < 13 || agent_key.nonce_prefix.len() != 4 {
        return Err(IngestError::Unauthorized);
    }
    let wrapping_key: [u8; 32] = hex::decode(env.secret("KEY_WRAPPING_SECRET")?.to_string())
        .map_err(|_| IngestError::Unauthorized)?
        .try_into()
        .map_err(|_| IngestError::Unauthorized)?;
    let wrapping_nonce: [u8; 12] = agent_key.wrapped_data_key[..12]
        .try_into()
        .map_err(|_| IngestError::Unauthorized)?;
    let root_key = unwrap_key(
        &wrapping_key,
        wrapping_nonce,
        &agent_key.wrapped_data_key[12..],
        &wrapping_aad(agent_id, header.key_epoch),
    )
    .map_err(|_| IngestError::Unauthorized)?;
    let nonce_prefix: [u8; 4] = agent_key
        .nonce_prefix
        .as_slice()
        .try_into()
        .map_err(|_| IngestError::Unauthorized)?;
    let keys = DirectionalKeys::derive(&root_key, &header.agent_id, header.key_epoch)
        .map_err(|_| IngestError::Unauthorized)?;
    let aad = encode_message(&header);
    let compressed_payload = open(
        &keys.client_to_server,
        nonce_prefix,
        header.sequence,
        &aad,
        &envelope.ciphertext,
    )
    .map_err(|_| IngestError::Unauthorized)?;
    let report: MachineReport =
        decompress_message(&compressed_payload).map_err(|_| IngestError::BadRequest)?;
    validate_report(
        &report,
        &header.report_id,
        agent_key.machine_pk as u64,
        agent_key.workspace_pk as u64,
        now,
    )
    .map_err(|_| IngestError::BadRequest)?;
    let payload_hash = blake3::hash(&compressed_payload);
    let duplicate = classify_slot(&telemetry_db, &report, payload_hash.as_bytes()).await?;
    durable_ack(
        &telemetry_db,
        &header,
        &report,
        agent_id,
        &agent_key,
        &keys,
        nonce_prefix,
        &compressed_payload,
        duplicate,
    )
    .await
}

fn error_response(error: IngestError) -> WorkerResult<Response> {
    match error {
        IngestError::BadRequest => Response::error("Bad request", 400),
        IngestError::Unauthorized => Response::error("Not found", 404),
        IngestError::Conflict => Response::error("Conflict", 409),
        IngestError::Internal(error) => Err(error),
    }
}

#[event(fetch)]
pub async fn main(request: Request, env: Env, _context: Context) -> WorkerResult<Response> {
    let path = request.path();
    if path != "/v1/reports" {
        return Response::error("Not found", 404);
    }
    match handle_report(request, env).await {
        Ok(response) => Ok(response),
        Err(error) => error_response(error),
    }
}
