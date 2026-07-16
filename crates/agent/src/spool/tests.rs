use alphaping_protocol::{
    decompress_message, encode_message,
    v1::{
        AgentCommand, AgentCommandResult, AgentCommandResultStatus, AgentCommandType,
        AgentConfigSnapshot, ContainerCatalogEntry, ContainerInventory, MachineReport,
        MetricSample, ProbeResult, ProbeState,
    },
};
use tempfile::tempdir;

use super::Spool;

fn sample(observed_at_ms: i64) -> MetricSample {
    MetricSample {
        observed_at_ms,
        cpu_permille: 100,
        ..MetricSample::default()
    }
}

#[test]
fn ack_is_the_only_path_that_removes_a_delivery() {
    let directory = tempdir().expect("temp directory");
    let mut spool = Spool::open(directory.path().join("spool.db")).expect("open spool");
    for index in 0..6 {
        spool
            .append_sample(&sample(60_000 + index * 10_000), 120_000)
            .expect("append sample");
    }
    let report_id = spool
        .create_next_delivery(7, 2, 120_000)
        .expect("create delivery")
        .expect("delivery exists");
    assert_eq!(spool.delivery_count().expect("count"), 1);
    spool
        .mark_failure(&report_id, 130_000, "network")
        .expect("mark failure");
    assert_eq!(spool.delivery_count().expect("count"), 1);
    assert!(spool.acknowledge(&report_id).expect("ack"));
    assert_eq!(spool.delivery_count().expect("count"), 0);
}

#[test]
fn sequence_is_persisted_before_use() {
    let directory = tempdir().expect("temp directory");
    let path = directory.path().join("spool.db");
    let mut spool = Spool::open(&path).expect("open spool");
    assert_eq!(spool.next_sequence().expect("sequence"), 1);
    drop(spool);
    let mut reopened = Spool::open(&path).expect("reopen spool");
    assert_eq!(reopened.next_sequence().expect("sequence"), 2);
}

#[test]
fn catalog_is_resent_until_ack_then_metrics_remain_compact() {
    let directory = tempdir().expect("temp directory");
    let mut spool = Spool::open(directory.path().join("spool.db")).expect("open spool");
    for minute in [60_000_i64, 120_000_i64] {
        for index in 0..6 {
            spool
                .append_sample(&sample(minute + index * 10_000), minute + 60_000)
                .expect("append sample");
        }
        spool
            .append_container_inventory(
                &ContainerInventory {
                    observed_at_ms: minute + 5_000,
                    catalog_digest: vec![7; 32],
                    catalog: vec![ContainerCatalogEntry {
                        container_key: vec![3; 16],
                        name: "api".to_owned(),
                        ..ContainerCatalogEntry::default()
                    }],
                    catalog_included: true,
                    ..ContainerInventory::default()
                },
                minute + 60_000,
            )
            .expect("append inventory");
    }

    let first_id = spool
        .create_next_delivery(7, 2, 180_000)
        .expect("create first")
        .expect("first delivery");
    let first = spool
        .due_delivery(180_000)
        .expect("read first")
        .expect("first due");
    let first_report: MachineReport =
        decompress_message(&first.payload).expect("decode first report");
    assert_eq!(
        first_report
            .container_inventory
            .as_ref()
            .expect("first inventory")
            .catalog
            .len(),
        1
    );
    assert!(spool.acknowledge(&first_id).expect("ack first"));

    let second_id = spool
        .create_next_delivery(7, 2, 180_000)
        .expect("create second")
        .expect("second delivery");
    let second = spool
        .due_delivery(180_000)
        .expect("read second")
        .expect("second due");
    let second_report: MachineReport =
        decompress_message(&second.payload).expect("decode second report");
    assert!(
        second_report
            .container_inventory
            .as_ref()
            .expect("second inventory")
            .catalog
            .is_empty()
    );
    assert!(spool.acknowledge(&second_id).expect("ack second"));

    for index in 0..6 {
        spool
            .append_sample(&sample(180_000 + index * 10_000), 240_000)
            .expect("append third sample");
    }
    spool
        .append_container_inventory(
            &ContainerInventory {
                observed_at_ms: 185_000,
                catalog_digest: vec![8; 32],
                catalog_included: true,
                ..ContainerInventory::default()
            },
            240_000,
        )
        .expect("append empty inventory");
    spool
        .create_next_delivery(7, 2, 240_000)
        .expect("create third")
        .expect("third delivery");
    let third = spool
        .due_delivery(240_000)
        .expect("read third")
        .expect("third due");
    let third_report: MachineReport =
        decompress_message(&third.payload).expect("decode third report");
    let third_inventory = third_report.container_inventory.expect("third inventory");
    assert!(third_inventory.catalog_included);
    assert!(third_inventory.catalog.is_empty());
}

#[test]
fn probe_config_and_results_are_durable_until_report_ack() {
    let directory = tempdir().expect("temp directory");
    let path = directory.path().join("spool.db");
    let mut spool = Spool::open(&path).expect("open spool");
    let mut config = AgentConfigSnapshot {
        revision: 4,
        probe_tasks: Vec::new(),
        created_at_ms: 120_000,
        digest: Vec::new(),
    };
    config.digest = blake3::hash(&encode_message(&config)).as_bytes().to_vec();
    assert!(
        spool
            .apply_probe_config(&config, 120_000)
            .expect("apply config")
    );
    assert_eq!(spool.load_probe_config().expect("load config").revision, 4);
    let result = ProbeResult {
        execution_id: vec![8; 32],
        check_id: "018f5f7e-7d28-7e12-a521-23456789abcd".to_owned(),
        check_pk: 11,
        service_pk: 12,
        workspace_pk: 2,
        executor_agent_id: "agent-1".to_owned(),
        config_revision: 4,
        nominal_slot_ms: 60_000,
        observed_at_ms: 61_000,
        state: ProbeState::Healthy as i32,
        latency_ms: Some(10),
        ..ProbeResult::default()
    };
    assert!(
        spool
            .append_probe_result(&result, 120_000)
            .expect("append result")
    );
    for index in 0..6 {
        spool
            .append_sample(&sample(60_000 + index * 10_000), 120_000)
            .expect("append sample");
    }
    let report_id = spool
        .create_next_delivery(7, 2, 120_000)
        .expect("create delivery")
        .expect("delivery");
    let delivery = spool
        .due_delivery(120_000)
        .expect("read delivery")
        .expect("due delivery");
    let report: MachineReport = decompress_message(&delivery.payload).expect("decode report");
    assert_eq!(report.applied_config_revision, 4);
    assert_eq!(report.probe_results, vec![result]);
    drop(spool);

    let mut reopened = Spool::open(&path).expect("reopen spool");
    assert_eq!(reopened.delivery_count().expect("count"), 1);
    assert!(reopened.acknowledge(&report_id).expect("ack"));
    assert_eq!(reopened.delivery_count().expect("count"), 0);
}

#[test]
fn command_side_effect_and_result_are_deduplicated_until_durable_ack() {
    let directory = tempdir().expect("temp directory");
    let path = directory.path().join("spool.db");
    let mut spool = Spool::open(&path).expect("open spool");
    let command = AgentCommand {
        id: "018f5f7e-7d28-7e12-a521-23456789abcd".to_owned(),
        r#type: AgentCommandType::CheckUpdate as i32,
        not_before_ms: 60_000,
        expires_at_ms: 3_600_000,
        attempt_limit: 3,
        payload_schema_version: 1,
        requested_version: String::new(),
        bypass_rollout: false,
    };
    assert_eq!(
        spool
            .accept_commands(std::slice::from_ref(&command), 60_000)
            .expect("accept command"),
        1
    );
    assert_eq!(
        spool
            .accept_commands(std::slice::from_ref(&command), 60_000)
            .expect("deduplicate command"),
        0
    );
    let pending = spool
        .due_command(60_000)
        .expect("read command")
        .expect("pending command");
    assert_eq!(pending.command, command);
    assert_eq!(
        spool
            .mark_command_attempt(&command.id, 90_000)
            .expect("mark attempt"),
        1
    );
    let result = AgentCommandResult {
        command_id: command.id.clone(),
        status: AgentCommandResultStatus::Succeeded as i32,
        completed_at_ms: 65_000,
        result_code: "up_to_date".to_owned(),
        installed_version: "0.1.0".to_owned(),
    };
    spool.complete_command(&result).expect("complete command");
    for index in 0..6 {
        spool
            .append_sample(&sample(60_000 + index * 10_000), 120_000)
            .expect("append sample");
    }
    let report_id = spool
        .create_next_delivery(7, 2, 120_000)
        .expect("create report")
        .expect("report id");
    let delivery = spool
        .due_delivery(120_000)
        .expect("read report")
        .expect("pending report");
    let report: MachineReport = decompress_message(&delivery.payload).expect("decode report");
    assert_eq!(report.command_results, vec![result]);
    assert!(
        spool
            .due_command(120_000)
            .expect("read completed")
            .is_none()
    );
    assert!(spool.acknowledge(&report_id).expect("ack report"));
}
