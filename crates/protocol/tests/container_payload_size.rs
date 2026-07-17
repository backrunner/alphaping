use alphaping_protocol::{
    compress_message,
    v1::{
        ContainerCatalogEntry, ContainerInventory, ContainerMetric, ContainerPort, MachineReport,
        MetricSample, RuntimeSnapshot,
    },
};

fn report(container_count: usize, include_catalog: bool) -> MachineReport {
    let metrics = (0..container_count)
        .map(|index| ContainerMetric {
            container_key: blake3::hash(format!("container-{index}").as_bytes()).as_bytes()[..16]
                .to_vec(),
            state: 2,
            health: 3,
            started_at_ms: 1_752_574_000_000 + index as i64,
            restart_count: index as u32 % 4,
            cpu_permille: 50 + index as u32,
            memory_used_bytes: 128 * 1024 * 1024 + index as u64 * 4_096,
            memory_limit_bytes: 512 * 1024 * 1024,
            network_rx_bytes_per_second: 4_096 + index as u64,
            network_tx_bytes_per_second: 2_048 + index as u64,
            network_rx_bytes_total: 1_000_000 + index as u64 * 10_000,
            network_tx_bytes_total: 500_000 + index as u64 * 5_000,
            ports: vec![ContainerPort {
                private_port: 8_000 + index as u32,
                public_port: 18_000 + index as u32,
                protocol: "tcp".to_owned(),
                host_ip: String::new(),
            }],
            exit_code: 0,
        })
        .collect::<Vec<_>>();
    let catalog = if include_catalog {
        metrics
            .iter()
            .enumerate()
            .map(|(index, metric)| ContainerCatalogEntry {
                container_key: metric.container_key.clone(),
                runtime: 1,
                runtime_instance: "default".to_owned(),
                runtime_container_id: format!("{index:064x}"),
                name: format!("service-{index}"),
                image: format!("registry.example/operations/service-{index}:2026.07.17"),
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    MachineReport {
        report_id: vec![9; 16],
        machine_pk: 1,
        workspace_pk: 1,
        nominal_minute_ms: 1_752_574_800_000,
        samples: (0..6)
            .map(|index| MetricSample {
                observed_at_ms: 1_752_574_800_000 + index * 10_000,
                cpu_permille: 350,
                memory_used_bytes: 4 * 1024 * 1024 * 1024,
                memory_total_bytes: 8 * 1024 * 1024 * 1024,
                storage_used_bytes: 100 * 1024 * 1024 * 1024,
                storage_total_bytes: 200 * 1024 * 1024 * 1024,
                network_rx_bytes_per_second: 12_000,
                network_tx_bytes_per_second: 8_000,
                network_rx_bytes_total: 8_000_000,
                network_tx_bytes_total: 4_000_000,
                load_1m_milli: Some(1_250),
                uptime_seconds: Some(86_400 + u64::try_from(index).unwrap_or_default()),
            })
            .collect(),
        schema_version: 2,
        container_inventory: Some(ContainerInventory {
            observed_at_ms: 1_752_574_805_000,
            catalog_digest: vec![7; 32],
            runtimes: vec![RuntimeSnapshot {
                kind: 1,
                instance: "default".to_owned(),
                availability: 1,
                version: "28.3.2".to_owned(),
                detail_code: String::new(),
            }],
            catalog,
            metrics,
            catalog_included: include_catalog,
        }),
        probe_results: Vec::new(),
        applied_config_revision: 0,
        command_results: Vec::new(),
        agent_version: "0.1.0".to_owned(),
    }
}

#[test]
fn routine_container_metrics_stay_within_storage_budget() {
    let ten = compress_message(&report(10, false)).expect("ten-container report");
    let maximum = compress_message(&report(64, false)).expect("maximum routine report");
    assert!(
        ten.len() <= 2 * 1024,
        "ten-container report was {} bytes",
        ten.len()
    );
    assert!(
        maximum.len() <= 8 * 1024,
        "maximum routine report was {} bytes",
        maximum.len()
    );
}

#[test]
fn changed_catalog_stays_below_envelope_budget() {
    let changed = compress_message(&report(64, true)).expect("catalog report");
    assert!(
        changed.len() <= 16 * 1024,
        "catalog report was {} bytes",
        changed.len()
    );
}
