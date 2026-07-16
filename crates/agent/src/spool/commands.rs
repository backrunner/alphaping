use alphaping_protocol::{
    decode_message, encode_message,
    v1::{AgentCommand, AgentCommandResult, AgentCommandType},
};
use anyhow::{Context, Result, bail};
use rusqlite::{OptionalExtension, params};
use uuid::Uuid;

use super::Spool;

#[derive(Debug, Clone)]
pub struct PendingCommand {
    pub command: AgentCommand,
    pub attempt_count: u32,
}

impl Spool {
    pub fn accept_commands(&mut self, commands: &[AgentCommand], now_ms: i64) -> Result<usize> {
        if commands.len() > 8 {
            bail!("server returned too many Agent commands");
        }
        let transaction = self.connection.transaction()?;
        let mut accepted = 0;
        for command in commands {
            validate_command(command, now_ms)?;
            accepted += transaction.execute(
                "INSERT OR IGNORE INTO agent_commands
                 (command_id, payload, state, attempt_count, attempt_limit, next_attempt_at,
                  created_at, updated_at)
                 VALUES (?, ?, 'pending', 0, ?, ?, ?, ?)",
                params![
                    command.id,
                    encode_message(command),
                    command.attempt_limit,
                    command.not_before_ms.max(now_ms),
                    now_ms,
                    now_ms
                ],
            )?;
        }
        transaction.commit()?;
        Ok(accepted)
    }

    pub fn due_command(&self, now_ms: i64) -> Result<Option<PendingCommand>> {
        self.connection
            .query_row(
                "SELECT payload, attempt_count FROM agent_commands
                 WHERE state IN ('pending', 'running') AND next_attempt_at <= ?
                   AND attempt_count < attempt_limit
                 ORDER BY next_attempt_at, created_at LIMIT 1",
                [now_ms],
                |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, u32>(1)?)),
            )
            .optional()?
            .map(|(payload, attempt_count)| {
                Ok(PendingCommand {
                    command: decode_message(&payload)?,
                    attempt_count,
                })
            })
            .transpose()
    }

    pub fn mark_command_attempt(&self, command_id: &str, retry_at_ms: i64) -> Result<u32> {
        let attempt_count = self
            .connection
            .query_row(
                "UPDATE agent_commands SET state = 'running', attempt_count = attempt_count + 1,
                   next_attempt_at = ?, updated_at = ?
                 WHERE command_id = ? AND state IN ('pending', 'running')
                 RETURNING attempt_count",
                params![retry_at_ms, retry_at_ms, command_id],
                |row| row.get::<_, u32>(0),
            )
            .optional()?
            .context("Agent command is no longer pending")?;
        Ok(attempt_count)
    }

    pub fn complete_command(&mut self, result: &AgentCommandResult) -> Result<()> {
        let transaction = self.connection.transaction()?;
        let changed = transaction.execute(
            "UPDATE agent_commands SET state = 'completed', updated_at = ?
             WHERE command_id = ? AND state IN ('pending', 'running')",
            params![result.completed_at_ms, result.command_id],
        )?;
        if changed == 0 {
            bail!("Agent command is not pending");
        }
        transaction.execute(
            "INSERT INTO agent_command_results (command_id, payload, completed_at)
             VALUES (?, ?, ?)
             ON CONFLICT(command_id) DO UPDATE SET payload = excluded.payload,
               completed_at = excluded.completed_at",
            params![
                result.command_id,
                encode_message(result),
                result.completed_at_ms
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }
}

fn validate_command(command: &AgentCommand, now_ms: i64) -> Result<()> {
    let command_type = AgentCommandType::try_from(command.r#type)
        .map_err(|_| anyhow::anyhow!("Agent command type is invalid"))?;
    if command_type == AgentCommandType::Unspecified
        || Uuid::parse_str(&command.id).is_err()
        || command.not_before_ms > command.expires_at_ms
        || command.expires_at_ms <= now_ms.saturating_sub(300_000)
        || command.expires_at_ms > now_ms.saturating_add(24 * 60 * 60 * 1_000)
        || !(1..=5).contains(&command.attempt_limit)
        || command.payload_schema_version != 1
        || command.requested_version.len() > 64
        || !command.requested_version.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '+')
        })
    {
        bail!("Agent command fields are invalid");
    }
    if command_type == AgentCommandType::InstallVersion && command.requested_version.is_empty() {
        bail!("install-version command omitted the version");
    }
    if !matches!(
        command_type,
        AgentCommandType::CheckUpdate | AgentCommandType::InstallVersion
    ) && (!command.requested_version.is_empty() || command.bypass_rollout)
    {
        bail!("Agent command payload is not valid for its type");
    }
    Ok(())
}
