use alphaping_protocol::v1::{ProbeResult, ProbeState};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub struct AssignedCheck {
    pub id: String,
    pub check_pk: u64,
    pub service_pk: u64,
    pub workspace_pk: u64,
    pub assignment_revision: u64,
    pub interval_seconds: u32,
    pub phase_seconds: u32,
    pub failure_confirmations: u32,
    pub recovery_confirmations: u32,
    pub critical: bool,
    pub maintenance_until: Option<i64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResultState {
    Healthy,
    Degraded,
    Down,
    Unknown,
}

impl ResultState {
    pub fn from_probe(value: i32) -> Option<Self> {
        match ProbeState::try_from(value).ok()? {
            ProbeState::Healthy => Some(Self::Healthy),
            ProbeState::Degraded => Some(Self::Degraded),
            ProbeState::Down => Some(Self::Down),
            ProbeState::Unspecified => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::Degraded => "degraded",
            Self::Down => "down",
            Self::Unknown => "unknown",
        }
    }

    fn severity(self) -> u8 {
        match self {
            Self::Unknown => 0,
            Self::Healthy => 1,
            Self::Degraded => 2,
            Self::Down => 3,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredObservation {
    pub execution_id: String,
    pub nominal_slot_ms: i64,
    pub observed_at_ms: i64,
    pub state: ResultState,
    pub latency_ms: Option<u32>,
    pub failure_code: Option<String>,
    pub failure_summary: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredBatch {
    pub v: u32,
    pub id: String,
    pub observed_at: i64,
    pub state: ResultState,
    pub latency_ms: Option<u32>,
    pub failure_code: Option<String>,
    pub failure_summary: Option<String>,
    #[serde(default)]
    pub executor_agent_id: String,
    #[serde(default)]
    pub config_revision: u64,
    #[serde(default, skip_deserializing)]
    pub samples: Vec<StoredObservation>,
}

#[derive(Clone, Debug)]
pub struct ResultBatch {
    pub config: AssignedCheck,
    pub nominal_minute: i64,
    pub result_id: [u8; 32],
    pub payload: Vec<u8>,
    pub observed_at: i64,
    pub state: ResultState,
    pub latency_ms: Option<u32>,
    pub failure_code: Option<String>,
    pub failure_summary: Option<String>,
}

pub fn matches_assignment(result: &ProbeResult, config: &AssignedCheck, agent_id: &str) -> bool {
    let slot_seconds = result.nominal_slot_ms.div_euclid(1_000);
    result.check_pk == config.check_pk
        && result.service_pk == config.service_pk
        && result.workspace_pk == config.workspace_pk
        && result.executor_agent_id == agent_id
        && result.config_revision == config.assignment_revision
        && slot_seconds.rem_euclid(i64::from(config.interval_seconds))
            == i64::from(config.phase_seconds)
}

pub fn compile_batch(
    config: AssignedCheck,
    nominal_minute: i64,
    executor_agent_id: &str,
    mut results: Vec<ProbeResult>,
) -> Option<ResultBatch> {
    results.sort_by_key(|result| (result.nominal_slot_ms, result.observed_at_ms));
    let observed_at = results.iter().map(|result| result.observed_at_ms).max()?;
    let state = results
        .iter()
        .filter_map(|result| ResultState::from_probe(result.state))
        .max_by_key(|state| state.severity())?;
    let latency_values = results
        .iter()
        .filter_map(|result| result.latency_ms)
        .collect::<Vec<_>>();
    let latency_ms = (!latency_values.is_empty()).then(|| {
        let total = latency_values
            .iter()
            .map(|value| u64::from(*value))
            .sum::<u64>();
        u32::try_from(total / latency_values.len() as u64).unwrap_or(u32::MAX)
    });
    let failure = results
        .iter()
        .rev()
        .find(|result| ResultState::from_probe(result.state) == Some(state));
    let failure_code = failure
        .filter(|result| !result.failure_code.is_empty())
        .map(|result| result.failure_code.clone());
    let failure_summary = failure
        .filter(|result| !result.failure_summary.is_empty())
        .map(|result| result.failure_summary.clone());
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"alphaping/check-batch/v1");
    hasher.update(config.id.as_bytes());
    hasher.update(executor_agent_id.as_bytes());
    hasher.update(&config.assignment_revision.to_be_bytes());
    hasher.update(&nominal_minute.to_be_bytes());
    let result_id = *hasher.finalize().as_bytes();
    let payload = serde_json::to_vec(&StoredBatch {
        v: 2,
        id: hex::encode(result_id),
        observed_at,
        state,
        latency_ms,
        failure_code: failure_code.clone(),
        failure_summary: failure_summary.clone(),
        executor_agent_id: executor_agent_id.to_owned(),
        config_revision: config.assignment_revision,
        samples: results
            .into_iter()
            .map(|result| StoredObservation {
                execution_id: hex::encode(result.execution_id),
                nominal_slot_ms: result.nominal_slot_ms,
                observed_at_ms: result.observed_at_ms,
                state: ResultState::from_probe(result.state).unwrap_or(ResultState::Unknown),
                latency_ms: result.latency_ms,
                failure_code: (!result.failure_code.is_empty()).then_some(result.failure_code),
                failure_summary: (!result.failure_summary.is_empty())
                    .then_some(result.failure_summary),
            })
            .collect(),
    })
    .ok()?;
    Some(ResultBatch {
        config,
        nominal_minute,
        result_id,
        payload,
        observed_at,
        state,
        latency_ms,
        failure_code,
        failure_summary,
    })
}

#[derive(Clone, Debug)]
pub struct PreviousConfirmation {
    pub state: ResultState,
    pub failure_code: Option<String>,
    pub failure_summary: Option<String>,
    pub consecutive_failures: u32,
    pub consecutive_successes: u32,
}

#[derive(Clone, Debug)]
pub struct ConfirmedResult {
    pub state: ResultState,
    pub failure_code: Option<String>,
    pub failure_summary: Option<String>,
    pub consecutive_failures: u32,
    pub consecutive_successes: u32,
}

pub fn confirm(
    config: &AssignedCheck,
    previous: Option<&PreviousConfirmation>,
    result: &ResultBatch,
) -> ConfirmedResult {
    if result.state == ResultState::Healthy {
        let successes = previous.map_or(1, |previous| {
            previous.consecutive_successes.saturating_add(1)
        });
        let prior = previous.map_or(ResultState::Healthy, |previous| previous.state);
        let accepted = previous.is_none()
            || prior == ResultState::Healthy
            || successes >= config.recovery_confirmations;
        return ConfirmedResult {
            state: if accepted {
                ResultState::Healthy
            } else if prior == ResultState::Unknown {
                ResultState::Unknown
            } else {
                prior
            },
            failure_code: (!accepted)
                .then(|| previous.and_then(|value| value.failure_code.clone()))
                .flatten(),
            failure_summary: (!accepted)
                .then(|| previous.and_then(|value| value.failure_summary.clone()))
                .flatten(),
            consecutive_failures: 0,
            consecutive_successes: successes,
        };
    }
    let failures = previous.map_or(1, |previous| {
        previous.consecutive_failures.saturating_add(1)
    });
    let prior = previous.map_or(ResultState::Unknown, |previous| previous.state);
    let accepted = matches!(prior, ResultState::Down | ResultState::Degraded)
        || failures >= config.failure_confirmations;
    ConfirmedResult {
        state: if prior == ResultState::Down && result.state == ResultState::Degraded {
            ResultState::Down
        } else if accepted {
            result.state
        } else {
            prior
        },
        failure_code: Some(
            if accepted {
                result.failure_code.as_deref().unwrap_or("probe_failed")
            } else {
                "failure_pending"
            }
            .to_owned(),
        ),
        failure_summary: result.failure_summary.clone(),
        consecutive_failures: failures,
        consecutive_successes: 0,
    }
}

#[cfg(test)]
mod tests {
    use alphaping_protocol::v1::{ProbeResult, ProbeState};

    use super::{AssignedCheck, ResultState, compile_batch, confirm, matches_assignment};

    fn config() -> AssignedCheck {
        AssignedCheck {
            id: "018f5f7e-7d28-7e12-a521-23456789abcd".to_owned(),
            check_pk: 1,
            service_pk: 2,
            workspace_pk: 3,
            assignment_revision: 4,
            interval_seconds: 10,
            phase_seconds: 0,
            failure_confirmations: 2,
            recovery_confirmations: 2,
            critical: true,
            maintenance_until: None,
        }
    }

    #[test]
    fn minute_batch_preserves_samples_and_uses_worst_state() {
        let results = [ProbeState::Healthy, ProbeState::Down]
            .into_iter()
            .enumerate()
            .map(|(index, state)| ProbeResult {
                execution_id: vec![index as u8; 32],
                state: state as i32,
                nominal_slot_ms: 120_000 + index as i64 * 10_000,
                observed_at_ms: 121_000 + index as i64 * 10_000,
                latency_ms: Some(10),
                ..ProbeResult::default()
            })
            .collect();
        let batch = compile_batch(config(), 120_000, "agent-1", results).expect("batch");
        assert_eq!(batch.state, ResultState::Down);
        assert_eq!(batch.state.as_str(), "down");
        assert_eq!(batch.nominal_minute, 120_000);
        assert_eq!(batch.result_id.len(), 32);
        assert_eq!(batch.observed_at, 131_000);
        assert_eq!(batch.latency_ms, Some(10));
        assert!(batch.config.critical);
        assert_eq!(batch.config.maintenance_until, None);
        assert!(
            String::from_utf8(batch.payload.clone())
                .expect("JSON")
                .contains("samples")
        );
        let confirmed = confirm(&batch.config, None, &batch);
        assert_eq!(confirmed.state, ResultState::Unknown);
        assert_eq!(confirmed.failure_code.as_deref(), Some("failure_pending"));
        assert_eq!(confirmed.failure_summary, None);
        assert_eq!(confirmed.consecutive_failures, 1);
        assert_eq!(confirmed.consecutive_successes, 0);
    }

    #[test]
    fn reassignment_rejects_old_executor_and_revision() {
        let config = config();
        let mut result = ProbeResult {
            check_pk: config.check_pk,
            service_pk: config.service_pk,
            workspace_pk: config.workspace_pk,
            executor_agent_id: "agent-2".to_owned(),
            config_revision: config.assignment_revision,
            nominal_slot_ms: 120_000,
            ..ProbeResult::default()
        };
        assert!(matches_assignment(&result, &config, "agent-2"));
        assert!(!matches_assignment(&result, &config, "agent-1"));
        result.config_revision -= 1;
        assert!(!matches_assignment(&result, &config, "agent-2"));
    }
}
