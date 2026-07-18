use std::{fs, io::Write, path::Path};

use anyhow::{Context, Result, bail};
use tokio::{
    process::Command,
    time::{Duration, timeout},
};
use uuid::Uuid;

const CANDIDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(30);

pub async fn install_verified_binary(
    bytes: &[u8],
    config_path: &Path,
    expected_version: &str,
) -> Result<()> {
    let current = std::env::current_exe().context("cannot locate the running Agent binary")?;
    install_verified_binary_at(&current, bytes, config_path, expected_version).await
}

async fn install_verified_binary_at(
    current: &Path,
    bytes: &[u8],
    config_path: &Path,
    expected_version: &str,
) -> Result<()> {
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
        let previous_temporary =
            parent.join(format!(".alphaping-agent-{}.previous", Uuid::now_v7()));
        fs::copy(current, &previous_temporary)
            .context("cannot copy the current Agent binary for rollback")?;
        fs::File::open(&previous_temporary)?.sync_all()?;
        fs::rename(&previous_temporary, &previous)
            .context("cannot preserve the current Agent binary for rollback")?;
        sync_directory(parent)?;
        if let Err(error) = fs::rename(&temporary, current) {
            return Err(error).context("cannot atomically install the Agent update");
        }
        if let Err(error) = sync_directory(parent) {
            fs::rename(&previous, current)
                .context("cannot roll back an Agent update after directory sync failed")?;
            sync_directory(parent)?;
            return Err(error).context("cannot durably install the Agent update");
        }
        if let Err(error) = self_test(current, config_path).await {
            fs::rename(&previous, current)
                .context("updated Agent failed health check and rollback failed")?;
            sync_directory(parent)?;
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
        fs::copy(current, &helper).context("cannot create the Windows updater helper")?;
        Command::new(&helper)
            .arg("apply-update")
            .arg("--current")
            .arg(current)
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
        let _ = start_windows_service().await;
        return Err(error.context("Windows Agent update reported an unexpected version"));
    }
    if let Err(error) = self_test(&current, &config).await {
        let _ = fs::remove_file(&current);
        fs::rename(&previous, &current).context("cannot roll back the Windows Agent update")?;
        let _ = start_windows_service().await;
        return Err(error.context("Windows Agent update failed health check and was rolled back"));
    }
    let restart_failure = match start_windows_service().await {
        Ok(status) if status.success() => return Ok(()),
        Ok(status) => format!("returned {status}"),
        Err(error) => format!("failed: {error:#}"),
    };
    let _ = fs::remove_file(&current);
    fs::rename(&previous, &current)
        .context("Windows Agent service restart failed and rollback failed")?;
    let rollback_status = start_windows_service()
        .await
        .context("previous Windows Agent binary was restored but could not be restarted")?;
    if !rollback_status.success() {
        bail!(
            "Windows Agent service restart {restart_failure}; rollback restart returned {rollback_status}"
        );
    }
    bail!("Windows Agent service restart {restart_failure}; previous binary restored")
}

#[cfg(windows)]
async fn start_windows_service() -> Result<std::process::ExitStatus> {
    let mut command = Command::new("sc.exe");
    command.args(["start", "AlphaPingAgent"]).kill_on_drop(true);
    timeout(CANDIDATE_CHECK_TIMEOUT, command.status())
        .await
        .context("Windows Agent service restart timed out")?
        .context("cannot restart the Windows Agent service")
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
    self_test_with_timeout(binary, config_path, CANDIDATE_CHECK_TIMEOUT).await
}

async fn self_test_with_timeout(
    binary: &Path,
    config_path: &Path,
    duration: Duration,
) -> Result<()> {
    let mut command = Command::new(binary);
    command
        .arg("self-test")
        .arg("--config")
        .arg(config_path)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .kill_on_drop(true);
    let status = timeout(duration, command.status())
        .await
        .context("candidate Agent health check timed out")?
        .context("cannot run the candidate Agent health check")?;
    if !status.success() {
        bail!("candidate Agent health check returned {status}");
    }
    Ok(())
}

async fn verify_binary_version(binary: &Path, expected_version: &str) -> Result<()> {
    let mut command = Command::new(binary);
    command
        .arg("--version")
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .kill_on_drop(true);
    let output = timeout(CANDIDATE_CHECK_TIMEOUT, command.output())
        .await
        .context("candidate Agent version check timed out")?
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

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use tempfile::tempdir;

    use super::*;

    fn write_script(path: &Path, body: &str) {
        fs::write(path, body).expect("write test Agent");
        fs::set_permissions(path, fs::Permissions::from_mode(0o755))
            .expect("make test Agent executable");
    }

    #[tokio::test]
    async fn installs_a_candidate_after_both_health_checks_pass() {
        let directory = tempdir().expect("temporary directory");
        let current = directory.path().join("alphaping-agent");
        let config = directory.path().join("agent.toml");
        fs::write(&config, "unused").expect("test config");
        write_script(&current, "#!/bin/sh\necho old\n");
        fs::write(
            directory.path().join("alphaping-agent.previous"),
            "stale backup",
        )
        .expect("stale previous Agent");
        let candidate = b"#!/bin/sh\ncase \"$1\" in\n  --version) echo 'alphaping-agent 0.2.0' ;;\n  self-test) exit 0 ;;\n  *) exit 2 ;;\nesac\n";

        install_verified_binary_at(&current, candidate, &config, "0.2.0")
            .await
            .expect("install verified candidate");

        assert_eq!(fs::read(&current).expect("installed Agent"), candidate);
        assert_eq!(
            fs::read(directory.path().join("alphaping-agent.previous")).expect("previous Agent"),
            b"#!/bin/sh\necho old\n"
        );
    }

    #[tokio::test]
    async fn restores_the_previous_binary_when_post_install_health_fails() {
        let directory = tempdir().expect("temporary directory");
        let current = directory.path().join("alphaping-agent");
        let state = directory.path().join("health-count");
        fs::write(&state, "0").expect("health state");
        let previous = b"#!/bin/sh\necho old\n";
        write_script(
            &current,
            std::str::from_utf8(previous).expect("test script"),
        );
        let candidate = b"#!/bin/sh\ncase \"$1\" in\n  --version) echo 'alphaping-agent 0.2.0' ;;\n  self-test)\n    count=$(cat \"$3\")\n    if [ \"$count\" = 0 ]; then echo 1 >\"$3\"; exit 0; fi\n    exit 1 ;;\n  *) exit 2 ;;\nesac\n";

        let error = install_verified_binary_at(&current, candidate, &state, "0.2.0")
            .await
            .expect_err("post-install health must fail");

        assert!(error.to_string().contains("rolled back"));
        assert_eq!(fs::read(&current).expect("restored Agent"), previous);
        assert!(!directory.path().join("alphaping-agent.previous").exists());
    }

    #[tokio::test]
    async fn terminates_a_candidate_that_exceeds_the_health_check_deadline() {
        let directory = tempdir().expect("temporary directory");
        let candidate = directory.path().join("alphaping-agent");
        let config = directory.path().join("agent.toml");
        fs::write(&config, "unused").expect("test config");
        write_script(&candidate, "#!/bin/sh\nsleep 5\n");

        let error = self_test_with_timeout(&candidate, &config, Duration::from_millis(50))
            .await
            .expect_err("candidate health check must time out");

        assert!(error.to_string().contains("timed out"));
    }
}
