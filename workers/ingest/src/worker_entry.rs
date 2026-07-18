use alphaping_crypto::{DirectionalKeys, open, seal, unwrap_key, wrap_key};
use alphaping_protocol::{
    MAX_ENVELOPE_BYTES, PROTOCOL_VERSION, decode_message, decompress_message, encode_message,
    v1::{
        AckStatus, AgentCommand, AgentConfigSnapshot, DurableAck, EncryptedEnvelope,
        EnrollmentRequest, EnrollmentResponse, EnvelopeHeader, KeyRotationProposal, MachineReport,
    },
};
use prost::Message;
use serde::Deserialize;
use worker::{
    Context, D1Database, Date, Env, Headers, Method, Request, Response, Result as WorkerResult,
    event, js_sys::Uint8Array, wasm_bindgen::JsValue,
};

use crate::{
    MAX_SAFE_SEQUENCE, MachineHealthState, MachineRollup,
    agent_commands::{load_commands, persist_command_results},
    agent_config::build_config_snapshot,
    check_results::{ProbePersistenceError, persist_probe_results},
    enrollment_token_digest, is_protobuf_content_type,
    live_session::issue_live_session,
    machine_health_state, validate_enrollment_request, validate_report,
};

const MAX_CLOCK_SKEW_MS: i64 = 5 * 60_000;
const KEY_ROTATION_INTERVAL_MS: i64 = 30 * 24 * 60 * 60_000;
const KEY_VALIDITY_MS: i64 = 90 * 24 * 60 * 60_000;
const KEY_OVERLAP_MS: i64 = 24 * 60 * 60_000;

#[derive(Debug, Deserialize)]
struct AgentKeyRow {
    machine_id: String,
    workspace_id: String,
    machine_pk: f64,
    workspace_pk: f64,
    applied_config_revision: f64,
    desired_config_revision: f64,
    maintenance_until: Option<f64>,
    wrapped_data_key: Vec<u8>,
    nonce_prefix: Vec<u8>,
    valid_from: f64,
    valid_until: f64,
    container_catalog_digest: Option<Vec<u8>>,
}

#[derive(Debug, Deserialize)]
struct RotationKeyRow {
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
struct LatestContainerRow {
    container_inventory_json: Option<String>,
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

#[derive(Debug, Deserialize)]
struct EnrollmentTokenRow {
    id: String,
    machine_pk: f64,
    workspace_pk: f64,
    sample_interval_seconds: f64,
    report_interval_seconds: f64,
    config_revision: f64,
    container_monitoring_enabled: f64,
}

#[derive(Debug)]
enum IngestError {
    BadRequest,
    UnsupportedMediaType,
    Unauthorized,
    Conflict,
    Internal(worker::Error),
}

impl From<worker::Error> for IngestError {
    fn from(error: worker::Error) -> Self {
        Self::Internal(error)
    }
}

impl From<ProbePersistenceError> for IngestError {
    fn from(error: ProbePersistenceError) -> Self {
        match error {
            ProbePersistenceError::Invalid => Self::BadRequest,
            ProbePersistenceError::Conflict => Self::Conflict,
            ProbePersistenceError::Worker(error) => Self::Internal(error),
        }
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

fn optional_text(value: Option<&str>) -> JsValue {
    value.map_or(JsValue::NULL, JsValue::from_str)
}

fn container_inventory_json(
    report: &MachineReport,
    previous_json: Option<&str>,
) -> Result<Option<String>, IngestError> {
    let Some(inventory) = &report.container_inventory else {
        return Ok(None);
    };
    let catalog = inventory
        .catalog
        .iter()
        .map(|entry| (hex::encode(&entry.container_key), entry))
        .collect::<std::collections::HashMap<_, _>>();
    let previous = previous_json
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .and_then(|value| {
            value
                .get("containers")
                .and_then(|containers| containers.as_array())
                .cloned()
        })
        .unwrap_or_default()
        .into_iter()
        .filter_map(|container| {
            let id = container.get("id")?.as_str()?.to_owned();
            Some((id, container))
        })
        .collect::<std::collections::HashMap<_, _>>();
    let containers = inventory
        .metrics
        .iter()
        .filter_map(|metric| {
            let id = hex::encode(&metric.container_key);
            let (runtime, runtime_instance, name, image) = if let Some(entry) = catalog.get(&id) {
                (
                    runtime_kind(entry.runtime),
                    entry.runtime_instance.as_str(),
                    entry.name.as_str(),
                    entry.image.as_str(),
                )
            } else {
                let entry = previous.get(&id)?;
                (
                    entry.get("runtime")?.as_str()?,
                    entry.get("runtimeInstance")?.as_str()?,
                    entry.get("name")?.as_str()?,
                    entry.get("image")?.as_str()?,
                )
            };
            Some(serde_json::json!({
                "id": id,
                "runtime": runtime,
                "runtimeInstance": runtime_instance,
                "name": name,
                "image": image,
                "state": container_state(metric.state),
                "health": container_health(metric.health),
                "startedAt": metric.started_at_ms,
                "restartCount": metric.restart_count,
                "cpuPermille": metric.cpu_permille,
                "memoryUsedBytes": metric.memory_used_bytes,
                "memoryLimitBytes": metric.memory_limit_bytes,
                "networkRxBps": metric.network_rx_bytes_per_second,
                "networkTxBps": metric.network_tx_bytes_per_second,
                "ports": metric.ports.iter().map(|port| serde_json::json!({
                    "privatePort": port.private_port,
                    "publicPort": port.public_port,
                    "protocol": port.protocol,
                })).collect::<Vec<_>>(),
            }))
        })
        .collect::<Vec<_>>();
    let runtimes = inventory
        .runtimes
        .iter()
        .map(|runtime| {
            serde_json::json!({
                "kind": runtime_kind(runtime.kind),
                "instance": runtime.instance,
                "availability": runtime_availability(runtime.availability),
                "version": runtime.version,
                "detailCode": runtime.detail_code,
            })
        })
        .collect::<Vec<_>>();
    serde_json::to_string(&serde_json::json!({
        "observedAt": inventory.observed_at_ms,
        "catalogDigest": hex::encode(&inventory.catalog_digest),
        "runtimes": runtimes,
        "containers": containers,
    }))
    .map(Some)
    .map_err(|_| IngestError::BadRequest)
}

fn runtime_kind(value: i32) -> &'static str {
    match value {
        1 => "docker",
        2 => "colima-docker",
        3 => "colima-containerd",
        4 => "apple-container",
        _ => "unknown",
    }
}

fn runtime_availability(value: i32) -> &'static str {
    match value {
        1 => "available",
        2 => "absent",
        3 => "stopped",
        4 => "permission-denied",
        5 => "incompatible",
        6 => "error",
        _ => "unknown",
    }
}

fn container_state(value: i32) -> &'static str {
    match value {
        1 => "created",
        2 => "running",
        3 => "paused",
        4 => "restarting",
        5 => "exited",
        6 => "dead",
        _ => "unknown",
    }
}

fn container_health(value: i32) -> &'static str {
    match value {
        1 => "none",
        2 => "starting",
        3 => "healthy",
        4 => "unhealthy",
        _ => "unknown",
    }
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

fn random_bytes<const N: usize>() -> Result<[u8; N], IngestError> {
    let mut bytes = [0_u8; N];
    getrandom_02::getrandom(&mut bytes).map_err(|_| IngestError::Unauthorized)?;
    Ok(bytes)
}

fn random_uuid() -> Result<String, IngestError> {
    let mut bytes = random_bytes::<16>()?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let value = hex::encode(bytes);
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &value[0..8],
        &value[8..12],
        &value[12..16],
        &value[16..20],
        &value[20..32]
    ))
}

fn key_wrapping_secret(env: &Env) -> Result<[u8; 32], IngestError> {
    hex::decode(env.secret("KEY_WRAPPING_SECRET")?.to_string())
        .map_err(|_| IngestError::Unauthorized)?
        .try_into()
        .map_err(|_| IngestError::Unauthorized)
}

fn enrollment_token_pepper(env: &Env) -> Result<[u8; 32], IngestError> {
    hex::decode(env.secret("ENROLLMENT_TOKEN_PEPPER")?.to_string())
        .map_err(|_| IngestError::Unauthorized)?
        .try_into()
        .map_err(|_| IngestError::Unauthorized)
}

async fn load_rotation_key(
    db: &D1Database,
    agent_id: &str,
    key_epoch: u32,
) -> Result<Option<RotationKeyRow>, IngestError> {
    Ok(db
        .prepare(
            "SELECT wrapped_data_key, nonce_prefix, valid_from, valid_until
             FROM agent_keys
             WHERE agent_id = ? AND key_epoch = ? AND revoked_at IS NULL",
        )
        .bind(&[text(agent_id), unsigned(u64::from(key_epoch))])?
        .first::<RotationKeyRow>(None)
        .await?)
}

async fn key_rotation_proposal(
    db: &D1Database,
    agent_id: &str,
    current_epoch: u32,
    current_valid_from: i64,
    now: i64,
    wrapping_key: &[u8; 32],
) -> Result<Option<KeyRotationProposal>, IngestError> {
    if now.saturating_sub(current_valid_from) < KEY_ROTATION_INTERVAL_MS {
        return Ok(None);
    }
    let next_epoch = current_epoch
        .checked_add(1)
        .ok_or(IngestError::Unauthorized)?;
    let row = match load_rotation_key(db, agent_id, next_epoch).await? {
        Some(row) => row,
        None => {
            let data_key = random_bytes::<32>()?;
            let nonce_prefix = random_bytes::<4>()?;
            let wrapping_nonce = random_bytes::<12>()?;
            let wrapped = wrap_key(
                wrapping_key,
                wrapping_nonce,
                &data_key,
                &wrapping_aad(agent_id, next_epoch),
            )
            .map_err(|_| IngestError::Unauthorized)?;
            let mut wrapped_data_key = Vec::with_capacity(12 + wrapped.len());
            wrapped_data_key.extend_from_slice(&wrapping_nonce);
            wrapped_data_key.extend_from_slice(&wrapped);
            db.prepare(
                "INSERT INTO agent_keys
                  (agent_id, key_epoch, wrapped_data_key, wrapping_key_id, nonce_prefix,
                   valid_from, valid_until)
                 VALUES (?, ?, ?, 'primary', ?, ?, ?)
                 ON CONFLICT(agent_id, key_epoch) DO NOTHING",
            )
            .bind(&[
                text(agent_id),
                unsigned(u64::from(next_epoch)),
                blob(&wrapped_data_key),
                blob(&nonce_prefix),
                number(now),
                number(now.saturating_add(KEY_VALIDITY_MS)),
            ])?
            .run()
            .await?;
            load_rotation_key(db, agent_id, next_epoch)
                .await?
                .ok_or(IngestError::Unauthorized)?
        }
    };
    if row.wrapped_data_key.len() < 13 || row.nonce_prefix.len() != 4 {
        return Err(IngestError::Unauthorized);
    }
    let wrapping_nonce = row.wrapped_data_key[..12]
        .try_into()
        .map_err(|_| IngestError::Unauthorized)?;
    let data_key = unwrap_key(
        wrapping_key,
        wrapping_nonce,
        &row.wrapped_data_key[12..],
        &wrapping_aad(agent_id, next_epoch),
    )
    .map_err(|_| IngestError::Unauthorized)?;
    Ok(Some(KeyRotationProposal {
        key_epoch: next_epoch,
        data_key: data_key.to_vec(),
        nonce_prefix: row.nonce_prefix,
        valid_from_ms: row.valid_from as i64,
        valid_until_ms: row.valid_until as i64,
    }))
}

async fn limit_previous_key_overlap(
    db: &D1Database,
    agent_id: &str,
    current_epoch: u32,
    now: i64,
) -> Result<(), IngestError> {
    let Some(previous_epoch) = current_epoch.checked_sub(1).filter(|epoch| *epoch > 0) else {
        return Ok(());
    };
    let overlap_until = now.saturating_add(KEY_OVERLAP_MS);
    db.prepare(
        "UPDATE agent_keys SET valid_until = ?
         WHERE agent_id = ? AND key_epoch = ? AND revoked_at IS NULL AND valid_until > ?",
    )
    .bind(&[
        number(overlap_until),
        text(agent_id),
        unsigned(u64::from(previous_epoch)),
        number(overlap_until),
    ])?
    .run()
    .await?;
    Ok(())
}

async fn handle_enrollment(mut request: Request, env: Env) -> Result<Response, IngestError> {
    if request.method() != Method::Post {
        return Err(IngestError::BadRequest);
    }
    if !is_protobuf_content_type(request.headers().get("content-type")?.as_deref()) {
        return Err(IngestError::UnsupportedMediaType);
    }
    if request
        .headers()
        .get("content-length")?
        .and_then(|value| value.parse::<usize>().ok())
        .is_some_and(|length| length > 16_384)
    {
        return Err(IngestError::BadRequest);
    }
    let body = request.bytes().await?;
    if body.len() > 16_384 {
        return Err(IngestError::BadRequest);
    }
    let enrollment: EnrollmentRequest =
        decode_message(&body).map_err(|_| IngestError::BadRequest)?;
    validate_enrollment_request(&enrollment).map_err(|_| IngestError::Unauthorized)?;
    let digest = enrollment_token_digest(&enrollment_token_pepper(&env)?, &enrollment.token)
        .map_err(|_| IngestError::Unauthorized)?;
    let now = now_ms();
    let control_db = env.d1("CONTROL_DB")?;
    let token = control_db
        .prepare(
            "SELECT t.id, m.telemetry_pk AS machine_pk, w.telemetry_pk AS workspace_pk,
                    m.sampling_interval_seconds AS sample_interval_seconds,
                    m.report_interval_seconds AS report_interval_seconds,
                    m.desired_config_revision AS config_revision,
                    m.container_monitoring_enabled
             FROM agent_enrollment_tokens t
             JOIN machines m ON m.id = t.machine_id
             JOIN workspaces w ON w.id = t.workspace_id
             WHERE t.token_digest = ? AND t.used_at IS NULL AND t.revoked_at IS NULL
               AND t.expires_at >= ? AND m.id = ?
               AND m.deleted_at IS NULL AND w.deleted_at IS NULL",
        )
        .bind(&[
            blob(&digest),
            number(now),
            text(&enrollment.machine_claim_id),
        ])?
        .first::<EnrollmentTokenRow>(None)
        .await?
        .ok_or(IngestError::Unauthorized)?;
    let agent_id = random_uuid()?;
    let key_epoch = 1_u32;
    let data_key = random_bytes::<32>()?;
    let nonce_prefix = random_bytes::<4>()?;
    let wrapping_nonce = random_bytes::<12>()?;
    let wrapped = wrap_key(
        &key_wrapping_secret(&env)?,
        wrapping_nonce,
        &data_key,
        &wrapping_aad(&agent_id, key_epoch),
    )
    .map_err(|_| IngestError::Unauthorized)?;
    let mut wrapped_data_key = Vec::with_capacity(12 + wrapped.len());
    wrapped_data_key.extend_from_slice(&wrapping_nonce);
    wrapped_data_key.extend_from_slice(&wrapped);
    let valid_until = now.saturating_add(KEY_VALIDITY_MS);
    let results = control_db
        .batch(vec![
            control_db
                .prepare(
                    "UPDATE agent_enrollment_tokens SET used_at = ?, used_by_agent_id = ?
                     WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at >= ?",
                )
                .bind(&[number(now), text(&agent_id), text(&token.id), number(now)])?,
            control_db
                .prepare(
                    "INSERT INTO agents
                      (id, workspace_id, machine_id, identity_public_key, platform, arch,
                       agent_version, protocol_version, hostname, os_name, os_version,
                       kernel_version, status, applied_config_revision, created_at)
                     SELECT ?, t.workspace_id, t.machine_id, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                            'active', ?, ?
                     FROM agent_enrollment_tokens t
                     WHERE t.id = ? AND t.used_by_agent_id = ?",
                )
                .bind(&[
                    text(&agent_id),
                    blob(&enrollment.identity_public_key),
                    text(&enrollment.platform),
                    text(&enrollment.arch),
                    text(&enrollment.agent_version),
                    unsigned(u64::from(enrollment.protocol_version)),
                    text(&enrollment.hostname),
                    text(&enrollment.os_name),
                    text(&enrollment.os_version),
                    text(&enrollment.kernel_version),
                    unsigned(token.config_revision as u64),
                    number(now),
                    text(&token.id),
                    text(&agent_id),
                ])?,
            control_db
                .prepare(
                    "INSERT INTO agent_keys
                      (agent_id, key_epoch, wrapped_data_key, wrapping_key_id, nonce_prefix,
                       valid_from, valid_until)
                     SELECT ?, ?, ?, 'primary', ?, ?, ?
                     WHERE EXISTS (SELECT 1 FROM agents WHERE id = ?)",
                )
                .bind(&[
                    text(&agent_id),
                    unsigned(u64::from(key_epoch)),
                    blob(&wrapped_data_key),
                    blob(&nonce_prefix),
                    number(now),
                    number(valid_until),
                    text(&agent_id),
                ])?,
        ])
        .await?;
    if results
        .first()
        .and_then(|result| result.meta().ok().flatten())
        .and_then(|meta| meta.changes)
        != Some(1)
    {
        return Err(IngestError::Unauthorized);
    }
    let response = EnrollmentResponse {
        agent_id,
        machine_pk: token.machine_pk as u64,
        workspace_pk: token.workspace_pk as u64,
        key_epoch,
        data_key: data_key.to_vec(),
        nonce_prefix: nonce_prefix.to_vec(),
        config_revision: token.config_revision as u64,
        sample_interval_seconds: token.sample_interval_seconds as u32,
        report_interval_seconds: token.report_interval_seconds as u32,
        server_time_ms: u64::try_from(now).map_err(|_| IngestError::Unauthorized)?,
        max_clock_skew_ms: MAX_CLOCK_SKEW_MS as u32,
        max_envelope_bytes: MAX_ENVELOPE_BYTES as u32,
        initial_client_sequence: 1,
        initial_server_sequence: 1,
        machine_claim_id: enrollment.machine_claim_id,
        container_monitoring_enabled: token.container_monitoring_enabled != 0.0,
    };
    let headers = Headers::new();
    headers.set("content-type", "application/x-protobuf")?;
    headers.set("cache-control", "no-store")?;
    Ok(Response::from_bytes(response.encode_to_vec())?.with_headers(headers))
}

async fn load_agent_key(
    db: &D1Database,
    agent_id: &str,
    key_epoch: u32,
) -> Result<AgentKeyRow, IngestError> {
    db.prepare(
        "SELECT m.id AS machine_id, w.id AS workspace_id,
                m.telemetry_pk AS machine_pk, w.telemetry_pk AS workspace_pk,
                a.applied_config_revision, m.desired_config_revision,
                m.maintenance_until,
                k.wrapped_data_key, k.nonce_prefix,
                k.valid_from, k.valid_until, m.container_catalog_digest
         FROM agents a
         JOIN machines m ON m.id = a.machine_id
         JOIN workspaces w ON w.id = a.workspace_id
         JOIN agent_keys k ON k.agent_id = a.id
         WHERE a.id = ? AND a.status = 'active' AND k.key_epoch = ?
           AND a.revoked_at IS NULL AND k.revoked_at IS NULL
           AND m.deleted_at IS NULL AND w.deleted_at IS NULL",
    )
    .bind(&[text(agent_id), unsigned(u64::from(key_epoch))])?
    .first::<AgentKeyRow>(None)
    .await?
    .ok_or(IngestError::Unauthorized)
}

async fn sync_container_catalog(
    db: &D1Database,
    agent: &AgentKeyRow,
    inventory: &alphaping_protocol::v1::ContainerInventory,
    now: i64,
) -> Result<(), IngestError> {
    if !inventory.catalog_included
        || agent.container_catalog_digest.as_deref() == Some(&inventory.catalog_digest)
    {
        return Ok(());
    }
    let mut statements = Vec::with_capacity(inventory.catalog.len() + 2);
    statements.push(
        db.prepare(
            "UPDATE containers SET deleted_at = ?, last_seen_at = ?
             WHERE machine_id = ? AND deleted_at IS NULL",
        )
        .bind(&[number(now), number(now), text(&agent.machine_id)])?,
    );
    for entry in &inventory.catalog {
        let container_id = hex::encode(&entry.container_key);
        statements.push(
            db.prepare(
                "INSERT INTO containers
                  (id, workspace_id, machine_id, runtime, runtime_instance,
                   runtime_container_id, name, image, first_seen_at, last_seen_at, deleted_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                 ON CONFLICT(id) DO UPDATE SET
                   runtime = excluded.runtime,
                   runtime_instance = excluded.runtime_instance,
                   runtime_container_id = excluded.runtime_container_id,
                   name = excluded.name,
                   image = excluded.image,
                   last_seen_at = excluded.last_seen_at,
                   deleted_at = NULL",
            )
            .bind(&[
                text(&container_id),
                text(&agent.workspace_id),
                text(&agent.machine_id),
                text(runtime_kind(entry.runtime)),
                text(&entry.runtime_instance),
                text(&entry.runtime_container_id),
                text(&entry.name),
                text(&entry.image),
                number(now),
                number(now),
            ])?,
        );
    }
    statements.push(
        db.prepare("UPDATE machines SET container_catalog_digest = ?, updated_at = ? WHERE id = ?")
            .bind(&[
                blob(&inventory.catalog_digest),
                number(now),
                text(&agent.machine_id),
            ])?,
    );
    db.batch(statements).await?;
    Ok(())
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
    payload_hash: &[u8],
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
    state: MachineHealthState,
    now: i64,
    previous_container_inventory: Option<&str>,
) -> Result<worker::D1PreparedStatement, IngestError> {
    let latest = report.samples.last().ok_or(IngestError::BadRequest)?;
    let container_inventory = container_inventory_json(report, previous_container_inventory)?;
    Ok(db
        .prepare(
            "INSERT INTO machine_latest
              (machine_pk, workspace_pk, agent_id, observed_at, received_at, state,
               cpu_permille, memory_used_bytes, memory_total_bytes, storage_used_bytes,
               storage_total_bytes, network_rx_bps, network_tx_bps, network_rx_total,
               network_tx_total, load_1m_milli, uptime_seconds, report_id,
               container_inventory_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
               load_1m_milli = excluded.load_1m_milli,
               uptime_seconds = excluded.uptime_seconds,
               report_id = excluded.report_id,
               container_inventory_json = COALESCE(
                 excluded.container_inventory_json, machine_latest.container_inventory_json
               )
             WHERE excluded.observed_at >= machine_latest.observed_at",
        )
        .bind(&[
            unsigned(report.machine_pk),
            unsigned(report.workspace_pk),
            text(agent_id),
            number(latest.observed_at_ms),
            number(now),
            text(state.as_str()),
            unsigned(u64::from(latest.cpu_permille)),
            unsigned(latest.memory_used_bytes),
            unsigned(latest.memory_total_bytes),
            unsigned(latest.storage_used_bytes),
            unsigned(latest.storage_total_bytes),
            unsigned(latest.network_rx_bytes_per_second),
            unsigned(latest.network_tx_bytes_per_second),
            unsigned(latest.network_rx_bytes_total),
            unsigned(latest.network_tx_bytes_total),
            latest
                .load_1m_milli
                .map_or(JsValue::NULL, |value| unsigned(u64::from(value))),
            latest.uptime_seconds.map_or(JsValue::NULL, unsigned),
            blob(&report.report_id),
            optional_text(container_inventory.as_deref()),
        ])?)
}

fn state_transition_statement(
    db: &D1Database,
    report: &MachineReport,
    state: MachineHealthState,
    now: i64,
) -> Result<worker::D1PreparedStatement, IngestError> {
    let latest = report.samples.last().ok_or(IngestError::BadRequest)?;
    let reason = match state {
        MachineHealthState::Healthy => "resource_recovered",
        MachineHealthState::Degraded | MachineHealthState::Down => "resource_threshold",
        MachineHealthState::Maintenance => "maintenance_window",
    };
    Ok(db
        .prepare(
            "INSERT OR IGNORE INTO state_events
              (workspace_pk, resource_type, resource_pk, occurred_at, event_id,
               previous_state, current_state, reason_code)
             SELECT workspace_pk, 1, machine_pk, ?, ?, state, ?,
                    CASE WHEN state = 'offline' THEN 'agent_report_received' ELSE ? END
             FROM machine_latest
             WHERE machine_pk = ? AND state != ? AND observed_at <= ?",
        )
        .bind(&[
            number(now),
            blob(&report.report_id),
            text(state.as_str()),
            text(reason),
            unsigned(report.machine_pk),
            text(state.as_str()),
            number(latest.observed_at_ms),
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
    control_db: &D1Database,
    telemetry_db: &D1Database,
    header: &EnvelopeHeader,
    report: &MachineReport,
    agent_id: &str,
    agent_key: &AgentKeyRow,
    keys: &DirectionalKeys,
    nonce_prefix: [u8; 4],
    compressed_payload: &[u8],
    duplicate: bool,
    config: Option<AgentConfigSnapshot>,
    commands: Vec<AgentCommand>,
    live_session: Option<alphaping_protocol::v1::LiveSessionCredential>,
    wrapping_key: &[u8; 32],
) -> Result<Response, IngestError> {
    let now = now_ms();
    let latest_sample = report.samples.last().ok_or(IngestError::BadRequest)?;
    let maintenance = agent_key
        .maintenance_until
        .is_some_and(|until| until as i64 > now);
    let machine_state = machine_health_state(latest_sample, maintenance);
    let previous_container_inventory = if !duplicate && report.container_inventory.is_some() {
        telemetry_db
            .prepare("SELECT container_inventory_json FROM machine_latest WHERE machine_pk = ?")
            .bind(&[unsigned(report.machine_pk)])?
            .first::<LatestContainerRow>(None)
            .await?
            .and_then(|row| row.container_inventory_json)
    } else {
        None
    };
    let mut statements = vec![replay_statement(
        telemetry_db,
        agent_id,
        header.key_epoch,
        header.sequence,
        now,
    )?];
    if !duplicate {
        statements.push(block_statement(
            telemetry_db,
            report,
            payload_hash,
            compressed_payload,
        )?);
        statements.push(state_transition_statement(
            telemetry_db,
            report,
            machine_state,
            now,
        )?);
        statements.push(latest_statement(
            telemetry_db,
            agent_id,
            report,
            machine_state,
            now,
            previous_container_inventory.as_deref(),
        )?);
        statements.extend(closed_rollups(telemetry_db, report).await?);
    }
    telemetry_db.batch(statements).await?;
    limit_previous_key_overlap(control_db, agent_id, header.key_epoch, now).await?;
    if report.applied_config_revision > agent_key.applied_config_revision as u64 {
        control_db
            .prepare(
                "UPDATE agents SET applied_config_revision = ?, last_seen_at = ?,
                   agent_version = CASE WHEN ? <> '' THEN ? ELSE agent_version END
                 WHERE id = ? AND status = 'active' AND applied_config_revision < ?",
            )
            .bind(&[
                unsigned(report.applied_config_revision),
                number(now),
                text(&report.agent_version),
                text(&report.agent_version),
                text(agent_id),
                unsigned(report.applied_config_revision),
            ])?
            .run()
            .await?;
    } else {
        control_db
            .prepare(
                "UPDATE agents SET last_seen_at = ?,
                   agent_version = CASE WHEN ? <> '' THEN ? ELSE agent_version END
                 WHERE id = ? AND status = 'active'",
            )
            .bind(&[
                number(now),
                text(&report.agent_version),
                text(&report.agent_version),
                text(agent_id),
            ])?
            .run()
            .await?;
    }
    let key_rotation = key_rotation_proposal(
        control_db,
        agent_id,
        header.key_epoch,
        agent_key.valid_from as i64,
        now,
        wrapping_key,
    )
    .await?;
    let acknowledgement = DurableAck {
        report_id: report.report_id.clone(),
        status: if duplicate {
            AckStatus::Duplicate as i32
        } else {
            AckStatus::Committed as i32
        },
        committed_at_ms: now,
        config_revision: agent_key.desired_config_revision as u64,
        config,
        commands,
        live_session,
        key_rotation,
        payload_hash: payload_hash.to_vec(),
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
    if !is_protobuf_content_type(request.headers().get("content-type")?.as_deref()) {
        return Err(IngestError::UnsupportedMediaType);
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
    let wrapping_key = key_wrapping_secret(&env)?;
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
        agent_id,
        now,
    )
    .map_err(|_| IngestError::BadRequest)?;
    if report.applied_config_revision < agent_key.applied_config_revision as u64
        || report.applied_config_revision > agent_key.desired_config_revision as u64
    {
        return Err(IngestError::BadRequest);
    }
    if let Some(inventory) = &report.container_inventory {
        sync_container_catalog(&control_db, &agent_key, inventory, now).await?;
    }
    let payload_hash = blake3::hash(&compressed_payload);
    let duplicate = classify_slot(&telemetry_db, &report, payload_hash.as_bytes()).await?;
    persist_probe_results(&control_db, &telemetry_db, agent_id, &report).await?;
    persist_command_results(&control_db, agent_id, &report).await?;
    let config = if report.applied_config_revision < agent_key.desired_config_revision as u64 {
        Some(
            build_config_snapshot(
                &control_db,
                &env,
                agent_id,
                agent_key.desired_config_revision as u64,
            )
            .await?,
        )
    } else {
        None
    };
    let commands = load_commands(&control_db, agent_id, now).await?;
    let live_session = env
        .secret("LIVE_TICKET_SECRET")
        .ok()
        .and_then(|secret| env.var("LIVE_ORIGIN").ok().map(|origin| (secret, origin)))
        .and_then(|(secret, origin)| {
            issue_live_session(
                &secret.to_string(),
                &origin.to_string(),
                &agent_key.workspace_id,
                agent_id,
                report.machine_pk,
                now,
            )
            .ok()
        });
    durable_ack(
        &control_db,
        &telemetry_db,
        &header,
        &report,
        agent_id,
        &agent_key,
        &keys,
        nonce_prefix,
        &compressed_payload,
        payload_hash.as_bytes(),
        duplicate,
        config,
        commands,
        live_session,
        &wrapping_key,
    )
    .await
}

fn error_response(error: IngestError) -> WorkerResult<Response> {
    match error {
        IngestError::BadRequest => Response::error("Bad request", 400),
        IngestError::UnsupportedMediaType => Response::error("Unsupported media type", 415),
        IngestError::Unauthorized => Response::error("Not found", 404),
        IngestError::Conflict => Response::error("Conflict", 409),
        IngestError::Internal(error) => Err(error),
    }
}

fn health_response(method: Method) -> WorkerResult<Response> {
    let mut response = match method {
        Method::Get => Response::from_json(&serde_json::json!({
            "service": "ingest",
            "status": "ok"
        }))?,
        Method::Head => Response::empty()?,
        _ => {
            let mut response = Response::error("Method not allowed", 405)?;
            response.headers_mut().set("allow", "GET, HEAD")?;
            response
        }
    };
    response.headers_mut().set("cache-control", "no-store")?;
    response
        .headers_mut()
        .set("x-content-type-options", "nosniff")?;
    Ok(response)
}

#[event(fetch)]
pub async fn main(request: Request, env: Env, _context: Context) -> WorkerResult<Response> {
    let path = request.path();
    let result = match path.as_str() {
        "/healthz" => return health_response(request.method()),
        "/v1/enroll" => handle_enrollment(request, env).await,
        "/v1/reports" => handle_report(request, env).await,
        _ => return Response::error("Not found", 404),
    };
    match result {
        Ok(response) => Ok(response),
        Err(error) => error_response(error),
    }
}
