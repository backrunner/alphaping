use std::{collections::HashSet, path::PathBuf};

use thiserror::Error;

use crate::{
    ContainerHealth, ContainerRecord, ContainerState, PortBinding, RuntimeAvailability,
    RuntimeKind, RuntimeStatus,
    docker_http::{DockerTransport, parse_host, request_json, transport_key},
    docker_models::{ContainerStats, DockerVersion, InspectContainer, ListContainer},
    time::parse_rfc3339_ms,
};

#[derive(Clone, Debug)]
struct DockerEndpoint {
    kind: RuntimeKind,
    instance: String,
    transport: DockerTransport,
}

#[derive(Debug, Error)]
pub(crate) enum DockerError {
    #[error("runtime is not available")]
    Unavailable,
    #[error("runtime access was denied")]
    PermissionDenied,
    #[error("runtime response was incompatible")]
    Incompatible,
    #[error("runtime request failed")]
    Io,
}

pub fn collect() -> (Vec<RuntimeStatus>, Vec<ContainerRecord>) {
    let endpoints = discover_endpoints();
    let mut runtimes = Vec::new();
    let mut containers = Vec::new();
    let has_docker = endpoints
        .iter()
        .any(|endpoint| endpoint.kind == RuntimeKind::Docker);
    let has_colima = endpoints
        .iter()
        .any(|endpoint| endpoint.kind == RuntimeKind::ColimaDocker);
    for endpoint in endpoints {
        match collect_endpoint(&endpoint) {
            Ok((version, mut found)) => {
                runtimes.push(RuntimeStatus {
                    kind: endpoint.kind,
                    instance: endpoint.instance,
                    availability: RuntimeAvailability::Available,
                    version,
                    detail_code: String::new(),
                });
                containers.append(&mut found);
            }
            Err(error) => runtimes.push(RuntimeStatus {
                kind: endpoint.kind,
                instance: endpoint.instance,
                availability: availability(&error),
                version: String::new(),
                detail_code: detail_code(&error).to_owned(),
            }),
        }
    }
    if !has_docker {
        runtimes.push(RuntimeStatus {
            kind: RuntimeKind::Docker,
            instance: "default".to_owned(),
            availability: RuntimeAvailability::Absent,
            version: String::new(),
            detail_code: "socket_absent".to_owned(),
        });
    }
    if !has_colima {
        runtimes.push(RuntimeStatus {
            kind: RuntimeKind::ColimaDocker,
            instance: "profiles".to_owned(),
            availability: RuntimeAvailability::Absent,
            version: String::new(),
            detail_code: "profile_absent".to_owned(),
        });
    }
    (runtimes, containers)
}

fn availability(error: &DockerError) -> RuntimeAvailability {
    match error {
        DockerError::Unavailable => RuntimeAvailability::Stopped,
        DockerError::PermissionDenied => RuntimeAvailability::PermissionDenied,
        DockerError::Incompatible => RuntimeAvailability::Incompatible,
        DockerError::Io => RuntimeAvailability::Error,
    }
}

fn detail_code(error: &DockerError) -> &'static str {
    match error {
        DockerError::Unavailable => "daemon_unavailable",
        DockerError::PermissionDenied => "permission_denied",
        DockerError::Incompatible => "api_incompatible",
        DockerError::Io => "request_failed",
    }
}

fn discover_endpoints() -> Vec<DockerEndpoint> {
    let mut endpoints = Vec::new();
    let mut seen = HashSet::new();
    if let Ok(host) = std::env::var("DOCKER_HOST")
        && let Some(transport) = parse_host(&host)
    {
        let key = transport_key(&transport);
        if seen.insert(key) {
            endpoints.push(DockerEndpoint {
                kind: RuntimeKind::Docker,
                instance: "environment".to_owned(),
                transport,
            });
        }
    }
    #[cfg(unix)]
    {
        let mut defaults = vec![PathBuf::from("/var/run/docker.sock")];
        if let Some(home) = home_directory() {
            defaults.push(home.join(".docker/run/docker.sock"));
        }
        for path in defaults.into_iter().filter(|path| path.exists()) {
            if seen.insert(format!("unix:{}", path.display())) {
                endpoints.push(DockerEndpoint {
                    kind: RuntimeKind::Docker,
                    instance: "default".to_owned(),
                    transport: DockerTransport::Unix(path),
                });
            }
        }
        if let Some(home) = home_directory() {
            let root = home.join(".colima");
            if let Ok(entries) = std::fs::read_dir(root) {
                for entry in entries.flatten() {
                    let profile = entry.file_name().to_string_lossy().into_owned();
                    if profile.starts_with('_') || !valid_instance(&profile) {
                        continue;
                    }
                    let socket = entry.path().join("docker.sock");
                    if socket.exists() && seen.insert(format!("unix:{}", socket.display())) {
                        endpoints.push(DockerEndpoint {
                            kind: RuntimeKind::ColimaDocker,
                            instance: profile,
                            transport: DockerTransport::Unix(socket),
                        });
                    }
                }
            }
        }
    }
    endpoints
}

fn home_directory() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn valid_instance(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn collect_endpoint(
    endpoint: &DockerEndpoint,
) -> Result<(String, Vec<ContainerRecord>), DockerError> {
    let version: DockerVersion = request_json(&endpoint.transport, "/version")?;
    if !valid_api_version(&version.api_version) {
        return Err(DockerError::Incompatible);
    }
    let list_path = format!("/v{}/containers/json?all=1", version.api_version);
    let listed: Vec<ListContainer> = request_json(&endpoint.transport, &list_path)?;
    let mut containers = Vec::new();
    for item in listed.into_iter().take(crate::MAX_CONTAINERS) {
        if !valid_container_id(&item.id) {
            continue;
        }
        let inspect_path = format!("/v{}/containers/{}/json", version.api_version, item.id);
        let stats_path = format!(
            "/v{}/containers/{}/stats?stream=false&one-shot=true",
            version.api_version, item.id
        );
        let inspect: InspectContainer =
            request_json(&endpoint.transport, &inspect_path).unwrap_or_default();
        let stats: ContainerStats =
            request_json(&endpoint.transport, &stats_path).unwrap_or_default();
        containers.push(to_record(endpoint, item, inspect, stats));
    }
    Ok((version.version, containers))
}

fn valid_api_version(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 16
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
}

fn valid_container_id(value: &str) -> bool {
    value.len() >= 12 && value.len() <= 128 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn to_record(
    endpoint: &DockerEndpoint,
    item: ListContainer,
    inspect: InspectContainer,
    stats: ContainerStats,
) -> ContainerRecord {
    let key = ContainerRecord::stable_key(endpoint.kind, &endpoint.instance, &item.id);
    let state = parse_state(
        &inspect
            .state
            .status
            .or(Some(item.state))
            .unwrap_or_default(),
    );
    let health = inspect
        .state
        .health
        .and_then(|health| health.status)
        .map_or(ContainerHealth::None, |health| parse_health(&health));
    let cpu_permille = cpu_permille(&stats);
    let (rx_total, tx_total) = stats
        .networks
        .values()
        .fold((0_u64, 0_u64), |total, network| {
            (
                total.0.saturating_add(network.rx_bytes),
                total.1.saturating_add(network.tx_bytes),
            )
        });
    ContainerRecord {
        key,
        runtime: endpoint.kind,
        runtime_instance: endpoint.instance.clone(),
        runtime_container_id: item.id,
        name: item
            .names
            .first()
            .map(|name| name.trim_start_matches('/').to_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| inspect.name.trim_start_matches('/').to_owned()),
        image: item.image,
        state,
        health,
        started_at_ms: inspect
            .state
            .started_at
            .as_deref()
            .and_then(parse_rfc3339_ms)
            .unwrap_or(0),
        restart_count: inspect.restart_count.min(u64::from(u32::MAX)) as u32,
        cpu_permille,
        memory_used_bytes: stats.memory_stats.usage,
        memory_limit_bytes: stats.memory_stats.limit,
        network_rx_bytes_per_second: 0,
        network_tx_bytes_per_second: 0,
        network_rx_bytes_total: rx_total,
        network_tx_bytes_total: tx_total,
        ports: item
            .ports
            .into_iter()
            .take(crate::MAX_PORTS_PER_CONTAINER)
            .map(|port| PortBinding {
                private_port: port.private_port,
                public_port: port.public_port,
                protocol: port.kind,
                host_ip: port.ip,
            })
            .collect(),
        exit_code: inspect.state.exit_code.unwrap_or_default(),
    }
}

fn parse_state(value: &str) -> ContainerState {
    match value {
        "created" => ContainerState::Created,
        "running" => ContainerState::Running,
        "paused" => ContainerState::Paused,
        "restarting" => ContainerState::Restarting,
        "exited" => ContainerState::Exited,
        "dead" => ContainerState::Dead,
        _ => ContainerState::Unknown,
    }
}

fn parse_health(value: &str) -> ContainerHealth {
    match value {
        "starting" => ContainerHealth::Starting,
        "healthy" => ContainerHealth::Healthy,
        "unhealthy" => ContainerHealth::Unhealthy,
        _ => ContainerHealth::Unknown,
    }
}

fn cpu_permille(stats: &ContainerStats) -> u32 {
    let cpu_delta = stats
        .cpu_stats
        .cpu_usage
        .total_usage
        .saturating_sub(stats.precpu_stats.cpu_usage.total_usage);
    let system_delta = stats
        .cpu_stats
        .system_cpu_usage
        .saturating_sub(stats.precpu_stats.system_cpu_usage);
    if cpu_delta == 0 || system_delta == 0 {
        return 0;
    }
    let online = stats.cpu_stats.online_cpus.max(1);
    let value = (cpu_delta as u128)
        .saturating_mul(u128::from(online))
        .saturating_mul(1_000)
        / u128::from(system_delta);
    value.min(u128::from(u32::MAX)) as u32
}
