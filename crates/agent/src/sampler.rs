use std::time::{Duration, Instant};

use alphaping_protocol::v1::MetricSample;
use sysinfo::{Disks, Networks, System};

pub struct Sampler {
    system: System,
    disks: Disks,
    networks: Networks,
    last_disk_list_refresh: Instant,
    last_network_refresh: Instant,
}

const DISK_LIST_REFRESH_INTERVAL: Duration = Duration::from_secs(60);

impl Sampler {
    pub fn new() -> Self {
        let mut system = System::new();
        system.refresh_cpu_usage();
        system.refresh_memory();
        Self {
            system,
            disks: Disks::new_with_refreshed_list(),
            networks: Networks::new_with_refreshed_list(),
            last_disk_list_refresh: Instant::now(),
            last_network_refresh: Instant::now(),
        }
    }

    pub fn sample(&mut self, observed_at_ms: i64) -> MetricSample {
        self.system.refresh_cpu_usage();
        self.system.refresh_memory();
        if self.last_disk_list_refresh.elapsed() >= DISK_LIST_REFRESH_INTERVAL {
            self.disks.refresh(true);
            self.last_disk_list_refresh = Instant::now();
        } else {
            for disk in &mut self.disks {
                disk.refresh();
            }
        }
        self.networks.refresh(true);
        let elapsed = self
            .last_network_refresh
            .elapsed()
            .max(Duration::from_millis(1));
        self.last_network_refresh = Instant::now();

        let (storage_total, storage_available) =
            self.disks.iter().fold((0_u64, 0_u64), |sum, disk| {
                (
                    sum.0.saturating_add(disk.total_space()),
                    sum.1.saturating_add(disk.available_space()),
                )
            });
        let (rx_delta, tx_delta, rx_total, tx_total) =
            self.networks
                .iter()
                .fold((0_u64, 0_u64, 0_u64, 0_u64), |sum, (_, network)| {
                    (
                        sum.0.saturating_add(network.received()),
                        sum.1.saturating_add(network.transmitted()),
                        sum.2.saturating_add(network.total_received()),
                        sum.3.saturating_add(network.total_transmitted()),
                    )
                });
        let elapsed_seconds = elapsed.as_secs_f64().max(0.001);
        let load_1m_milli = (System::load_average().one.max(0.0) * 1_000.0)
            .round()
            .min(f64::from(u32::MAX)) as u32;

        MetricSample {
            observed_at_ms,
            cpu_permille: (self.system.global_cpu_usage().clamp(0.0, 100.0) * 10.0).round() as u32,
            memory_used_bytes: self.system.used_memory(),
            memory_total_bytes: self.system.total_memory(),
            storage_used_bytes: storage_total.saturating_sub(storage_available),
            storage_total_bytes: storage_total,
            network_rx_bytes_per_second: (rx_delta as f64 / elapsed_seconds).round() as u64,
            network_tx_bytes_per_second: (tx_delta as f64 / elapsed_seconds).round() as u64,
            network_rx_bytes_total: rx_total,
            network_tx_bytes_total: tx_total,
            load_1m_milli: Some(load_1m_milli),
            uptime_seconds: Some(System::uptime()),
        }
    }
}

impl Default for Sampler {
    fn default() -> Self {
        Self::new()
    }
}
