use alphaping_protocol::v1::{
    AgentCommand, AgentCommandResultStatus, AgentCommandType, MachineReport,
};
use serde::Deserialize;
use worker::{D1Database, wasm_bindgen::JsValue};

const MAX_COMMANDS_PER_ACK: usize = 8;

#[derive(Debug, Deserialize)]
struct CommandRow {
    id: String,
    #[serde(rename = "type")]
    command_type: String,
    payload_json: String,
    not_before: f64,
    expires_at: f64,
    attempt_limit: f64,
    payload_schema_version: f64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommandPayload {
    #[serde(default)]
    version: String,
    #[serde(default)]
    bypass_rollout: bool,
}

fn text(value: &str) -> JsValue {
    JsValue::from_str(value)
}

fn number(value: i64) -> JsValue {
    JsValue::from_f64(value as f64)
}

pub async fn persist_command_results(
    db: &D1Database,
    agent_id: &str,
    report: &MachineReport,
) -> worker::Result<()> {
    if report.command_results.is_empty() {
        return Ok(());
    }
    let mut statements = Vec::with_capacity(report.command_results.len());
    for result in &report.command_results {
        let status = AgentCommandResultStatus::try_from(result.status)
            .map_err(|_| worker::Error::RustError("invalid_command_result".to_owned()))?;
        let state = match status {
            AgentCommandResultStatus::Succeeded => "succeeded",
            AgentCommandResultStatus::Failed => "failed",
            AgentCommandResultStatus::Unspecified => {
                return Err(worker::Error::RustError(
                    "invalid_command_result".to_owned(),
                ));
            }
        };
        let result_json = serde_json::json!({
            "installedVersion": result.installed_version,
        })
        .to_string();
        statements.push(
            db.prepare(
                "UPDATE agent_commands SET state = ?, result_code = ?, result_json = ?,
                   completed_at = ?
                 WHERE id = ? AND agent_id = ? AND state IN ('pending', 'delivered')",
            )
            .bind(&[
                text(state),
                text(&result.result_code),
                text(&result_json),
                number(result.completed_at_ms),
                text(&result.command_id),
                text(agent_id),
            ])?,
        );
    }
    if !statements.is_empty() {
        db.batch(statements).await?;
    }
    Ok(())
}

pub async fn load_commands(
    db: &D1Database,
    agent_id: &str,
    now_ms: i64,
) -> worker::Result<Vec<AgentCommand>> {
    let rows = db
        .prepare(
            "SELECT id, type, payload_json, not_before, expires_at, attempt_limit,
                    payload_schema_version
             FROM agent_commands
             WHERE agent_id = ? AND state IN ('pending', 'delivered')
               AND not_before <= ? AND expires_at > ?
             ORDER BY created_at LIMIT ?",
        )
        .bind(&[
            text(agent_id),
            number(now_ms),
            number(now_ms),
            JsValue::from_f64(MAX_COMMANDS_PER_ACK as f64),
        ])?
        .all()
        .await?
        .results::<CommandRow>()?;
    let mut commands = Vec::with_capacity(rows.len());
    for row in &rows {
        let payload: CommandPayload = serde_json::from_str(&row.payload_json)
            .map_err(|_| worker::Error::RustError("invalid_agent_command".to_owned()))?;
        let command_type = match row.command_type.as_str() {
            "refresh_config" => AgentCommandType::RefreshConfig,
            "check_update" => AgentCommandType::CheckUpdate,
            "install_version" => AgentCommandType::InstallVersion,
            "redetect_runtimes" => AgentCommandType::RedetectRuntimes,
            _ => {
                return Err(worker::Error::RustError("invalid_agent_command".to_owned()));
            }
        };
        commands.push(AgentCommand {
            id: row.id.clone(),
            r#type: command_type as i32,
            not_before_ms: row.not_before as i64,
            expires_at_ms: row.expires_at as i64,
            attempt_limit: row.attempt_limit as u32,
            payload_schema_version: row.payload_schema_version as u32,
            requested_version: payload.version,
            bypass_rollout: payload.bypass_rollout,
        });
    }
    if !rows.is_empty() {
        let statements = rows
            .iter()
            .map(|row| {
                db.prepare(
                    "UPDATE agent_commands SET state = 'delivered',
                       delivered_at = COALESCE(delivered_at, ?), delivery_count = delivery_count + 1
                     WHERE id = ? AND agent_id = ? AND state IN ('pending', 'delivered')",
                )
                .bind(&[number(now_ms), text(&row.id), text(agent_id)])
            })
            .collect::<worker::Result<Vec<_>>>()?;
        db.batch(statements).await?;
    }
    Ok(commands)
}
