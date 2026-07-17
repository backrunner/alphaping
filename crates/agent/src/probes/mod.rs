mod assertions;
mod http;
mod icmp;
mod tcp;
mod tls;

use std::{collections::HashMap, time::Duration};

use alphaping_protocol::{
    encode_message,
    v1::{AgentConfigSnapshot, ProbeResult, ProbeState, ProbeTask, probe_task},
};
use anyhow::{Context, Result, bail};
use tokio::{
    sync::{mpsc, watch},
    time::{MissedTickBehavior, interval},
};

const MAX_PROBE_TASKS: usize = 32;
const MAX_CONCURRENT_PROBES: usize = 4;

#[derive(Debug)]
pub(crate) struct ProbeOutcome {
    pub state: ProbeState,
    pub latency_ms: Option<u32>,
    pub failure_code: String,
    pub failure_summary: String,
}

impl ProbeOutcome {
    pub fn healthy(latency_ms: u32) -> Self {
        Self {
            state: ProbeState::Healthy,
            latency_ms: Some(latency_ms),
            failure_code: String::new(),
            failure_summary: String::new(),
        }
    }

    pub fn failed(code: &str) -> Self {
        Self {
            state: ProbeState::Down,
            latency_ms: None,
            failure_code: code.to_owned(),
            failure_summary: String::new(),
        }
    }
}

pub struct ProbeMonitor {
    config_sender: watch::Sender<AgentConfigSnapshot>,
}

impl ProbeMonitor {
    pub fn start(
        agent_id: String,
        initial: AgentConfigSnapshot,
    ) -> Result<(Self, mpsc::Receiver<ProbeResult>)> {
        validate_config(&initial)?;
        let (config_sender, config_receiver) = watch::channel(initial);
        let (result_sender, result_receiver) = mpsc::channel(512);
        tokio::spawn(run_scheduler(agent_id, config_receiver, result_sender));
        Ok((Self { config_sender }, result_receiver))
    }

    pub fn apply_config(&self, config: AgentConfigSnapshot) -> Result<()> {
        validate_config(&config)?;
        self.config_sender
            .send(config)
            .map_err(|_| anyhow::anyhow!("probe scheduler stopped"))
    }
}

pub fn validate_config(config: &AgentConfigSnapshot) -> Result<()> {
    if config.revision == 0 {
        if config.probe_tasks.is_empty() && config.digest.is_empty() {
            return Ok(());
        }
        bail!("invalid initial probe configuration");
    }
    if config.created_at_ms <= 0 || config.digest.len() != 32 {
        bail!("probe configuration metadata is invalid");
    }
    match (
        config.sample_interval_seconds,
        config.report_interval_seconds,
    ) {
        (Some(sample), Some(report))
            if (5..=300).contains(&sample)
                && (60..=900).contains(&report)
                && report.is_multiple_of(sample) => {}
        (None, None) => {}
        _ => bail!("Agent collection intervals are invalid"),
    }
    let mut unsigned = config.clone();
    unsigned.digest.clear();
    if blake3::hash(&encode_message(&unsigned)).as_bytes() != config.digest.as_slice() {
        bail!("probe configuration digest is invalid");
    }
    if config.probe_tasks.len() > MAX_PROBE_TASKS {
        bail!("probe task limit exceeded");
    }
    for task in &config.probe_tasks {
        if task.check_id.len() != 36
            || task.check_pk == 0
            || task.service_pk == 0
            || task.workspace_pk == 0
            || task.config_revision == 0
            || task.config_revision > config.revision
            || !(5..=86_400).contains(&task.interval_seconds)
            || task.phase_seconds >= task.interval_seconds
            || !(100..=30_000).contains(&task.timeout_ms)
        {
            bail!("invalid probe task");
        }
        match &task.request {
            Some(probe_task::Request::Http(request))
                if request.url.len() <= 2_048
                    && request.headers.len() <= 32
                    && request.assertions.len() <= 20
                    && request.body.len() <= 16_384
                    && request.max_redirects <= 3
                    && request.max_response_bytes <= 262_144 => {}
            Some(probe_task::Request::Tcp(request))
                if request.hostname.len() <= 253
                    && request.server_name.as_ref().is_none_or(|name| {
                        name.len() <= 253 && !name.chars().any(char::is_whitespace)
                    })
                    && (1..=65_535).contains(&request.port)
                    && request.payload.len() <= 4_096
                    && request.response_prefix.len() <= 4_096 => {}
            Some(probe_task::Request::Icmp(request)) if request.hostname.len() <= 253 => {}
            _ => bail!("invalid probe request"),
        }
    }
    Ok(())
}

async fn run_scheduler(
    agent_id: String,
    mut config_receiver: watch::Receiver<AgentConfigSnapshot>,
    result_sender: mpsc::Sender<ProbeResult>,
) {
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_PROBES));
    let mut last_slots = HashMap::<(String, u64), i64>::new();
    let mut tick = interval(Duration::from_millis(250));
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = tick.tick() => {
                let now_ms = unix_time_ms();
                let config = config_receiver.borrow().clone();
                last_slots.retain(|(check_id, revision), _| config.probe_tasks.iter().any(|task| {
                    task.check_id == *check_id && task.config_revision == *revision
                }));
                for task in config.probe_tasks {
                    let slot_ms = due_slot_ms(now_ms, &task);
                    let key = (task.check_id.clone(), task.config_revision);
                    if last_slots.get(&key).is_some_and(|last| *last >= slot_ms) {
                        continue;
                    }
                    let Ok(permit) = semaphore.clone().try_acquire_owned() else {
                        break;
                    };
                    last_slots.insert(key, slot_ms);
                    let sender = result_sender.clone();
                    let executor = agent_id.clone();
                    tokio::spawn(async move {
                        let _permit = permit;
                        let result = execute_task(&executor, task, slot_ms).await;
                        let _ = sender.send(result).await;
                    });
                }
            }
            changed = config_receiver.changed() => {
                if changed.is_err() {
                    break;
                }
            }
        }
    }
}

fn unix_time_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

fn due_slot_ms(now_ms: i64, task: &ProbeTask) -> i64 {
    let interval_ms = i64::from(task.interval_seconds) * 1_000;
    let phase_ms = i64::from(task.phase_seconds) * 1_000;
    (now_ms - phase_ms).div_euclid(interval_ms) * interval_ms + phase_ms
}

async fn execute_task(agent_id: &str, task: ProbeTask, nominal_slot_ms: i64) -> ProbeResult {
    let timeout = Duration::from_millis(u64::from(task.timeout_ms));
    let outcome = match task.request.as_ref() {
        Some(probe_task::Request::Http(request)) => http::execute(request, timeout).await,
        Some(probe_task::Request::Tcp(request)) => tcp::execute(request, timeout).await,
        Some(probe_task::Request::Icmp(request)) => icmp::execute(request, timeout).await,
        None => ProbeOutcome::failed("invalid_config"),
    };
    let mut identity = blake3::Hasher::new();
    identity.update(task.check_id.as_bytes());
    identity.update(&task.config_revision.to_be_bytes());
    identity.update(&nominal_slot_ms.to_be_bytes());
    ProbeResult {
        execution_id: identity.finalize().as_bytes().to_vec(),
        check_id: task.check_id,
        check_pk: task.check_pk,
        service_pk: task.service_pk,
        workspace_pk: task.workspace_pk,
        executor_agent_id: agent_id.to_owned(),
        config_revision: task.config_revision,
        nominal_slot_ms,
        observed_at_ms: unix_time_ms(),
        state: outcome.state as i32,
        latency_ms: outcome.latency_ms,
        failure_code: outcome.failure_code,
        failure_summary: outcome.failure_summary.chars().take(160).collect(),
    }
}

fn elapsed_ms(started: std::time::Instant) -> u32 {
    u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX)
}

fn threshold_outcome(latency_ms: u32, degraded_after_ms: u32, down_after_ms: u32) -> ProbeOutcome {
    if down_after_ms > 0 && latency_ms >= down_after_ms {
        return ProbeOutcome {
            state: ProbeState::Down,
            latency_ms: Some(latency_ms),
            failure_code: "latency_threshold".to_owned(),
            failure_summary: format!("latency>={down_after_ms}ms"),
        };
    }
    if degraded_after_ms > 0 && latency_ms >= degraded_after_ms {
        return ProbeOutcome {
            state: ProbeState::Degraded,
            latency_ms: Some(latency_ms),
            failure_code: "latency_threshold".to_owned(),
            failure_summary: format!("latency>={degraded_after_ms}ms"),
        };
    }
    ProbeOutcome::healthy(latency_ms)
}

fn require_nonempty(value: &str, label: &str) -> Result<()> {
    if value.is_empty() {
        bail!("{label} is empty");
    }
    Ok(())
}

fn parse_url(value: &str) -> Result<reqwest::Url> {
    let url = reqwest::Url::parse(value).context("invalid probe URL")?;
    if url.scheme() != "http" && url.scheme() != "https" {
        bail!("unsupported probe URL");
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use alphaping_protocol::{encode_message, v1::AgentConfigSnapshot};

    use super::validate_config;

    #[test]
    fn configuration_digest_covers_the_full_snapshot() {
        let mut config = AgentConfigSnapshot {
            revision: 3,
            created_at_ms: 120_000,
            sample_interval_seconds: Some(10),
            report_interval_seconds: Some(60),
            ..AgentConfigSnapshot::default()
        };
        config.digest = blake3::hash(&encode_message(&config)).as_bytes().to_vec();
        assert!(validate_config(&config).is_ok());
        config.created_at_ms += 1;
        assert!(validate_config(&config).is_err());
    }

    #[test]
    fn configuration_intervals_are_bounded_and_backward_compatible() {
        let snapshots = [
            (None, None, true),
            (Some(10), Some(60), true),
            (Some(5), Some(900), true),
            (Some(4), Some(60), false),
            (Some(10), Some(65), false),
            (Some(10), None, false),
        ];
        for (sample, report, expected) in snapshots {
            let mut config = AgentConfigSnapshot {
                revision: 2,
                created_at_ms: 120_000,
                sample_interval_seconds: sample,
                report_interval_seconds: report,
                ..AgentConfigSnapshot::default()
            };
            config.digest = blake3::hash(&encode_message(&config)).as_bytes().to_vec();
            assert_eq!(validate_config(&config).is_ok(), expected);
        }
    }
}
