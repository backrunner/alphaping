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
    key_rotation::rotated_agent_config,
    live::LiveHandle,
    probes::{ProbeMonitor, validate_config},
    sampler::Sampler,
    spool::Spool,
    updater::{UpdateRequest, Updater},
    uploader::{UploadError, Uploader},
};

struct RuntimeControl<'a> {
    probe_monitor: &'a ProbeMonitor,
    live: &'a LiveHandle,
    config_path: &'a Path,
    config: &'a mut AgentConfig,
    container_monitor: &'a mut Option<ContainerMonitor>,
}

pub async fn run(
    config_path: &Path,
    mut service_shutdown: Option<watch::Receiver<bool>>,
) -> Result<()> {
    let mut config = AgentConfig::load(config_path)?;
    #[cfg(target_os = "macos")]
    if config.credential_storage == crate::config::CredentialStorage::RestrictedFile {
        warn!(
            credential_storage = "restricted_file",
            "macOS System Keychain capability is unavailable; Agent credentials use the restricted config file"
        );
    }
    let mut spool = Spool::open_existing(&config.spool_path)?;
    let persisted_sequence =
        spool.verify_sequence_checkpoint(config.transport_sequence_checkpoint)?;
    if persisted_sequence > config.transport_sequence_checkpoint {
        config.transport_sequence_checkpoint = persisted_sequence;
        config.save(config_path)?;
    }
    let mut sampler = Sampler::new();
    let initial_probe_config = spool.load_probe_config()?;
    let (probe_monitor, mut probe_results) =
        ProbeMonitor::start(config.agent_id.clone(), initial_probe_config)?;
    let mut container_monitor = config
        .container_monitoring_enabled
        .then(ContainerMonitor::start);
    let mut uploader = Uploader::new(
        config.endpoint.clone(),
        config.agent_id.as_bytes().to_vec(),
        config.key_epoch,
        config.data_key()?,
        config.nonce_prefix()?,
    )?;
    let live = LiveHandle::start(config.machine_pk);
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
                let inserted = spool.append_sample(&sample, now)?;
                if inserted
                    && let Err(error) = live.send_snapshot(&mut spool, config.machine_pk, &sample, now)
                {
                    warn!(error = %error, "live snapshot was dropped");
                }
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
                let schedule_changed = upload_due_report(
                    &mut spool,
                    &mut uploader,
                    &mut RuntimeControl {
                        probe_monitor: &probe_monitor,
                        live: &live,
                        config_path,
                        config: &mut config,
                        container_monitor: &mut container_monitor,
                    },
                    unix_time_ms()?,
                ).await?;
                if schedule_changed {
                    sample_tick = interval(Duration::from_secs(config.sample_interval_seconds));
                    sample_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
                    report_tick = interval(Duration::from_secs(config.report_interval_seconds));
                    report_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
                }
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
                if let Some(updater) = updater.clone() {
                    automatic_update_in_flight = true;
                    spawn_automatic_update(updater, automatic_result_tx.clone());
                }
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
    uploader: &mut Uploader,
    control: &mut RuntimeControl<'_>,
    now_ms: i64,
) -> Result<bool> {
    let Some(delivery) = spool.due_delivery(now_ms)? else {
        return Ok(false);
    };
    let mut schedule_changed = false;
    let sequence = spool.next_sequence()?;
    control.config.transport_sequence_checkpoint = sequence;
    control.config.save(control.config_path)?;
    match uploader.upload(&delivery, sequence, now_ms).await {
        Ok(acknowledgement) => {
            match apply_ack(
                spool,
                uploader,
                control,
                &delivery.report_id,
                &acknowledgement,
                now_ms,
            ) {
                Ok(changed) => {
                    schedule_changed = changed;
                    let recovery_jitter_ms = rand::rng().random_range(0_i64..=5_000);
                    spool.wake_backlog(now_ms.saturating_add(recovery_jitter_ms))?;
                }
                Err(error) => {
                    spool.mark_failure(
                        &delivery.report_id,
                        now_ms.saturating_add(300_000),
                        "local_config",
                    )?;
                    error!(error = %error, "failed to apply authenticated Agent response");
                }
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
    Ok(schedule_changed)
}

fn apply_ack(
    spool: &mut Spool,
    uploader: &mut Uploader,
    control: &mut RuntimeControl<'_>,
    report_id: &[u8],
    acknowledgement: &alphaping_protocol::v1::DurableAck,
    now_ms: i64,
) -> Result<bool> {
    let mut schedule_changed = false;
    let current_revision = spool.applied_config_revision()?;
    if acknowledgement.config_revision > current_revision {
        let next = acknowledgement
            .config
            .as_ref()
            .context("server omitted the newer Agent configuration")?;
        validate_new_config(next, acknowledgement.config_revision)?;
        let mut updated = control.config.clone();
        if let Some(sample) = next.sample_interval_seconds {
            updated.sample_interval_seconds = u64::from(sample);
        }
        if let Some(report) = next.report_interval_seconds {
            updated.report_interval_seconds = u64::from(report);
        }
        if let Some(enabled) = next.container_monitoring_enabled {
            updated.container_monitoring_enabled = enabled;
        }
        schedule_changed = updated.sample_interval_seconds
            != control.config.sample_interval_seconds
            || updated.report_interval_seconds != control.config.report_interval_seconds;
        let container_changed =
            updated.container_monitoring_enabled != control.config.container_monitoring_enabled;
        updated.save(control.config_path)?;
        control.probe_monitor.apply_config(next.clone())?;
        if container_changed {
            *control.container_monitor = updated
                .container_monitoring_enabled
                .then(ContainerMonitor::start);
        }
        spool.apply_probe_config(next, now_ms)?;
        *control.config = updated;
    }
    if let Some(proposal) = acknowledgement.key_rotation.as_ref() {
        let updated = rotated_agent_config(control.config, proposal, now_ms)?;
        updated.save(control.config_path)?;
        let replacement = Uploader::new(
            updated.endpoint.clone(),
            updated.agent_id.as_bytes().to_vec(),
            updated.key_epoch,
            updated.data_key()?,
            updated.nonce_prefix()?,
        )?;
        let key_epoch = updated.key_epoch;
        *control.config = updated;
        *uploader = replacement;
        info!(key_epoch, "Agent data key rotated");
    }
    spool.accept_commands(&acknowledgement.commands, now_ms)?;
    if let Some(credential) = acknowledgement.live_session.clone()
        && let Err(error) = control.live.update_credential(credential, now_ms)
    {
        warn!(error = %error, "authenticated live session credential was ignored");
    }
    if !spool.acknowledge(report_id)? {
        bail!("durable ACK did not match a local delivery");
    }
    Ok(schedule_changed)
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
    }
}
