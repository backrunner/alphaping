use std::{
    path::Path,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use alphaping_protocol::v1::{AgentCommandType, AgentConfigSnapshot};
use anyhow::{Context, Result, bail};
use rand::Rng;
use tokio::{
    sync::{mpsc, watch},
    time::{Instant, MissedTickBehavior, interval, interval_at},
};
use tracing::{error, info, warn};

use crate::{
    backoff::equal_jitter_delay,
    commands::{CommandExecution, command_result, execute_update_command},
    config::AgentConfig,
    containers::ContainerMonitor,
    probes::{ProbeMonitor, validate_config},
    sampler::Sampler,
    spool::Spool,
    updater::{UpdateRequest, Updater},
    uploader::{UploadError, Uploader},
};

pub async fn run(
    config_path: &Path,
    mut service_shutdown: Option<watch::Receiver<bool>>,
) -> Result<()> {
    let config = AgentConfig::load(config_path)?;
    let mut spool = Spool::open(&config.spool_path)?;
    let mut sampler = Sampler::new();
    let initial_probe_config = spool.load_probe_config()?;
    let (probe_monitor, mut probe_results) =
        ProbeMonitor::start(config.agent_id.clone(), initial_probe_config)?;
    let container_monitor = config
        .container_monitoring_enabled
        .then(ContainerMonitor::start);
    let uploader = Uploader::new(
        config.endpoint.clone(),
        config.agent_id.as_bytes().to_vec(),
        config.key_epoch,
        config.data_key()?,
        config.nonce_prefix()?,
    )?;
    let updater = match Updater::new(&config, config_path, unix_time_ms()?) {
        Ok(updater) => Some(Arc::new(updater)),
        Err(error) => {
            warn!(error = %error, "automatic updates are unavailable for this Agent build");
            None
        }
    };

    let mut sample_tick = interval(Duration::from_secs(config.sample_interval_seconds));
    sample_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut report_tick = interval(Duration::from_secs(config.report_interval_seconds));
    report_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut upload_tick = interval(Duration::from_secs(1));
    upload_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut command_tick = interval(Duration::from_secs(1));
    command_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let update_jitter = rand::rng().random_range(0..=30 * 60);
    let mut automatic_update_tick = interval_at(
        Instant::now() + Duration::from_secs(6 * 60 * 60 + update_jitter),
        Duration::from_secs(6 * 60 * 60),
    );
    automatic_update_tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let (command_result_tx, mut command_result_rx) = mpsc::channel::<CommandExecution>(1);
    let (automatic_result_tx, mut automatic_result_rx) = mpsc::channel::<bool>(1);
    let mut command_in_flight = false;
    let mut automatic_update_in_flight = false;
    info!("agent started");

    loop {
        tokio::select! {
            _ = sample_tick.tick() => {
                let now = unix_time_ms()?;
                let sample = sampler.sample(now);
                spool.append_sample(&sample, now)?;
                let dropped = spool.enforce_capacity(config.max_spool_bytes, now)?;
                if dropped > 0 {
                    warn!(dropped_samples = dropped, "spool pressure compacted unassigned samples");
                }
            }
            _ = report_tick.tick() => {
                let now = unix_time_ms()?;
                if let Some(inventory) = container_monitor.as_ref().and_then(ContainerMonitor::snapshot)
                    && let Err(error) = spool.append_container_inventory(&inventory, now)
                {
                    error!(error = %error, "failed to persist container inventory");
                }
                if let Err(error) = spool.create_next_delivery(config.machine_pk, config.workspace_pk, now) {
                    error!(error = %error, "failed to create durable report");
                }
            }
            _ = upload_tick.tick() => {
                upload_due_report(
                    &mut spool,
                    &uploader,
                    &probe_monitor,
                    unix_time_ms()?,
                ).await?;
            }
            _ = command_tick.tick(), if !command_in_flight && !automatic_update_in_flight => {
                command_in_flight = start_due_command(
                    &mut spool,
                    container_monitor.as_ref(),
                    updater.clone(),
                    &command_result_tx,
                    unix_time_ms()?,
                )?;
            }
            Some(execution) = command_result_rx.recv() => {
                command_in_flight = false;
                let now = unix_time_ms()?;
                if execution.retryable
                    && execution.attempt_count < execution.command.attempt_limit
                    && execution.command.expires_at_ms > now
                {
                    warn!(
                        command_id = %execution.command.id,
                        attempt = execution.attempt_count,
                        "Agent command will be retried"
                    );
                } else {
                    spool.complete_command(&execution.result)?;
                    if execution.restart_required {
                        info!("Agent update installed; requesting service restart");
                        return Ok(());
                    }
                }
            }
            _ = automatic_update_tick.tick(), if config.auto_update && updater.is_some() && !automatic_update_in_flight && !command_in_flight => {
                automatic_update_in_flight = true;
                spawn_automatic_update(
                    updater.clone().expect("guarded updater"),
                    automatic_result_tx.clone(),
                );
            }
            Some(restart_required) = automatic_result_rx.recv() => {
                automatic_update_in_flight = false;
                if restart_required {
                    info!("automatic Agent update installed; requesting service restart");
                    return Ok(());
                }
            }
            Some(result) = probe_results.recv() => {
                let now = unix_time_ms()?;
                if let Err(error) = spool.append_probe_result(&result, now) {
                    error!(error = %error, check_id = %result.check_id, "failed to persist probe result");
                }
            }
            result = tokio::signal::ctrl_c() => {
                result?;
                info!("shutdown requested");
                break;
            }
            result = wait_for_service_shutdown(&mut service_shutdown), if service_shutdown.is_some() => {
                result?;
                info!("service shutdown requested");
                break;
            }
        }
    }
    Ok(())
}

async fn upload_due_report(
    spool: &mut Spool,
    uploader: &Uploader,
    probe_monitor: &ProbeMonitor,
    now_ms: i64,
) -> Result<()> {
    let Some(delivery) = spool.due_delivery(now_ms)? else {
        return Ok(());
    };
    match uploader.upload(spool, &delivery, now_ms).await {
        Ok(acknowledgement) => {
            let local_result = apply_ack(
                spool,
                probe_monitor,
                &delivery.report_id,
                &acknowledgement,
                now_ms,
            );
            if let Err(error) = local_result {
                spool.mark_failure(
                    &delivery.report_id,
                    now_ms.saturating_add(300_000),
                    "local_config",
                )?;
                error!(error = %error, "failed to apply authenticated Agent response");
            } else {
                let recovery_jitter_ms = rand::rng().random_range(0_i64..=5_000);
                spool.wake_backlog(now_ms.saturating_add(recovery_jitter_ms))?;
            }
        }
        Err(error) => {
            let random = rand::rng().random_range(0.0..=1.0);
            let delay = equal_jitter_delay(delivery.attempt_count, random);
            let next = now_ms.saturating_add(i64::try_from(delay.as_millis()).unwrap_or(300_000));
            spool.mark_failure(&delivery.report_id, next, upload_error_code(&error))?;
            warn!(error = %error, retry_seconds = delay.as_secs(), "durable report upload failed");
        }
    }
    Ok(())
}

fn apply_ack(
    spool: &mut Spool,
    probe_monitor: &ProbeMonitor,
    report_id: &[u8],
    acknowledgement: &alphaping_protocol::v1::DurableAck,
    now_ms: i64,
) -> Result<()> {
    let current_revision = spool.applied_config_revision()?;
    if acknowledgement.config_revision > current_revision {
        let next = acknowledgement
            .config
            .as_ref()
            .context("server omitted the newer Agent configuration")?;
        validate_new_config(next, acknowledgement.config_revision)?;
        if spool.apply_probe_config(next, now_ms)? {
            probe_monitor.apply_config(next.clone())?;
        }
    }
    spool.accept_commands(&acknowledgement.commands, now_ms)?;
    if !spool.acknowledge(report_id)? {
        bail!("durable ACK did not match a local delivery");
    }
    Ok(())
}

fn validate_new_config(config: &AgentConfigSnapshot, expected_revision: u64) -> Result<()> {
    if config.revision != expected_revision {
        bail!("Agent configuration revision does not match ACK");
    }
    validate_config(config)
}

fn start_due_command(
    spool: &mut Spool,
    container_monitor: Option<&ContainerMonitor>,
    updater: Option<Arc<Updater>>,
    result_sender: &mpsc::Sender<CommandExecution>,
    now_ms: i64,
) -> Result<bool> {
    let Some(pending) = spool.due_command(now_ms)? else {
        return Ok(false);
    };
    if pending.command.expires_at_ms <= now_ms {
        spool.complete_command(&command_result(
            pending.command.id,
            false,
            now_ms,
            "command_expired",
            env!("CARGO_PKG_VERSION").to_owned(),
        ))?;
        return Ok(false);
    }
    let random = rand::rng().random_range(0.0..=1.0);
    let retry_delay =
        equal_jitter_delay(pending.attempt_count, random).max(Duration::from_secs(30));
    let retry_at = now_ms.saturating_add(i64::try_from(retry_delay.as_millis()).unwrap_or(300_000));
    let attempt_count = spool.mark_command_attempt(&pending.command.id, retry_at)?;
    match AgentCommandType::try_from(pending.command.r#type).unwrap_or_default() {
        AgentCommandType::RefreshConfig => {
            spool.complete_command(&command_result(
                pending.command.id,
                true,
                now_ms,
                "config_refreshed",
                env!("CARGO_PKG_VERSION").to_owned(),
            ))?;
            Ok(false)
        }
        AgentCommandType::RedetectRuntimes => {
            let refreshed = container_monitor.is_some_and(ContainerMonitor::refresh);
            spool.complete_command(&command_result(
                pending.command.id,
                refreshed,
                now_ms,
                if refreshed {
                    "runtime_scan_started"
                } else {
                    "container_monitoring_disabled"
                },
                env!("CARGO_PKG_VERSION").to_owned(),
            ))?;
            Ok(false)
        }
        AgentCommandType::CheckUpdate | AgentCommandType::InstallVersion => {
            let sender = result_sender.clone();
            tokio::spawn(async move {
                let execution =
                    execute_update_command(updater, pending.command, attempt_count).await;
                let _ = sender.send(execution).await;
            });
            Ok(true)
        }
        AgentCommandType::Unspecified => {
            spool.complete_command(&command_result(
                pending.command.id,
                false,
                now_ms,
                "unsupported_command",
                env!("CARGO_PKG_VERSION").to_owned(),
            ))?;
            Ok(false)
        }
    }
}

fn spawn_automatic_update(updater: Arc<Updater>, sender: mpsc::Sender<bool>) {
    tokio::spawn(async move {
        let restart = match updater
            .execute(
                UpdateRequest::Check {
                    bypass_rollout: false,
                },
                unix_time_ms().unwrap_or(i64::MAX),
            )
            .await
        {
            Ok(outcome) => outcome.restart_required,
            Err(error) => {
                warn!(error = %error, "automatic Agent update check failed");
                false
            }
        };
        let _ = sender.send(restart).await;
    });
}

async fn wait_for_service_shutdown(shutdown: &mut Option<watch::Receiver<bool>>) -> Result<()> {
    match shutdown {
        Some(receiver) => {
            if *receiver.borrow() {
                return Ok(());
            }
            receiver.changed().await?;
            Ok(())
        }
        None => std::future::pending().await,
    }
}

fn unix_time_ms() -> Result<i64> {
    let millis = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    i64::try_from(millis).context("system time is outside the protocol range")
}

fn upload_error_code(error: &UploadError) -> &'static str {
    match error {
        UploadError::Transport(_) => "network",
        UploadError::Revoked => "revoked",
        UploadError::ServerStatus => "server_status",
        UploadError::ResponseTooLarge => "response_too_large",
        UploadError::Protocol => "protocol",
        UploadError::Authentication => "authentication",
        UploadError::Sequence => "sequence",
    }
}
