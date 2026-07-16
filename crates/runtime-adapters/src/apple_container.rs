use std::time::Duration;

use serde::Deserialize;

use crate::{
    ContainerHealth, ContainerRecord, ContainerState, RuntimeAvailability, RuntimeKind,
    RuntimeStatus,
    command::{CommandError, run},
};

pub fn collect() -> (RuntimeStatus, Vec<ContainerRecord>) {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return (
            RuntimeStatus {
                kind: RuntimeKind::AppleContainer,
                instance: "default".to_owned(),
                availability: RuntimeAvailability::Absent,
                version: String::new(),
                detail_code: "unsupported_platform".to_owned(),
            },
            Vec::new(),
        );
    }
    let version = match run(
        "container",
        &["--version"],
        Duration::from_secs(2),
        4 * 1024,
    ) {
        Ok(output) => bounded(
            std::str::from_utf8(&output.stdout)
                .unwrap_or_default()
                .trim(),
            64,
        ),
        Err(error) => return (error_status(error), Vec::new()),
    };
    let output = match run(
        "container",
        &["list", "--all", "--format", "json"],
        Duration::from_secs(4),
        1024 * 1024,
    ) {
        Ok(output) => output,
        Err(error) => return (error_status(error), Vec::new()),
    };
    let Some(items) = parse_list(&output.stdout) else {
        return (
            RuntimeStatus {
                kind: RuntimeKind::AppleContainer,
                instance: "default".to_owned(),
                availability: RuntimeAvailability::Incompatible,
                version,
                detail_code: "list_incompatible".to_owned(),
            },
            Vec::new(),
        );
    };
    let containers = items
        .into_iter()
        .take(crate::MAX_CONTAINERS)
        .filter_map(to_record)
        .collect();
    (
        RuntimeStatus {
            kind: RuntimeKind::AppleContainer,
            instance: "default".to_owned(),
            availability: RuntimeAvailability::Available,
            version,
            detail_code: String::new(),
        },
        containers,
    )
}

fn error_status(error: CommandError) -> RuntimeStatus {
    let (availability, detail) = match error {
        CommandError::NotFound => (RuntimeAvailability::Absent, "cli_absent"),
        CommandError::PermissionDenied => {
            (RuntimeAvailability::PermissionDenied, "permission_denied")
        }
        CommandError::Failed => (RuntimeAvailability::Stopped, "service_stopped"),
        CommandError::Timeout => (RuntimeAvailability::Error, "query_timeout"),
        CommandError::OutputTooLarge => (RuntimeAvailability::Incompatible, "response_too_large"),
        CommandError::Io => (RuntimeAvailability::Error, "query_failed"),
    };
    RuntimeStatus {
        kind: RuntimeKind::AppleContainer,
        instance: "default".to_owned(),
        availability,
        version: String::new(),
        detail_code: detail.to_owned(),
    }
}

fn parse_list(bytes: &[u8]) -> Option<Vec<AppleContainer>> {
    if let Ok(items) = serde_json::from_slice::<Vec<AppleContainer>>(bytes) {
        return Some(items);
    }
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    serde_json::from_value(value.get("containers")?.clone()).ok()
}

fn to_record(item: AppleContainer) -> Option<ContainerRecord> {
    let id = bounded(&item.id, 128);
    if id.is_empty() {
        return None;
    }
    Some(ContainerRecord {
        key: ContainerRecord::stable_key(RuntimeKind::AppleContainer, "default", &id),
        runtime: RuntimeKind::AppleContainer,
        runtime_instance: "default".to_owned(),
        runtime_container_id: id,
        name: bounded(&item.name, 128),
        image: bounded(&item.image, 512),
        state: parse_state(&item.state, &item.status),
        health: ContainerHealth::None,
        started_at_ms: item.started_at_ms.unwrap_or_default(),
        restart_count: item.restart_count.unwrap_or_default(),
        cpu_permille: item.cpu_permille.unwrap_or_default(),
        memory_used_bytes: item.memory_used_bytes.unwrap_or_default(),
        memory_limit_bytes: item.memory_limit_bytes.unwrap_or_default(),
        network_rx_bytes_per_second: 0,
        network_tx_bytes_per_second: 0,
        network_rx_bytes_total: item.network_rx_bytes.unwrap_or_default(),
        network_tx_bytes_total: item.network_tx_bytes.unwrap_or_default(),
        ports: Vec::new(),
        exit_code: item.exit_code.unwrap_or_default(),
    })
}

fn parse_state(state: &str, status: &str) -> ContainerState {
    let value = if state.is_empty() { status } else { state };
    match value.to_ascii_lowercase().as_str() {
        "created" => ContainerState::Created,
        "running" => ContainerState::Running,
        "paused" => ContainerState::Paused,
        "restarting" => ContainerState::Restarting,
        "exited" | "stopped" => ContainerState::Exited,
        "dead" => ContainerState::Dead,
        _ => ContainerState::Unknown,
    }
}

fn bounded(value: &str, maximum: usize) -> String {
    value.chars().take(maximum).collect()
}

#[derive(Deserialize)]
struct AppleContainer {
    #[serde(default, alias = "identifier")]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    image: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    started_at_ms: Option<i64>,
    #[serde(default)]
    restart_count: Option<u32>,
    #[serde(default)]
    cpu_permille: Option<u32>,
    #[serde(default)]
    memory_used_bytes: Option<u64>,
    #[serde(default)]
    memory_limit_bytes: Option<u64>,
    #[serde(default)]
    network_rx_bytes: Option<u64>,
    #[serde(default)]
    network_tx_bytes: Option<u64>,
    #[serde(default)]
    exit_code: Option<i32>,
}

#[cfg(test)]
mod tests {
    use super::parse_list;

    #[test]
    fn accepts_array_and_wrapped_output() {
        assert_eq!(
            parse_list(br#"[{"id":"one","name":"api"}]"#)
                .expect("array")
                .len(),
            1
        );
        assert_eq!(
            parse_list(br#"{"containers":[{"id":"one","name":"api"}]}"#)
                .expect("wrapped")
                .len(),
            1
        );
    }
}
