use serde::Deserialize;
use worker::{D1Database, D1PreparedStatement, wasm_bindgen::JsValue};

use super::{
    ProbePersistenceError, blob, number, optional_text, optional_unsigned, text, unsigned,
};
use crate::check_result_model::{PreviousConfirmation, ResultBatch, ResultState, confirm};

#[derive(Debug, Deserialize)]
struct SlotRow {
    result_id: Option<Vec<u8>>,
    payload_hash: Option<Vec<u8>>,
}

#[derive(Debug, Deserialize)]
struct PreviousCheckRow {
    observed_at: f64,
    state: String,
    failure_code: Option<String>,
    failure_summary: Option<String>,
    consecutive_failures: f64,
    consecutive_successes: f64,
}

pub async fn persist_batch(
    db: &D1Database,
    batch: &ResultBatch,
) -> Result<(), ProbePersistenceError> {
    let payload_hash = *blake3::hash(&batch.payload).as_bytes();
    if classify_slot(db, batch, &payload_hash).await? {
        return Ok(());
    }
    let previous = db
        .prepare(
            "SELECT observed_at, state, failure_code, failure_summary,
                    consecutive_failures, consecutive_successes
             FROM check_latest WHERE workspace_pk = ? AND check_pk = ?",
        )
        .bind(&[
            unsigned(batch.config.workspace_pk),
            unsigned(batch.config.check_pk),
        ])?
        .first::<PreviousCheckRow>(None)
        .await?;
    let historical = previous
        .as_ref()
        .is_some_and(|previous| previous.observed_at as i64 > batch.observed_at);
    let mut statements = vec![block_statement(db, batch, &payload_hash)?];
    statements.extend(super::rollups::closed_rollup_statements(db, batch).await?);
    if !historical {
        statements.extend(current_state_statements(db, batch, previous.as_ref())?);
    }
    db.batch(statements).await?;
    Ok(())
}

async fn classify_slot(
    db: &D1Database,
    batch: &ResultBatch,
    payload_hash: &[u8],
) -> Result<bool, ProbePersistenceError> {
    let slot = minute_slot(batch.nominal_minute);
    let query = format!(
        "SELECT result_id_{slot} AS result_id, payload_hash_{slot} AS payload_hash
         FROM check_result_blocks_5m
         WHERE workspace_pk = ? AND check_pk = ? AND block_start = ?"
    );
    let existing = db
        .prepare(query)
        .bind(&[
            unsigned(batch.config.workspace_pk),
            unsigned(batch.config.check_pk),
            number(block_start(batch.nominal_minute)),
        ])?
        .first::<SlotRow>(None)
        .await?;
    match existing.and_then(|row| row.result_id.zip(row.payload_hash)) {
        None => Ok(false),
        Some((id, hash)) if id == batch.result_id && hash == payload_hash => Ok(true),
        Some(_) => Err(ProbePersistenceError::Conflict),
    }
}

fn block_statement(
    db: &D1Database,
    batch: &ResultBatch,
    payload_hash: &[u8],
) -> Result<D1PreparedStatement, worker::Error> {
    let slot = minute_slot(batch.nominal_minute);
    let result = format!("result_{slot}");
    let id = format!("result_id_{slot}");
    let hash = format!("payload_hash_{slot}");
    let query = format!(
        "INSERT INTO check_result_blocks_5m
          (check_pk, workspace_pk, block_start, {result}, {id}, {hash}, schema_version, flags)
         VALUES (?, ?, ?, ?, ?, ?, 2, 0)
         ON CONFLICT(check_pk, block_start) DO UPDATE SET
           {result} = excluded.{result}, {id} = excluded.{id}, {hash} = excluded.{hash},
           schema_version = MAX(check_result_blocks_5m.schema_version, excluded.schema_version)
         WHERE check_result_blocks_5m.workspace_pk = excluded.workspace_pk
           AND (check_result_blocks_5m.{id} IS NULL
            OR (check_result_blocks_5m.{id} = excluded.{id}
                AND check_result_blocks_5m.{hash} = excluded.{hash}))"
    );
    db.prepare(query).bind(&[
        unsigned(batch.config.check_pk),
        unsigned(batch.config.workspace_pk),
        number(block_start(batch.nominal_minute)),
        blob(&batch.payload),
        blob(&batch.result_id),
        blob(payload_hash),
    ])
}

fn current_state_statements(
    db: &D1Database,
    batch: &ResultBatch,
    previous: Option<&PreviousCheckRow>,
) -> Result<Vec<D1PreparedStatement>, worker::Error> {
    let previous_confirmation = previous.map(|previous| PreviousConfirmation {
        state: parse_state(&previous.state),
        failure_code: previous.failure_code.clone(),
        failure_summary: previous.failure_summary.clone(),
        consecutive_failures: previous.consecutive_failures as u32,
        consecutive_successes: previous.consecutive_successes as u32,
    });
    let confirmed = confirm(&batch.config, previous_confirmation.as_ref(), batch);
    let mut statements = vec![
        db.prepare(
            "INSERT INTO check_latest
              (check_pk, workspace_pk, service_pk, observed_at, state, latency_ms, failure_code,
               failure_summary, consecutive_failures, consecutive_successes, critical, result_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(check_pk) DO UPDATE SET
               workspace_pk = excluded.workspace_pk, service_pk = excluded.service_pk,
               observed_at = excluded.observed_at, state = excluded.state,
               latency_ms = excluded.latency_ms, failure_code = excluded.failure_code,
               failure_summary = excluded.failure_summary,
               consecutive_failures = excluded.consecutive_failures,
               consecutive_successes = excluded.consecutive_successes,
               critical = excluded.critical,
               result_id = excluded.result_id
             WHERE check_latest.workspace_pk = excluded.workspace_pk
               AND excluded.observed_at >= check_latest.observed_at",
        )
        .bind(&[
            unsigned(batch.config.check_pk),
            unsigned(batch.config.workspace_pk),
            unsigned(batch.config.service_pk),
            number(batch.observed_at),
            text(confirmed.state.as_str()),
            optional_unsigned(batch.latency_ms),
            optional_text(confirmed.failure_code.as_deref()),
            optional_text(confirmed.failure_summary.as_deref()),
            unsigned(u64::from(confirmed.consecutive_failures)),
            unsigned(u64::from(confirmed.consecutive_successes)),
            unsigned(u64::from(batch.config.critical)),
            blob(&batch.result_id),
        ])?,
    ];
    statements.extend(service_state_statements(db, batch)?);
    Ok(statements)
}

const SERVICE_STATE_CTE: &str = "WITH service_aggregate(rank) AS (
       SELECT COALESCE(MAX(CASE
         WHEN critical = 1 AND state = 'down' THEN 3
         WHEN state IN ('down', 'degraded') THEN 2
         WHEN state = 'healthy' THEN 1
         ELSE 0 END), 0)
       FROM check_latest WHERE workspace_pk = ? AND service_pk = ?
     ), next_service(state) AS (
       SELECT CASE
         WHEN ? > ? THEN 'maintenance'
         WHEN service_aggregate.rank = 3 THEN 'down'
         WHEN service_aggregate.rank = 2 THEN 'degraded'
         WHEN service_aggregate.rank = 1 THEN 'healthy'
         ELSE 'unknown'
       END FROM service_aggregate
     )";

const SERVICE_REASON_SQL: &str = "CASE next_service.state
       WHEN 'maintenance' THEN 'maintenance_window'
       WHEN 'down' THEN 'check_down'
       WHEN 'degraded' THEN 'check_degraded'
       WHEN 'healthy' THEN 'check_healthy'
       ELSE 'check_unknown' END";

fn service_state_statements(
    db: &D1Database,
    batch: &ResultBatch,
) -> Result<Vec<D1PreparedStatement>, worker::Error> {
    let maintenance_until = batch.config.maintenance_until.map_or(JsValue::NULL, number);
    let event = format!(
        "{SERVICE_STATE_CTE}
         INSERT OR IGNORE INTO state_events
          (workspace_pk, resource_type, resource_pk, occurred_at, event_id,
           previous_state, current_state, reason_code)
         SELECT ?, 2, ?, ?, ?, COALESCE(previous.state, 'unknown'), next_service.state,
                {SERVICE_REASON_SQL}
         FROM next_service
         LEFT JOIN service_latest previous
           ON previous.workspace_pk = ? AND previous.service_pk = ?
         WHERE EXISTS (
           SELECT 1 FROM check_latest
           WHERE workspace_pk = ? AND check_pk = ? AND result_id = ?
         )
           AND NOT EXISTS (
             SELECT 1 FROM service_latest existing
             WHERE existing.service_pk = ? AND existing.workspace_pk != ?
           )
           AND COALESCE(previous.state, 'unknown') != next_service.state"
    );
    let latest = "INSERT INTO service_latest
          (service_pk, workspace_pk, state, status_since, reason_code,
           last_transition_at, updated_at)
         SELECT ?, ?, event.current_state, ?, event.reason_code, ?, ?
         FROM state_events event
         WHERE event.workspace_pk = ? AND event.resource_type = 2 AND event.resource_pk = ?
           AND event.occurred_at = ? AND event.event_id = ?
           AND changes() = 1
         ON CONFLICT(service_pk) DO UPDATE SET
           workspace_pk = excluded.workspace_pk, state = excluded.state,
           status_since = excluded.status_since, reason_code = excluded.reason_code,
           last_transition_at = excluded.last_transition_at, updated_at = excluded.updated_at
         WHERE service_latest.workspace_pk = excluded.workspace_pk";
    let initial = "INSERT OR IGNORE INTO service_latest
          (service_pk, workspace_pk, state, status_since, reason_code,
           last_transition_at, updated_at)
         SELECT ?, ?, 'unknown', ?, 'check_unknown', ?, ?
         WHERE EXISTS (
           SELECT 1 FROM check_latest
           WHERE workspace_pk = ? AND check_pk = ? AND result_id = ?
         )
           AND NOT EXISTS (
             SELECT 1 FROM state_events event
             WHERE event.workspace_pk = ? AND event.resource_type = 2 AND event.resource_pk = ?
               AND event.occurred_at = ? AND event.event_id = ?
           )";
    Ok(vec![
        db.prepare(event).bind(&[
            unsigned(batch.config.workspace_pk),
            unsigned(batch.config.service_pk),
            maintenance_until.clone(),
            number(batch.observed_at),
            unsigned(batch.config.workspace_pk),
            unsigned(batch.config.service_pk),
            number(batch.observed_at),
            blob(&batch.result_id),
            unsigned(batch.config.workspace_pk),
            unsigned(batch.config.service_pk),
            unsigned(batch.config.workspace_pk),
            unsigned(batch.config.check_pk),
            blob(&batch.result_id),
            unsigned(batch.config.service_pk),
            unsigned(batch.config.workspace_pk),
        ])?,
        db.prepare(latest).bind(&[
            unsigned(batch.config.service_pk),
            unsigned(batch.config.workspace_pk),
            number(batch.observed_at),
            number(batch.observed_at),
            number(batch.observed_at),
            unsigned(batch.config.workspace_pk),
            unsigned(batch.config.service_pk),
            number(batch.observed_at),
            blob(&batch.result_id),
        ])?,
        db.prepare(initial).bind(&[
            unsigned(batch.config.service_pk),
            unsigned(batch.config.workspace_pk),
            number(batch.observed_at),
            number(batch.observed_at),
            number(batch.observed_at),
            unsigned(batch.config.workspace_pk),
            unsigned(batch.config.check_pk),
            blob(&batch.result_id),
            unsigned(batch.config.workspace_pk),
            unsigned(batch.config.service_pk),
            number(batch.observed_at),
            blob(&batch.result_id),
        ])?,
    ])
}

fn parse_state(value: &str) -> ResultState {
    match value {
        "healthy" => ResultState::Healthy,
        "degraded" => ResultState::Degraded,
        "down" => ResultState::Down,
        _ => ResultState::Unknown,
    }
}

fn minute_slot(nominal_minute: i64) -> usize {
    nominal_minute.div_euclid(60_000).rem_euclid(5) as usize
}

fn block_start(nominal_minute: i64) -> i64 {
    nominal_minute.div_euclid(300_000) * 300_000
}
