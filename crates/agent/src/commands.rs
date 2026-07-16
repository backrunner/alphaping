use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use alphaping_protocol::v1::{
    AgentCommand, AgentCommandResult, AgentCommandResultStatus, AgentCommandType,
};
use semver::Version;
use tracing::warn;

use crate::updater::{UpdateRequest, Updater};

pub struct CommandExecution {
    pub command: AgentCommand,
    pub attempt_count: u32,
    pub result: AgentCommandResult,
    pub retryable: bool,
    pub restart_required: bool,
}

pub fn command_result(
    command_id: String,
    succeeded: bool,
    completed_at_ms: i64,
    result_code: &str,
    installed_version: String,
) -> AgentCommandResult {
    AgentCommandResult {
        command_id,
        status: if succeeded {
            AgentCommandResultStatus::Succeeded as i32
        } else {
            AgentCommandResultStatus::Failed as i32
        },
        completed_at_ms,
        result_code: result_code.to_owned(),
        installed_version,
    }
}

pub async fn execute_update_command(
    updater: Option<Arc<Updater>>,
    command: AgentCommand,
    attempt_count: u32,
) -> CommandExecution {
    let now = unix_time_ms();
    let Some(updater) = updater else {
        return failure(
            command,
            attempt_count,
            now,
            "release_root_unconfigured",
            false,
        );
    };
    let command_type = AgentCommandType::try_from(command.r#type).unwrap_or_default();
    let request = match command_type {
        AgentCommandType::CheckUpdate => UpdateRequest::Check {
            bypass_rollout: command.bypass_rollout,
        },
        AgentCommandType::InstallVersion => match Version::parse(&command.requested_version) {
            Ok(version) => UpdateRequest::Install {
                version,
                bypass_rollout: command.bypass_rollout,
            },
            Err(_) => {
                return failure(
                    command,
                    attempt_count,
                    now,
                    "invalid_requested_version",
                    false,
                );
            }
        },
        _ => {
            return failure(command, attempt_count, now, "unsupported_command", false);
        }
    };
    match updater.execute(request, now).await {
        Ok(outcome) => CommandExecution {
            result: command_result(
                command.id.clone(),
                true,
                now,
                outcome.result_code,
                outcome.installed_version,
            ),
            command,
            attempt_count,
            retryable: false,
            restart_required: outcome.restart_required,
        },
        Err(error) => {
            warn!(error = %error, command_id = %command.id, "verified Agent update failed");
            failure(command, attempt_count, now, "update_failed", true)
        }
    }
}

fn failure(
    command: AgentCommand,
    attempt_count: u32,
    completed_at_ms: i64,
    code: &str,
    retryable: bool,
) -> CommandExecution {
    CommandExecution {
        result: command_result(
            command.id.clone(),
            false,
            completed_at_ms,
            code,
            env!("CARGO_PKG_VERSION").to_owned(),
        ),
        command,
        attempt_count,
        retryable,
        restart_required: false,
    }
}

fn unix_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(i64::MAX)
}
