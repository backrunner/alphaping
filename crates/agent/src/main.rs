use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use alphaping_agent::{config::AgentConfig, enrollment::enroll, runtime, spool::Spool};
use anyhow::{Context, Result, bail};
use tracing::info;

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_target(false)
        .compact()
        .init();
    let arguments = std::env::args_os().skip(1).collect::<Vec<_>>();
    if arguments.len() == 1 && arguments[0] == "--version" {
        println!("alphaping-agent {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    if arguments.len() == 1 && arguments[0] == "release-info" {
        let now_ms = i64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())
            .context("system time is outside the release metadata range")?;
        let root = alphaping_agent::updater::embedded_root_sha256(now_ms)?;
        println!("version={}", env!("CARGO_PKG_VERSION"));
        println!("platform={}", std::env::consts::OS);
        println!("arch={}", std::env::consts::ARCH);
        println!("update_root_sha256={root}");
        return Ok(());
    }
    if arguments.len() == 1 && arguments[0] == "diagnose-runtimes" {
        let inventory = alphaping_runtime_adapters::RuntimeCollector::new().collect(now_ms()?);
        println!("{}", serde_json::to_string_pretty(&inventory)?);
        return Ok(());
    }
    if arguments
        .first()
        .is_some_and(|argument| argument == "self-test")
    {
        return run_self_test(&arguments[1..]);
    }
    if arguments
        .first()
        .is_some_and(|argument| argument == "service")
    {
        #[cfg(windows)]
        {
            if arguments.len() != 3 || arguments[1] != "--config" {
                bail!("usage: alphaping-agent service --config PATH");
            }
            return alphaping_agent::service::dispatch(PathBuf::from(&arguments[2]));
        }
        #[cfg(not(windows))]
        bail!("the service subcommand is only available on Windows");
    }
    if arguments
        .first()
        .is_some_and(|argument| argument == "apply-update")
    {
        #[cfg(windows)]
        return alphaping_agent::updater::apply_windows_update(&arguments[1..]).await;
        #[cfg(not(windows))]
        bail!("the apply-update subcommand is only available on Windows");
    }
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
    runtime::run(&config_path, None).await
}

fn run_self_test(arguments: &[std::ffi::OsString]) -> Result<()> {
    if arguments.len() != 2 || arguments[0] != "--config" {
        bail!("usage: alphaping-agent self-test --config PATH");
    }
    let config = AgentConfig::load(Path::new(&arguments[1]))?;
    let _spool = Spool::open(&config.spool_path)?;
    let _client = alphaping_agent::uploader::pq_client()?;
    info!("Agent self-test passed");
    Ok(())
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
        container_monitoring_enabled: response.container_monitoring_enabled,
        auto_update: true,
        update_channel: "stable".to_owned(),
        pinned_version: None,
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

fn now_ms() -> Result<i64> {
    i64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())
        .context("system time is outside the runtime diagnostic range")
}
