use std::{
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use alphaping_agent::{
    backoff::equal_jitter_delay, config::AgentConfig, enrollment::enroll, sampler::Sampler,
    spool::Spool, uploader::Uploader,
};
use anyhow::{Context, Result, bail};
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
    let arguments = std::env::args_os().skip(1).collect::<Vec<_>>();
    if arguments
        .first()
        .is_some_and(|argument| argument == "enroll")
    {
        return run_enrollment(&arguments[1..]).await;
    }
    let config_path = arguments
        .first()
        .map(PathBuf::from)
        .context("usage: alphaping-agent <config.toml> | alphaping-agent enroll --endpoint URL --token TOKEN --config PATH")?;
    run_agent(&config_path).await
}

async fn run_enrollment(arguments: &[std::ffi::OsString]) -> Result<()> {
    let mut endpoint = None;
    let mut token = None;
    let mut machine_claim_id = None;
    let mut config_path = None;
    let mut index = 0;
    while index < arguments.len() {
        let flag = arguments[index].to_string_lossy();
        let value = arguments
            .get(index + 1)
            .context("enrollment flag is missing a value")?;
        match flag.as_ref() {
            "--endpoint" => endpoint = Some(value.to_string_lossy().into_owned()),
            "--token" => token = Some(value.to_string_lossy().into_owned()),
            "--machine" => machine_claim_id = Some(value.to_string_lossy().into_owned()),
            "--config" => config_path = Some(PathBuf::from(value)),
            _ => bail!("unknown enrollment flag"),
        }
        index += 2;
    }
    let endpoint = endpoint.context("--endpoint is required")?;
    let token = token.context("--token is required")?;
    let machine_claim_id = machine_claim_id.context("--machine is required")?;
    let config_path = config_path.context("--config is required")?;
    let material = enroll(&endpoint, &token, &machine_claim_id).await?;
    let response = material.response;
    let config = AgentConfig {
        endpoint: format!("{}/v1/reports", endpoint.trim_end_matches('/')),
        agent_id: response.agent_id,
        machine_pk: response.machine_pk,
        workspace_pk: response.workspace_pk,
        key_epoch: response.key_epoch,
        data_key_hex: hex::encode(response.data_key),
        nonce_prefix_hex: hex::encode(response.nonce_prefix),
        identity_private_key_hex: hex::encode(material.identity_private_key),
        spool_path: default_spool_path(),
        sample_interval_seconds: u64::from(response.sample_interval_seconds),
        report_interval_seconds: u64::from(response.report_interval_seconds),
        max_spool_bytes: 512 * 1024 * 1024,
    };
    config.save(&config_path)?;
    info!(path = %config_path.display(), "agent enrollment completed");
    Ok(())
}

fn default_spool_path() -> String {
    #[cfg(target_os = "windows")]
    {
        let root = std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_owned());
        format!("{root}\\AlphaPing\\spool.db")
    }
    #[cfg(target_os = "macos")]
    {
        "/Library/Application Support/AlphaPing/spool.db".to_owned()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        "/var/lib/alphaping/spool.db".to_owned()
    }
}

async fn run_agent(config_path: &Path) -> Result<()> {
    let config = AgentConfig::load(config_path)?;
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
