use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

use thiserror::Error;

static COMMAND_COUNTER: AtomicU64 = AtomicU64::new(0);

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
    let suffix = COMMAND_COUNTER.fetch_add(1, Ordering::Relaxed);
    let base = format!("alphaping-runtime-{}-{suffix}", std::process::id());
    let stdout_path = temporary_path(&format!("{base}.stdout"));
    let stderr_path = temporary_path(&format!("{base}.stderr"));
    let stdout = create_output(&stdout_path)?;
    let stderr = match create_output(&stderr_path) {
        Ok(stderr) => stderr,
        Err(error) => {
            remove_outputs(&stdout_path, &stderr_path);
            return Err(error);
        }
    };
    let child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn();
    let mut child = match child {
        Ok(child) => child,
        Err(error) => {
            remove_outputs(&stdout_path, &stderr_path);
            return Err(classify_spawn_error(error));
        }
    };
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                remove_outputs(&stdout_path, &stderr_path);
                return Err(CommandError::Io);
            }
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                remove_outputs(&stdout_path, &stderr_path);
                return Err(CommandError::Timeout);
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
        }
    };
    let stdout = read_limited(&stdout_path, output_limit);
    let stderr = read_limited(&stderr_path, 16 * 1024);
    remove_outputs(&stdout_path, &stderr_path);
    if !status.success() {
        let stderr = stderr.unwrap_or_default();
        if contains_ignore_ascii_case(&stderr, b"permission denied") {
            return Err(CommandError::PermissionDenied);
        }
        return Err(CommandError::Failed);
    }
    Ok(CommandOutput { stdout: stdout? })
}

fn temporary_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(name)
}

fn create_output(path: &PathBuf) -> Result<File, CommandError> {
    OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|_| CommandError::Io)
}

fn read_limited(path: &PathBuf, limit: usize) -> Result<Vec<u8>, CommandError> {
    let mut file = File::open(path).map_err(|_| CommandError::Io)?;
    let length = file.metadata().map_err(|_| CommandError::Io)?.len();
    if length > limit as u64 {
        return Err(CommandError::OutputTooLarge);
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|_| CommandError::Io)?;
    let mut output = Vec::with_capacity(length as usize);
    file.read_to_end(&mut output)
        .map_err(|_| CommandError::Io)?;
    Ok(output)
}

fn remove_outputs(stdout: &PathBuf, stderr: &PathBuf) {
    let _ = fs::remove_file(stdout);
    let _ = fs::remove_file(stderr);
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
