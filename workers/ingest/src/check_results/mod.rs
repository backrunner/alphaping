mod persistence;
mod rollups;

use std::collections::{BTreeMap, BTreeSet};

use alphaping_protocol::v1::{MachineReport, ProbeResult};
use serde::Deserialize;
use worker::{D1Database, js_sys::Uint8Array, wasm_bindgen::JsValue};

use crate::check_result_model::{AssignedCheck, compile_batch, matches_assignment};

pub enum ProbePersistenceError {
    Invalid,
    Conflict,
    Worker(worker::Error),
}

impl From<worker::Error> for ProbePersistenceError {
    fn from(error: worker::Error) -> Self {
        Self::Worker(error)
    }
}

#[derive(Debug, Deserialize)]
struct AssignmentRow {
    id: String,
    telemetry_pk: f64,
    service_pk: f64,
    workspace_pk: f64,
    assignment_revision: f64,
    interval_seconds: f64,
    phase_seconds: f64,
    failure_confirmations: f64,
    recovery_confirmations: f64,
    maintenance_until: Option<f64>,
}

pub async fn persist_probe_results(
    control_db: &D1Database,
    telemetry_db: &D1Database,
    agent_id: &str,
    report: &MachineReport,
) -> Result<(), ProbePersistenceError> {
    if report.probe_results.is_empty() {
        return Ok(());
    }
    let check_ids = report
        .probe_results
        .iter()
        .map(|result| result.check_id.clone())
        .collect::<BTreeSet<_>>();
    if check_ids.len() > 32 {
        return Err(ProbePersistenceError::Invalid);
    }
    let placeholders = std::iter::repeat_n("?", check_ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let query = format!(
        "SELECT c.id, c.telemetry_pk, s.telemetry_pk AS service_pk,
                w.telemetry_pk AS workspace_pk, c.assignment_revision,
                c.interval_seconds, c.phase_seconds, c.failure_confirmations,
                c.recovery_confirmations, s.maintenance_until
         FROM check_configs c
         JOIN services s ON s.id = c.service_id AND s.deleted_at IS NULL
         JOIN workspaces w ON w.id = c.workspace_id AND w.deleted_at IS NULL
         WHERE c.executor_kind = 'agent' AND c.executor_agent_id = ? AND c.enabled = 1
           AND c.id IN ({placeholders})"
    );
    let mut bindings = Vec::with_capacity(check_ids.len() + 1);
    bindings.push(JsValue::from_str(agent_id));
    bindings.extend(check_ids.iter().map(|id| JsValue::from_str(id)));
    let rows = control_db
        .prepare(query)
        .bind(&bindings)?
        .all()
        .await?
        .results::<AssignmentRow>()?;
    if rows.len() != check_ids.len() {
        return Err(ProbePersistenceError::Invalid);
    }
    let assignments = rows
        .into_iter()
        .map(|row| {
            (
                row.id.clone(),
                AssignedCheck {
                    id: row.id,
                    check_pk: row.telemetry_pk as u64,
                    service_pk: row.service_pk as u64,
                    workspace_pk: row.workspace_pk as u64,
                    assignment_revision: row.assignment_revision as u64,
                    interval_seconds: row.interval_seconds as u32,
                    phase_seconds: row.phase_seconds as u32,
                    failure_confirmations: row.failure_confirmations as u32,
                    recovery_confirmations: row.recovery_confirmations as u32,
                    maintenance_until: row.maintenance_until.map(|value| value as i64),
                },
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut groups = BTreeMap::<(String, i64), Vec<ProbeResult>>::new();
    for result in &report.probe_results {
        let config = assignments
            .get(&result.check_id)
            .ok_or(ProbePersistenceError::Invalid)?;
        if !valid_result(result, config, agent_id) {
            return Err(ProbePersistenceError::Invalid);
        }
        let minute = result.nominal_slot_ms.div_euclid(60_000) * 60_000;
        groups
            .entry((result.check_id.clone(), minute))
            .or_default()
            .push(result.clone());
    }
    for ((check_id, minute), results) in groups {
        let config = assignments
            .get(&check_id)
            .ok_or(ProbePersistenceError::Invalid)?
            .clone();
        let maximum = 60_u32.div_ceil(config.interval_seconds).saturating_add(1) as usize;
        if results.len() > maximum {
            return Err(ProbePersistenceError::Invalid);
        }
        let batch = compile_batch(config, minute, agent_id, results)
            .ok_or(ProbePersistenceError::Invalid)?;
        persistence::persist_batch(telemetry_db, &batch).await?;
    }
    Ok(())
}

fn valid_result(result: &ProbeResult, config: &AssignedCheck, agent_id: &str) -> bool {
    matches_assignment(result, config, agent_id)
}

pub(super) fn blob(value: &[u8]) -> JsValue {
    Uint8Array::from(value).into()
}

pub(super) fn number(value: i64) -> JsValue {
    JsValue::from_f64(value as f64)
}

pub(super) fn unsigned(value: u64) -> JsValue {
    JsValue::from_f64(value as f64)
}

pub(super) fn text(value: &str) -> JsValue {
    JsValue::from_str(value)
}

pub(super) fn optional_text(value: Option<&str>) -> JsValue {
    value.map_or(JsValue::NULL, JsValue::from_str)
}

pub(super) fn optional_unsigned(value: Option<u32>) -> JsValue {
    value.map_or(JsValue::NULL, |value| JsValue::from_f64(f64::from(value)))
}
