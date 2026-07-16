#![forbid(unsafe_code)]

mod apple_container;
mod colima;
mod command;
mod docker;
mod docker_http;
mod docker_models;
mod model;
mod time;

use std::collections::HashMap;

pub use model::{
    ContainerHealth, ContainerRecord, ContainerState, MAX_CONTAINERS, MAX_PORTS_PER_CONTAINER,
    PortBinding, RuntimeAvailability, RuntimeInventory, RuntimeKind, RuntimeStatus,
};

#[derive(Default)]
pub struct RuntimeCollector {
    previous_network: HashMap<[u8; 16], (i64, u64, u64)>,
}

impl RuntimeCollector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn collect(&mut self, observed_at_ms: i64) -> RuntimeInventory {
        let (mut runtimes, mut containers) = docker::collect();
        let (mut colima_runtimes, mut colima_containers) = colima::collect();
        runtimes.append(&mut colima_runtimes);
        containers.append(&mut colima_containers);
        let (apple_runtime, mut apple_containers) = apple_container::collect();
        runtimes.push(apple_runtime);
        containers.append(&mut apple_containers);
        for container in &mut containers {
            if let Some((previous_at, previous_rx, previous_tx)) =
                self.previous_network.get(&container.key)
            {
                let elapsed_ms = observed_at_ms.saturating_sub(*previous_at);
                if elapsed_ms > 0 {
                    container.network_rx_bytes_per_second = container
                        .network_rx_bytes_total
                        .saturating_sub(*previous_rx)
                        .saturating_mul(1_000)
                        / elapsed_ms as u64;
                    container.network_tx_bytes_per_second = container
                        .network_tx_bytes_total
                        .saturating_sub(*previous_tx)
                        .saturating_mul(1_000)
                        / elapsed_ms as u64;
                }
            }
        }
        self.previous_network = containers
            .iter()
            .map(|container| {
                (
                    container.key,
                    (
                        observed_at_ms,
                        container.network_rx_bytes_total,
                        container.network_tx_bytes_total,
                    ),
                )
            })
            .collect();
        let mut inventory = RuntimeInventory {
            observed_at_ms,
            runtimes,
            containers,
        };
        inventory.normalize();
        inventory
    }
}
