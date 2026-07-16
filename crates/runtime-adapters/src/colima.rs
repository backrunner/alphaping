use std::time::Duration;

use serde::Deserialize;

use crate::{
    ContainerHealth, ContainerRecord, ContainerState, RuntimeAvailability, RuntimeKind,
    RuntimeStatus,
    command::{CommandError, run},
};

pub fn collect() -> (Vec<RuntimeStatus>, Vec<ContainerRecord>) {
    let output = match run(
        "colima",
        &["list", "--json"],
        Duration::from_secs(3),
        256 * 1024,
    ) {
        Ok(output) => output,
        Err(CommandError::NotFound) => {
            return (
                vec![status(RuntimeAvailability::Absent, "cli_absent")],
                Vec::new(),
            );
        }
        Err(CommandError::PermissionDenied) => {
            return (
                vec![status(
                    RuntimeAvailability::PermissionDenied,
                    "permission_denied",
                )],
                Vec::new(),
            );
        }
        Err(_) => {
            return (
                vec![status(RuntimeAvailability::Error, "list_failed")],
                Vec::new(),
            );
        }
    };
    let profiles = match parse_profiles(&output.stdout) {
        Some(profiles) => profiles,
        None => {
            return (
                vec![status(
                    RuntimeAvailability::Incompatible,
                    "list_incompatible",
                )],
                Vec::new(),
            );
        }
    };
    let mut runtimes = Vec::new();
    let mut containers = Vec::new();
    let mut found = false;
    for profile in profiles
        .into_iter()
        .filter(|profile| profile.runtime == "containerd")
    {
        found = true;
        let availability = if profile.status == "Running" || profile.status == "running" {
            RuntimeAvailability::Available
        } else {
            RuntimeAvailability::Stopped
        };
        let mut runtime = RuntimeStatus {
            kind: RuntimeKind::ColimaContainerd,
            instance: bounded(&profile.name, 64),
            availability,
            version: String::new(),
            detail_code: if availability == RuntimeAvailability::Stopped {
                "profile_stopped".to_owned()
            } else {
                String::new()
            },
        };
        if availability == RuntimeAvailability::Available {
            match collect_profile(&runtime.instance) {
                Ok(mut found_containers) => containers.append(&mut found_containers),
                Err(error) => {
                    runtime.availability = command_availability(&error);
                    runtime.detail_code = command_detail(&error).to_owned();
                }
            }
        }
        runtimes.push(runtime);
    }
    if !found {
        runtimes.push(status(RuntimeAvailability::Absent, "profile_absent"));
    }
    (runtimes, containers)
}

fn status(availability: RuntimeAvailability, detail: &str) -> RuntimeStatus {
    RuntimeStatus {
        kind: RuntimeKind::ColimaContainerd,
        instance: "profiles".to_owned(),
        availability,
        version: String::new(),
        detail_code: detail.to_owned(),
    }
}

fn collect_profile(profile: &str) -> Result<Vec<ContainerRecord>, CommandError> {
    if !valid_profile(profile) {
        return Err(CommandError::Failed);
    }
    let output = run(
        "colima",
        &[
            "nerdctl",
            "--profile",
            profile,
            "--",
            "ps",
            "--all",
            "--format",
            "{{json .}}",
        ],
        Duration::from_secs(4),
        1024 * 1024,
    )?;
    parse_nerdctl(&output.stdout, profile).ok_or(CommandError::Failed)
}

fn valid_profile(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn command_availability(error: &CommandError) -> RuntimeAvailability {
    match error {
        CommandError::NotFound => RuntimeAvailability::Incompatible,
        CommandError::PermissionDenied => RuntimeAvailability::PermissionDenied,
        CommandError::Timeout => RuntimeAvailability::Error,
        CommandError::Failed | CommandError::OutputTooLarge | CommandError::Io => {
            RuntimeAvailability::Error
        }
    }
}

fn command_detail(error: &CommandError) -> &'static str {
    match error {
        CommandError::NotFound => "nerdctl_absent",
        CommandError::PermissionDenied => "permission_denied",
        CommandError::Timeout => "query_timeout",
        CommandError::OutputTooLarge => "response_too_large",
        CommandError::Failed | CommandError::Io => "query_failed",
    }
}

fn parse_profiles(bytes: &[u8]) -> Option<Vec<ColimaProfile>> {
    if let Ok(profiles) = serde_json::from_slice::<Vec<ColimaProfile>>(bytes) {
        return Some(profiles);
    }
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    serde_json::from_value(value.get("profiles")?.clone()).ok()
}

fn parse_nerdctl(bytes: &[u8], profile: &str) -> Option<Vec<ContainerRecord>> {
    let text = std::str::from_utf8(bytes).ok()?;
    let mut records = Vec::new();
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let item: NerdctlContainer = serde_json::from_str(line).ok()?;
        let id = bounded(&item.id, 128);
        if id.is_empty() {
            continue;
        }
        records.push(ContainerRecord {
            key: ContainerRecord::stable_key(RuntimeKind::ColimaContainerd, profile, &id),
            runtime: RuntimeKind::ColimaContainerd,
            runtime_instance: profile.to_owned(),
            runtime_container_id: id,
            name: bounded(&item.names, 128),
            image: bounded(&item.image, 512),
            state: parse_state(&item.state, &item.status),
            health: ContainerHealth::None,
            started_at_ms: 0,
            restart_count: 0,
            cpu_permille: 0,
            memory_used_bytes: 0,
            memory_limit_bytes: 0,
            network_rx_bytes_per_second: 0,
            network_tx_bytes_per_second: 0,
            network_rx_bytes_total: 0,
            network_tx_bytes_total: 0,
            ports: Vec::new(),
            exit_code: 0,
        });
    }
    Some(records)
}

fn parse_state(state: &str, status: &str) -> ContainerState {
    let value = if state.is_empty() { status } else { state };
    match value.to_ascii_lowercase().as_str() {
        value if value.contains("running") || value == "up" => ContainerState::Running,
        value if value.contains("paused") => ContainerState::Paused,
        value if value.contains("created") => ContainerState::Created,
        value if value.contains("exited") || value.contains("stopped") => ContainerState::Exited,
        _ => ContainerState::Unknown,
    }
}

fn bounded(value: &str, maximum: usize) -> String {
    value.chars().take(maximum).collect()
}

#[derive(Deserialize)]
struct ColimaProfile {
    #[serde(default)]
    name: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    runtime: String,
}

#[derive(Deserialize)]
struct NerdctlContainer {
    #[serde(rename = "ID", alias = "Id", alias = "id", default)]
    id: String,
    #[serde(rename = "Names", alias = "Name", alias = "names", default)]
    names: String,
    #[serde(rename = "Image", alias = "image", default)]
    image: String,
    #[serde(rename = "State", alias = "state", default)]
    state: String,
    #[serde(rename = "Status", alias = "status", default)]
    status: String,
}

#[cfg(test)]
mod tests {
    use super::{parse_nerdctl, parse_profiles};

    #[test]
    fn parses_colima_profile_and_line_delimited_containers() {
        let profiles =
            parse_profiles(br#"[{"name":"default","status":"Running","runtime":"containerd"}]"#)
                .expect("profiles");
        assert_eq!(profiles.len(), 1);
        let containers = parse_nerdctl(
            b"{\"ID\":\"abc123def456\",\"Names\":\"api\",\"Image\":\"api:1\",\"State\":\"running\"}\n",
            "default",
        )
        .expect("containers");
        assert_eq!(containers.len(), 1);
        assert_eq!(containers[0].name, "api");
    }
}
