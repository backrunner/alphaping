use blake3::Hasher;
use serde::{Deserialize, Serialize};

pub const MAX_CONTAINERS: usize = 64;
pub const MAX_PORTS_PER_CONTAINER: usize = 8;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub enum RuntimeKind {
    Docker,
    ColimaDocker,
    ColimaContainerd,
    AppleContainer,
}

impl RuntimeKind {
    pub const fn protocol_value(self) -> i32 {
        match self {
            Self::Docker => 1,
            Self::ColimaDocker => 2,
            Self::ColimaContainerd => 3,
            Self::AppleContainer => 4,
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::Docker => "docker",
            Self::ColimaDocker => "colima-docker",
            Self::ColimaContainerd => "colima-containerd",
            Self::AppleContainer => "apple-container",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RuntimeAvailability {
    Available,
    Absent,
    Stopped,
    PermissionDenied,
    Incompatible,
    Error,
}

impl RuntimeAvailability {
    pub const fn protocol_value(self) -> i32 {
        match self {
            Self::Available => 1,
            Self::Absent => 2,
            Self::Stopped => 3,
            Self::PermissionDenied => 4,
            Self::Incompatible => 5,
            Self::Error => 6,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ContainerState {
    Created,
    Running,
    Paused,
    Restarting,
    Exited,
    Dead,
    Unknown,
}

impl ContainerState {
    pub const fn protocol_value(self) -> i32 {
        match self {
            Self::Created => 1,
            Self::Running => 2,
            Self::Paused => 3,
            Self::Restarting => 4,
            Self::Exited => 5,
            Self::Dead => 6,
            Self::Unknown => 7,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ContainerHealth {
    None,
    Starting,
    Healthy,
    Unhealthy,
    Unknown,
}

impl ContainerHealth {
    pub const fn protocol_value(self) -> i32 {
        match self {
            Self::None => 1,
            Self::Starting => 2,
            Self::Healthy => 3,
            Self::Unhealthy => 4,
            Self::Unknown => 5,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RuntimeStatus {
    pub kind: RuntimeKind,
    pub instance: String,
    pub availability: RuntimeAvailability,
    pub version: String,
    pub detail_code: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct PortBinding {
    pub private_port: u16,
    pub public_port: Option<u16>,
    pub protocol: String,
    pub host_ip: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContainerRecord {
    pub key: [u8; 16],
    pub runtime: RuntimeKind,
    pub runtime_instance: String,
    pub runtime_container_id: String,
    pub name: String,
    pub image: String,
    pub state: ContainerState,
    pub health: ContainerHealth,
    pub started_at_ms: i64,
    pub restart_count: u32,
    pub cpu_permille: u32,
    pub memory_used_bytes: u64,
    pub memory_limit_bytes: u64,
    pub network_rx_bytes_per_second: u64,
    pub network_tx_bytes_per_second: u64,
    pub network_rx_bytes_total: u64,
    pub network_tx_bytes_total: u64,
    pub ports: Vec<PortBinding>,
    pub exit_code: i32,
}

impl ContainerRecord {
    pub fn stable_key(
        runtime: RuntimeKind,
        runtime_instance: &str,
        runtime_container_id: &str,
    ) -> [u8; 16] {
        let mut hasher = Hasher::new();
        hasher.update(b"alphaping/container/v1\0");
        hasher.update(runtime.label().as_bytes());
        hasher.update(b"\0");
        hasher.update(runtime_instance.as_bytes());
        hasher.update(b"\0");
        hasher.update(runtime_container_id.as_bytes());
        let mut key = [0_u8; 16];
        key.copy_from_slice(&hasher.finalize().as_bytes()[..16]);
        key
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct RuntimeInventory {
    pub observed_at_ms: i64,
    pub runtimes: Vec<RuntimeStatus>,
    pub containers: Vec<ContainerRecord>,
}

impl RuntimeInventory {
    pub fn normalize(&mut self) {
        self.runtimes
            .sort_by(|left, right| (left.kind, &left.instance).cmp(&(right.kind, &right.instance)));
        self.runtimes
            .dedup_by(|left, right| left.kind == right.kind && left.instance == right.instance);
        self.containers.sort_by_key(|container| container.key);
        self.containers.dedup_by_key(|container| container.key);
        self.containers.truncate(MAX_CONTAINERS);
        for container in &mut self.containers {
            container.ports.truncate(MAX_PORTS_PER_CONTAINER);
        }
    }

    pub fn catalog_digest(&self) -> [u8; 32] {
        let mut hasher = Hasher::new();
        hasher.update(b"alphaping/container-catalog/v1\0");
        for container in &self.containers {
            hasher.update(&container.key);
            hasher.update(container.runtime.label().as_bytes());
            hasher.update(b"\0");
            hasher.update(container.runtime_instance.as_bytes());
            hasher.update(b"\0");
            hasher.update(container.runtime_container_id.as_bytes());
            hasher.update(b"\0");
            hasher.update(container.name.as_bytes());
            hasher.update(b"\0");
            hasher.update(container.image.as_bytes());
            hasher.update(b"\0");
        }
        *hasher.finalize().as_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::{ContainerRecord, ContainerState, RuntimeInventory, RuntimeKind};

    #[test]
    fn catalog_digest_ignores_dynamic_metrics() {
        let key = ContainerRecord::stable_key(RuntimeKind::Docker, "default", "abc");
        let mut first = ContainerRecord {
            key,
            runtime: RuntimeKind::Docker,
            runtime_instance: "default".to_owned(),
            runtime_container_id: "abc".to_owned(),
            name: "api".to_owned(),
            image: "example/api:1".to_owned(),
            state: ContainerState::Running,
            health: super::ContainerHealth::Healthy,
            started_at_ms: 1,
            restart_count: 0,
            cpu_permille: 100,
            memory_used_bytes: 10,
            memory_limit_bytes: 20,
            network_rx_bytes_per_second: 1,
            network_tx_bytes_per_second: 2,
            network_rx_bytes_total: 3,
            network_tx_bytes_total: 4,
            ports: Vec::new(),
            exit_code: 0,
        };
        let first_digest = RuntimeInventory {
            observed_at_ms: 1,
            runtimes: Vec::new(),
            containers: vec![first.clone()],
        }
        .catalog_digest();
        first.cpu_permille = 900;
        first.restart_count = 2;
        let second_digest = RuntimeInventory {
            observed_at_ms: 2,
            runtimes: Vec::new(),
            containers: vec![first],
        }
        .catalog_digest();
        assert_eq!(first_digest, second_digest);
    }
}
