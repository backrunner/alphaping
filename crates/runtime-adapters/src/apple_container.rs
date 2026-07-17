use std::time::Duration;

use serde::Deserialize;

use crate::{
    ContainerHealth, ContainerRecord, ContainerState, RuntimeAvailability, RuntimeKind,
    RuntimeStatus,
    command::{CommandError, run},
    time::parse_rfc3339_ms,
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
        &["list", "--all"],
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
    if let Some(items) = parse_table(bytes) {
        return Some(items);
    }
    if let Ok(items) = serde_json::from_slice::<Vec<AppleContainer>>(bytes) {
        return Some(items);
    }
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    serde_json::from_value(value.get("containers")?.clone()).ok()
}

fn parse_table(bytes: &[u8]) -> Option<Vec<AppleContainer>> {
    let text = std::str::from_utf8(bytes).ok()?;
    let mut lines = text.lines().filter(|line| !line.trim().is_empty());
    let header = lines.next()?;
    let columns = header.split_ascii_whitespace().collect::<Vec<_>>();
    if columns
        != [
            "ID", "IMAGE", "OS", "ARCH", "STATE", "IP", "CPUS", "MEMORY", "STARTED",
        ]
    {
        return None;
    }
    lines
        .map(|line| {
            let values = line.split_ascii_whitespace().collect::<Vec<_>>();
            if values.len() != 10 {
                return None;
            }
            Some(AppleContainer {
                id: values[0].to_owned(),
                name: values[0].to_owned(),
                image: values[1].to_owned(),
                state: values[4].to_owned(),
                status: String::new(),
                started_at_ms: parse_rfc3339_ms(values[9]),
                restart_count: None,
                cpu_permille: None,
                memory_used_bytes: None,
                memory_limit_bytes: memory_bytes(values[7], values[8]),
                network_rx_bytes: None,
                network_tx_bytes: None,
                exit_code: None,
            })
        })
        .collect()
}

fn memory_bytes(value: &str, unit: &str) -> Option<u64> {
    let value = value.parse::<u64>().ok()?;
    let multiplier = match unit.to_ascii_uppercase().as_str() {
        "B" => 1,
        "KB" => 1_024,
        "MB" => 1_024 * 1_024,
        "GB" => 1_024 * 1_024 * 1_024,
        "TB" => 1_024_u64.pow(4),
        _ => return None,
    };
    value.checked_mul(multiplier)
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
    use super::{memory_bytes, parse_list};

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

    #[test]
    fn parses_apple_container_one_table_without_sensitive_configuration() {
        let output = b"ID        IMAGE                            OS     ARCH   STATE    IP                 CPUS  MEMORY   STARTED\napi       docker.io/example/api:1          linux  arm64  running  192.168.64.2/24    4     1024 MB  2026-07-17T02:12:35Z\nstopped   docker.io/example/worker:1       linux  arm64  stopped  -                  2     2 GB     2026-07-16T02:12:35Z\n";
        let items = parse_list(output).expect("Apple container 1.0 table");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "api");
        assert_eq!(items[0].image, "docker.io/example/api:1");
        assert_eq!(items[0].state, "running");
        assert_eq!(items[0].memory_limit_bytes, Some(1_073_741_824));
        assert!(items[0].started_at_ms.is_some());
        assert_eq!(items[1].state, "stopped");
        assert_eq!(memory_bytes("2", "GB"), Some(2_147_483_648));
    }
}
