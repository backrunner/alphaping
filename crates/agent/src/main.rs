use std::{
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use alphaping_agent::{
    backoff::equal_jitter_delay, config::AgentConfig, sampler::Sampler, spool::Spool,
    uploader::Uploader,
};
use anyhow::{Context, Result};
use rand::Rng;
use tokio::time::{MissedTickBehavior, interval};
use tracing::{error, info, warn};

fn unix_time_ms() -> Result<i64> {
    let millis = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    i64::try_from(millis).context("system time is outside the protocol range")
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_target(false)
        .compact()
        .init();
    let config_path = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .context("usage: alphaping-agent <config.toml>")?;
    let config = AgentConfig::load(&config_path)?;
    let mut spool = Spool::open(&config.spool_path)?;
    let mut sampler = Sampler::new();
    let uploader = Uploader::new(
        config.endpoint.clone(),
        config.agent_id.as_bytes().to_vec(),
        config.key_epoch,
        config.data_key()?,
        config.nonce_prefix()?,
    )?;

    let mut sample_tick = interval(Duration::from_secs(config.sample_interval_seconds));
    sample_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut report_tick = interval(Duration::from_secs(config.report_interval_seconds));
    report_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut upload_tick = interval(Duration::from_secs(1));
    upload_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
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
                if let Err(error) = spool.create_next_delivery(config.machine_pk, config.workspace_pk, now) {
                    error!(error = %error, "failed to create durable report");
                }
            }
            _ = upload_tick.tick() => {
                let now = unix_time_ms()?;
                if let Some(delivery) = spool.due_delivery(now)? {
                    match uploader.upload(&mut spool, &delivery, now).await {
                        Ok(()) => {
                            let recovery_jitter_ms = rand::rng().random_range(0_i64..=5_000);
                            spool.wake_backlog(now.saturating_add(recovery_jitter_ms))?;
                        }
                        Err(error) => {
                            let random = rand::rng().random_range(0.0..=1.0);
                            let delay = equal_jitter_delay(delivery.attempt_count, random);
                            let next = now.saturating_add(i64::try_from(delay.as_millis()).unwrap_or(300_000));
                            spool.mark_failure(&delivery.report_id, next, error_code(&error))?;
                            warn!(error = %error, retry_seconds = delay.as_secs(), "durable report upload failed");
                        }
                    }
                }
            }
            result = tokio::signal::ctrl_c() => {
                result?;
                info!("shutdown requested");
                break;
            }
        }
    }
    Ok(())
}

fn error_code(error: &alphaping_agent::uploader::UploadError) -> &'static str {
    use alphaping_agent::uploader::UploadError;
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
