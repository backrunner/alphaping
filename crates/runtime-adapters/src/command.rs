use std::{process::Stdio, time::Duration};

use thiserror::Error;
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};

#[derive(Debug, Error)]
pub enum CommandError {
    #[error("command is not installed")]
    NotFound,
    #[error("command access was denied")]
    PermissionDenied,
    #[error("command timed out")]
    Timeout,
    #[error("command failed")]
    Failed,
    #[error("command output exceeded the limit")]
    OutputTooLarge,
    #[error("command input/output failed")]
    Io,
}

pub struct CommandOutput {
    pub stdout: Vec<u8>,
}

pub fn run(
    program: &str,
    args: &[&str],
    timeout: Duration,
    output_limit: usize,
) -> Result<CommandOutput, CommandError> {
    // Collection runs on its own blocking thread. Pipes apply backpressure and never
    // spill untrusted CLI output to disk; the single-thread driver also bounds EOF waits.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| CommandError::Io)?;
    runtime.block_on(async {
        let mut child = Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(classify_spawn_error)?;
        let stdout = child.stdout.take().ok_or(CommandError::Io)?;
        let stderr = child.stderr.take().ok_or(CommandError::Io)?;
        let result = tokio::time::timeout(timeout, async {
            tokio::try_join!(
                async { child.wait().await.map_err(|_| CommandError::Io) },
                read_limited(stdout, output_limit),
                read_limited(stderr, 16 * 1024),
            )
        })
        .await;
        let result = result.unwrap_or(Err(CommandError::Timeout));
        if result.is_err() {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(1), child.wait()).await;
        }
        let (status, stdout, stderr) = result?;
        if !status.success() {
            return Err(
                if contains_ignore_ascii_case(&stderr, b"permission denied") {
                    CommandError::PermissionDenied
                } else {
                    CommandError::Failed
                },
            );
        }
        Ok(CommandOutput { stdout })
    })
}

async fn read_limited(
    mut reader: impl AsyncRead + Unpin,
    limit: usize,
) -> Result<Vec<u8>, CommandError> {
    let mut output = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let length = reader
            .read(&mut chunk)
            .await
            .map_err(|_| CommandError::Io)?;
        if length == 0 {
            return Ok(output);
        }
        if length > limit.saturating_sub(output.len()) {
            return Err(CommandError::OutputTooLarge);
        }
        output.extend_from_slice(&chunk[..length]);
    }
}

fn classify_spawn_error(error: std::io::Error) -> CommandError {
    match error.kind() {
        std::io::ErrorKind::NotFound => CommandError::NotFound,
        std::io::ErrorKind::PermissionDenied => CommandError::PermissionDenied,
        _ => CommandError::Io,
    }
}

fn contains_ignore_ascii_case(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window.eq_ignore_ascii_case(needle))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn bounds_stdout_and_stderr_before_process_exit() {
        for script in [
            "while :; do printf 1234567890; done",
            "while :; do printf 1234567890 >&2; done",
        ] {
            assert!(matches!(
                run("/bin/sh", &["-c", script], Duration::from_secs(2), 1024),
                Err(CommandError::OutputTooLarge)
            ));
        }
    }
    #[test]
    fn bounds_commands_and_classifies_permission_errors() {
        assert!(matches!(
            run(
                "/bin/sh",
                &["-c", "sleep 2"],
                Duration::from_millis(30),
                1024
            ),
            Err(CommandError::Timeout)
        ));
        assert!(matches!(
            run(
                "/bin/sh",
                &["-c", "printf 'Permission denied' >&2; exit 1"],
                Duration::from_secs(2),
                1024
            ),
            Err(CommandError::PermissionDenied)
        ));
        assert_eq!(
            run("/bin/sh", &["-c", "printf ok"], Duration::from_secs(2), 2)
                .expect("bounded success")
                .stdout,
            b"ok"
        );
    }
}
