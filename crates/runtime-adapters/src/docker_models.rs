use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct DockerVersion {
    pub(crate) api_version: String,
    pub(crate) version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct ListContainer {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) names: Vec<String>,
    pub(crate) image: String,
    #[serde(default)]
    pub(crate) state: String,
    #[serde(default)]
    pub(crate) ports: Vec<DockerPort>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct DockerPort {
    pub(crate) private_port: u16,
    pub(crate) public_port: Option<u16>,
    #[serde(rename = "Type", default)]
    pub(crate) kind: String,
    #[serde(rename = "IP", default)]
    pub(crate) ip: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct InspectContainer {
    #[serde(default)]
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) restart_count: u64,
    #[serde(default)]
    pub(crate) state: InspectState,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct InspectState {
    pub(crate) status: Option<String>,
    pub(crate) started_at: Option<String>,
    pub(crate) exit_code: Option<i32>,
    pub(crate) health: Option<InspectHealth>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct InspectHealth {
    pub(crate) status: Option<String>,
}

#[derive(Default, Deserialize)]
pub(crate) struct ContainerStats {
    #[serde(default)]
    pub(crate) cpu_stats: CpuStats,
    #[serde(default)]
    pub(crate) precpu_stats: CpuStats,
    #[serde(default)]
    pub(crate) memory_stats: MemoryStats,
    #[serde(default)]
    pub(crate) networks: std::collections::HashMap<String, NetworkStats>,
}

#[derive(Default, Deserialize)]
pub(crate) struct CpuStats {
    #[serde(default)]
    pub(crate) cpu_usage: CpuUsage,
    #[serde(default)]
    pub(crate) system_cpu_usage: u64,
    #[serde(default)]
    pub(crate) online_cpus: u64,
}

#[derive(Default, Deserialize)]
pub(crate) struct CpuUsage {
    #[serde(default)]
    pub(crate) total_usage: u64,
}

#[derive(Default, Deserialize)]
pub(crate) struct MemoryStats {
    #[serde(default)]
    pub(crate) usage: u64,
    #[serde(default)]
    pub(crate) limit: u64,
}

#[derive(Default, Deserialize)]
pub(crate) struct NetworkStats {
    #[serde(default)]
    pub(crate) rx_bytes: u64,
    #[serde(default)]
    pub(crate) tx_bytes: u64,
}
