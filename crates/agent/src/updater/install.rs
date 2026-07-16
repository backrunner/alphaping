use std::{fs, io::Write, path::Path};

use anyhow::{Context, Result, bail};
use tokio::process::Command;
use uuid::Uuid;

pub async fn install_verified_binary(
    bytes: &[u8],
    config_path: &Path,
    expected_version: &str,
) -> Result<()> {
    let current = std::env::current_exe().context("cannot locate the running Agent binary")?;
    let parent = current
        .parent()
        .context("running Agent binary has no parent directory")?;
    let temporary = parent.join(format!(".alphaping-agent-{}.new", Uuid::now_v7()));
    write_executable(&temporary, bytes)?;
    if let Err(error) = verify_binary_version(&temporary, expected_version).await {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = self_test(&temporary, config_path).await {
        let _ = fs::remove_file(&temporary);
        return Err(error.context("candidate Agent failed its pre-install health check"));
    }

    #[cfg(unix)]
    {
        let previous = parent.join("alphaping-agent.previous");
        if previous.exists() {
            fs::remove_file(&previous).context("cannot remove the previous Agent backup")?;
        }
        fs::rename(&current, &previous).context("cannot preserve the current Agent binary")?;
        if let Err(error) = fs::rename(&temporary, &current) {
            let _ = fs::rename(&previous, &current);
            return Err(error).context("cannot atomically install the Agent update");
        }
        sync_directory(parent)?;
        if let Err(error) = self_test(&current, config_path).await {
            let failed = parent.join(format!(".alphaping-agent-{}.failed", Uuid::now_v7()));
            let _ = fs::rename(&current, &failed);
            fs::rename(&previous, &current)
                .context("updated Agent failed health check and rollback failed")?;
            sync_directory(parent)?;
            let _ = fs::remove_file(failed);
            return Err(error.context("updated Agent failed health check and was rolled back"));
        }
        return Ok(());
    }

    #[cfg(windows)]
    {
        let helper = parent.join("alphaping-updater-helper.exe");
        if helper.exists() {
            fs::remove_file(&helper).context("cannot replace the Windows updater helper")?;
        }
        fs::copy(&current, &helper).context("cannot create the Windows updater helper")?;
        Command::new(&helper)
            .arg("apply-update")
            .arg("--current")
            .arg(&current)
            .arg("--candidate")
            .arg(&temporary)
            .arg("--config")
            .arg(config_path)
            .arg("--version")
            .arg(expected_version)
            .spawn()
            .context("cannot launch the Windows updater helper")?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Ok(())
}

#[cfg(windows)]
pub async fn apply_windows_update(arguments: &[std::ffi::OsString]) -> Result<()> {
    use tokio::time::{Duration, sleep};

    let mut current = None;
    let mut candidate = None;
    let mut config = None;
    let mut version = None;
    let mut index = 0;
    while index < arguments.len() {
        let value = arguments
            .get(index + 1)
            .context("Windows updater flag is missing a value")?;
        match arguments[index].to_string_lossy().as_ref() {
            "--current" => current = Some(std::path::PathBuf::from(value)),
            "--candidate" => candidate = Some(std::path::PathBuf::from(value)),
            "--config" => config = Some(std::path::PathBuf::from(value)),
            "--version" => version = Some(value.to_string_lossy().into_owned()),
            _ => bail!("unknown Windows updater flag"),
        }
        index += 2;
    }
    let current = current.context("--current is required")?;
    let candidate = candidate.context("--candidate is required")?;
    let config = config.context("--config is required")?;
    let version = version.context("--version is required")?;
    let previous = current.with_extension("previous.exe");
    for _ in 0..240 {
        if previous.exists() {
            let _ = fs::remove_file(&previous);
        }
        match fs::rename(&current, &previous) {
            Ok(()) => break,
            Err(_) => sleep(Duration::from_millis(250)).await,
        }
    }
    if !previous.exists() {
        bail!("timed out waiting for the Windows Agent service to stop");
    }
    if let Err(error) = fs::rename(&candidate, &current) {
        let _ = fs::rename(&previous, &current);
        return Err(error).context("cannot install the Windows Agent update");
    }
    if let Err(error) = verify_binary_version(&current, &version).await {
        let _ = fs::remove_file(&current);
        fs::rename(&previous, &current).context("cannot roll back the Windows Agent update")?;
        let _ = Command::new("sc.exe")
            .args(["start", "AlphaPingAgent"])
            .status()
            .await;
        return Err(error.context("Windows Agent update reported an unexpected version"));
    }
    if let Err(error) = self_test(&current, &config).await {
        let _ = fs::remove_file(&current);
        fs::rename(&previous, &current).context("cannot roll back the Windows Agent update")?;
        let _ = Command::new("sc.exe")
            .args(["start", "AlphaPingAgent"])
            .status()
            .await;
        return Err(error.context("Windows Agent update failed health check and was rolled back"));
    }
    let status = Command::new("sc.exe")
        .args(["start", "AlphaPingAgent"])
        .status()
        .await
        .context("cannot restart the Windows Agent service")?;
    if !status.success() {
        bail!("Windows Agent service restart returned {status}");
    }
    Ok(())
}

fn write_executable(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o755);
    }
    let mut file = options
        .open(path)
        .with_context(|| format!("cannot create update at {}", path.display()))?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

async fn self_test(binary: &Path, config_path: &Path) -> Result<()> {
    let status = Command::new(binary)
        .arg("self-test")
        .arg("--config")
        .arg(config_path)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .status()
        .await
        .context("cannot run the candidate Agent health check")?;
    if !status.success() {
        bail!("candidate Agent health check returned {status}");
    }
    Ok(())
}

async fn verify_binary_version(binary: &Path, expected_version: &str) -> Result<()> {
    let output = Command::new(binary)
        .arg("--version")
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .output()
        .await
        .context("cannot read the candidate Agent version")?;
    let expected = format!("alphaping-agent {expected_version}\n");
    if !output.status.success() || output.stdout != expected.as_bytes() || !output.stderr.is_empty()
    {
        bail!("candidate Agent version did not match signed metadata");
    }
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<()> {
    fs::File::open(path)?.sync_all()?;
    Ok(())
}
