use std::{
    sync::{Arc, RwLock, mpsc},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use alphaping_protocol::v1::{
    ContainerCatalogEntry, ContainerInventory, ContainerMetric, ContainerPort, RuntimeSnapshot,
};
use alphaping_runtime_adapters::{RuntimeCollector, RuntimeInventory};

pub struct ContainerMonitor {
    latest: Arc<RwLock<Option<ContainerInventory>>>,
    control: Option<mpsc::SyncSender<MonitorCommand>>,
    handle: Option<thread::JoinHandle<()>>,
}

enum MonitorCommand {
    Refresh,
}

impl ContainerMonitor {
    pub fn start() -> Self {
        let latest = Arc::new(RwLock::new(None));
        let thread_latest = Arc::clone(&latest);
        let (control, receiver) = mpsc::sync_channel(1);
        let handle = thread::Builder::new()
            .name("alphaping-containers".to_owned())
            .spawn(move || {
                let mut collector = RuntimeCollector::new();
                loop {
                    let inventory = to_protocol(collector.collect(unix_time_ms()));
                    if let Ok(mut current) = thread_latest.write() {
                        *current = Some(inventory);
                    }
                    match receiver.recv_timeout(Duration::from_secs(60)) {
                        Ok(MonitorCommand::Refresh) | Err(mpsc::RecvTimeoutError::Timeout) => {}
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            break;
                        }
                    }
                }
            })
            .ok();
        Self {
            latest,
            control: Some(control),
            handle,
        }
    }

    pub fn snapshot(&self) -> Option<ContainerInventory> {
        self.latest.read().ok().and_then(|latest| latest.clone())
    }

    pub fn refresh(&self) -> bool {
        self.control.as_ref().is_some_and(|control| {
            matches!(
                control.try_send(MonitorCommand::Refresh),
                Ok(()) | Err(mpsc::TrySendError::Full(_))
            )
        })
    }
}

impl Drop for ContainerMonitor {
    fn drop(&mut self) {
        self.control.take();
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn unix_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(i64::MAX)
}

fn to_protocol(inventory: RuntimeInventory) -> ContainerInventory {
    let catalog_digest = inventory.catalog_digest().to_vec();
    let runtimes = inventory
        .runtimes
        .into_iter()
        .map(|runtime| RuntimeSnapshot {
            kind: runtime.kind.protocol_value(),
            instance: runtime.instance,
            availability: runtime.availability.protocol_value(),
            version: runtime.version,
            detail_code: runtime.detail_code,
        })
        .collect();
    let mut catalog = Vec::with_capacity(inventory.containers.len());
    let mut metrics = Vec::with_capacity(inventory.containers.len());
    for container in inventory.containers {
        catalog.push(ContainerCatalogEntry {
            container_key: container.key.to_vec(),
            runtime: container.runtime.protocol_value(),
            runtime_instance: container.runtime_instance,
            runtime_container_id: container.runtime_container_id,
            name: container.name,
            image: container.image,
        });
        metrics.push(ContainerMetric {
            container_key: container.key.to_vec(),
            state: container.state.protocol_value(),
            health: container.health.protocol_value(),
            started_at_ms: container.started_at_ms,
            restart_count: container.restart_count,
            cpu_permille: container.cpu_permille,
            memory_used_bytes: container.memory_used_bytes,
            memory_limit_bytes: container.memory_limit_bytes,
            network_rx_bytes_per_second: container.network_rx_bytes_per_second,
            network_tx_bytes_per_second: container.network_tx_bytes_per_second,
            network_rx_bytes_total: container.network_rx_bytes_total,
            network_tx_bytes_total: container.network_tx_bytes_total,
            ports: container
                .ports
                .into_iter()
                .map(|port| ContainerPort {
                    private_port: u32::from(port.private_port),
                    public_port: port.public_port.map_or(0, u32::from),
                    protocol: port.protocol,
                    host_ip: port.host_ip,
                })
                .collect(),
            exit_code: container.exit_code,
        });
    }
    ContainerInventory {
        observed_at_ms: inventory.observed_at_ms,
        catalog_digest,
        runtimes,
        catalog,
        metrics,
        catalog_included: true,
    }
}
