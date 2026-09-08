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

fn sample_count(spool: &Spool) -> u64 {
    spool
        .connection
        .query_row("SELECT COUNT(*) FROM samples", [], |row| {
            row.get::<_, u32>(0).map(u64::from)
        })
        .expect("count samples")
}

fn storage_pages(spool: &Spool) -> (u64, u64, u64) {
    let page_count = spool
        .connection
        .query_row("PRAGMA page_count", [], |row| {
            row.get::<_, u32>(0).map(u64::from)
        })
        .expect("page count");
    let free_pages = spool
        .connection
        .query_row("PRAGMA freelist_count", [], |row| {
            row.get::<_, u32>(0).map(u64::from)
        })
        .expect("free page count");
    let page_size = spool
        .connection
        .query_row("PRAGMA page_size", [], |row| {
            row.get::<_, u32>(0).map(u64::from)
        })
        .expect("page size");
    (page_count, free_pages, page_size)
}

#[test]
fn capacity_pressure_preserves_recent_unassigned_samples() {
    let directory = tempdir().expect("temp directory");
    let mut spool = Spool::open(directory.path().join("spool.db")).expect("open spool");
    let now = 10 * 86_400_000_i64;
    for index in 0..30 {
        spool
            .append_sample(&sample(now - 300_000 + index * 10_000), now)
            .expect("append recent sample");
    }
    let (pages, free_pages, page_size) = storage_pages(&spool);
    let live_bytes = pages.saturating_sub(free_pages).saturating_mul(page_size);
    let max_bytes = live_bytes.saturating_mul(5) / 4;

    let outcome = spool
        .enforce_capacity(max_bytes, now)
        .expect("enforce capacity");
    assert_eq!(outcome.compacted_samples, 0);
    assert_eq!(outcome.dropped_samples, 0);
    assert_eq!(sample_count(&spool), 30);
}

#[test]
fn capacity_pressure_compacts_old_samples_to_one_per_minute() {
    let directory = tempdir().expect("temp directory");
    let mut spool = Spool::open(directory.path().join("spool.db")).expect("open spool");
    let now = 10 * 86_400_000_i64;
    let start = now - 2 * 86_400_000;
    for index in 0..60 {
        spool
            .append_sample(&sample(start + index * 10_000), now)
            .expect("append old sample");
    }
    let (pages, free_pages, page_size) = storage_pages(&spool);
    let live_bytes = pages.saturating_sub(free_pages).saturating_mul(page_size);
    let max_bytes = live_bytes.saturating_mul(4) / 3;

    let outcome = spool
        .enforce_capacity(max_bytes, now)
        .expect("enforce capacity");
    assert_eq!(outcome.compacted_samples, 50);
    assert_eq!(outcome.dropped_samples, 0);
    assert_eq!(sample_count(&spool), 10);
}

#[test]
fn free_sqlite_pages_do_not_keep_the_spool_under_pressure() {
    let directory = tempdir().expect("temp directory");
    let mut spool = Spool::open(directory.path().join("spool.db")).expect("open spool");
    spool
        .connection
        .execute_batch(
            "WITH RECURSIVE sequence(value) AS (
               VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 256
             )
             INSERT INTO samples (sample_bucket, observed_at, payload, created_at)
             SELECT value, value, zeroblob(8192), value FROM sequence;
             DELETE FROM samples;",
        )
        .expect("create reusable SQLite pages");
    let now = 10 * 86_400_000_i64;
    spool
        .append_sample(&sample(now), now)
        .expect("append fresh sample");
    let (pages, free_pages, page_size) = storage_pages(&spool);
    assert!(free_pages > 0);
    let live_bytes = pages.saturating_sub(free_pages).saturating_mul(page_size);
    let max_bytes = live_bytes.saturating_mul(5) / 3;

    let outcome = spool
        .enforce_capacity(max_bytes, now)
        .expect("enforce recovered capacity");
    assert_eq!(outcome.compacted_samples, 0);
    assert_eq!(outcome.dropped_samples, 0);
    assert_eq!(sample_count(&spool), 1);
}

#[test]
fn new_spools_enable_incremental_vacuum() {
    let directory = tempdir().expect("temp directory");
    let spool = Spool::open(directory.path().join("spool.db")).expect("open spool");
    let mode: u32 = spool
        .connection
        .query_row("PRAGMA auto_vacuum", [], |row| row.get::<_, u32>(0))
        .expect("read auto vacuum mode");
    assert_eq!(mode, 2);
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
fn delivery_attempt_persists_sequence_and_retry_schedule_together() {
    let directory = tempdir().expect("temp directory");
    let mut spool = Spool::open(directory.path().join("spool.db")).expect("open spool");
    spool
        .append_sample(&sample(60_000), 120_000)
        .expect("append sample");
    let report_id = spool
        .create_next_delivery(7, 2, 120_000)
        .expect("create delivery")
        .expect("delivery exists");
    assert_eq!(
        spool
            .begin_delivery_attempt(&report_id, 130_000)
            .expect("begin delivery"),
        1
    );
    assert!(
        spool
            .due_delivery(129_999)
            .expect("read pending delivery")
            .is_none()
    );
    spool
        .reschedule_delivery(&report_id, 140_000, "local_config")
        .expect("reschedule delivery");
    assert!(
        spool
            .due_delivery(139_999)
            .expect("read rescheduled delivery")
            .is_none()
    );
    assert_eq!(
        spool
            .due_delivery(140_000)
            .expect("read retry delivery")
            .expect("retry delivery")
            .attempt_count,
        1
    );
}

#[test]
fn quarantined_delivery_is_preserved_without_blocking_newer_reports() {
    let directory = tempdir().expect("temp directory");
    let mut spool = Spool::open(directory.path().join("spool.db")).expect("open spool");
    spool
        .append_sample(&sample(60_000), 180_000)
        .expect("append first sample");
    let first_id = spool
        .create_next_delivery(7, 2, 180_000)
        .expect("create first delivery")
        .expect("first delivery");
    spool
        .quarantine_delivery(&first_id, "server_rejected_payload")
        .expect("quarantine delivery");
    spool
        .append_sample(&sample(120_000), 180_000)
        .expect("append second sample");
    let second_id = spool
        .create_next_delivery(7, 2, 180_000)
        .expect("create second delivery")
        .expect("second delivery");

    let due = spool
        .due_delivery(180_000)
        .expect("read newer delivery")
        .expect("newer delivery remains sendable");
    assert_eq!(due.report_id, second_id);
    assert_eq!(spool.delivery_count().expect("count deliveries"), 2);
    assert!(spool.acknowledge(&second_id).expect("ack newer delivery"));
    assert_eq!(spool.delivery_count().expect("quarantine remains"), 1);
    assert!(
        spool
            .due_delivery(i64::MAX)
            .expect("read pending deliveries")
            .is_none()
    );
}

#[test]
fn existing_spool_migrates_delivery_state_without_losing_rows() {
    let directory = tempdir().expect("temp directory");
    let path = directory.path().join("spool.db");
    let connection = rusqlite::Connection::open(&path).expect("open legacy spool");
    connection
        .execute_batch(
            "CREATE TABLE deliveries (
               report_id BLOB PRIMARY KEY NOT NULL,
               nominal_minute INTEGER NOT NULL UNIQUE,
               payload BLOB NOT NULL,
               payload_hash BLOB NOT NULL,
               created_at INTEGER NOT NULL,
               next_attempt_at INTEGER NOT NULL,
               attempt_count INTEGER NOT NULL DEFAULT 0,
               last_error_code TEXT
             ) WITHOUT ROWID;
             INSERT INTO deliveries
               (report_id, nominal_minute, payload, payload_hash, created_at, next_attempt_at)
             VALUES (x'01', 60000, x'02', x'03', 60000, 60000);",
        )
        .expect("create legacy delivery schema");
    drop(connection);

    let spool = Spool::open(&path).expect("migrate legacy spool");
    let state: String = spool
        .connection
        .query_row(
            "SELECT state FROM deliveries WHERE report_id = x'01'",
            [],
            |row| row.get(0),
        )
        .expect("read migrated delivery");
    assert_eq!(state, "pending");
}

#[test]
fn more_than_24_hours_of_deliveries_survive_restart_and_recover_in_order() {
    const MINUTES: i64 = 24 * 60 + 1;
    const SAMPLES_PER_MINUTE: i64 = 6;
    const MINUTE_MS: i64 = 60_000;
    const SAMPLE_INTERVAL_MS: i64 = 10_000;

    let directory = tempdir().expect("temp directory");
    let path = directory.path().join("spool.db");
    let first_minute = MINUTE_MS;
    let report_cutoff = (MINUTES + 1) * MINUTE_MS;
    let retry_at = report_cutoff + 300_000;
    let mut report_ids = Vec::with_capacity(usize::try_from(MINUTES).expect("minute count"));

    {
        let mut spool = Spool::open(&path).expect("open spool");
        for minute in 0..MINUTES {
            let nominal_minute = first_minute + minute * MINUTE_MS;
            for sample_index in 0..SAMPLES_PER_MINUTE {
                spool
                    .append_sample(
                        &sample(nominal_minute + sample_index * SAMPLE_INTERVAL_MS),
                        report_cutoff,
                    )
                    .expect("append offline sample");
            }
            let report_id = spool
                .create_next_delivery(7, 2, report_cutoff)
                .expect("create offline delivery")
                .expect("offline delivery exists");
            spool
                .mark_failure(&report_id, retry_at + 300_000, "network")
                .expect("mark offline delivery failure");
            report_ids.push(report_id);
        }
        assert_eq!(
            spool.delivery_count().expect("offline delivery count"),
            u64::try_from(MINUTES).expect("minute count")
        );
        assert!(
            spool
                .due_delivery(retry_at)
                .expect("read sleeping backlog")
                .is_none()
        );
    }

    let mut reopened = Spool::open(&path).expect("reopen spool after outage");
    assert_eq!(
        reopened
            .wake_backlog(retry_at, 4)
            .expect("wake offline backlog"),
        4
    );
    for (minute, expected_report_id) in report_ids.iter().enumerate() {
        let delivery = reopened
            .due_delivery(retry_at)
            .expect("read recovered delivery")
            .expect("recovered delivery exists");
        let expected_minute =
            first_minute + i64::try_from(minute).expect("minute index") * MINUTE_MS;
        assert_eq!(delivery.nominal_minute_ms, expected_minute);
        assert_eq!(&delivery.report_id, expected_report_id);
        assert_eq!(delivery.attempt_count, 1);

        let report: MachineReport =
            decompress_message(&delivery.payload).expect("decode recovered report");
        assert_eq!(report.nominal_minute_ms, expected_minute);
        assert_eq!(
            report.samples.len(),
            usize::try_from(SAMPLES_PER_MINUTE).unwrap()
        );
        assert_eq!(
            report
                .samples
                .iter()
                .map(|sample| sample.observed_at_ms)
                .collect::<Vec<_>>(),
            (0..SAMPLES_PER_MINUTE)
                .map(|sample_index| expected_minute + sample_index * SAMPLE_INTERVAL_MS)
                .collect::<Vec<_>>()
        );
        assert!(
            reopened
                .acknowledge(&delivery.report_id)
                .expect("ack recovered delivery")
        );
        let woken = reopened
            .wake_backlog(retry_at, 4)
            .expect("advance bounded recovery window");
        assert!(woken <= 4);
    }
    let last_minute = first_minute + (MINUTES - 1) * MINUTE_MS;
    assert!(last_minute - first_minute >= 24 * 60 * MINUTE_MS);
    assert_eq!(reopened.delivery_count().expect("final delivery count"), 0);
    assert!(
        reopened
            .due_delivery(retry_at)
            .expect("read empty backlog")
            .is_none()
    );
    assert_eq!(
        reopened
            .wake_backlog(retry_at, 4)
            .expect("empty recovery window"),
        0
    );
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
fn registered_agent_refuses_a_missing_spool() {
    let directory = tempdir().expect("temp directory");
    let path = directory.path().join("missing.db");
    assert!(Spool::open_existing(&path).is_err());
    assert!(!path.exists());
}

#[test]
fn enrollment_initializes_the_server_sequence_and_refuses_overwrite() {
    let directory = tempdir().expect("temp directory");
    let path = directory.path().join("spool.db");
    let mut spool = Spool::create(&path, 17).expect("create enrollment spool");
    assert_eq!(spool.transport_sequence().expect("stored sequence"), 16);
    assert_eq!(spool.next_sequence().expect("initial sequence"), 17);
    drop(spool);
    assert!(Spool::create(&path, 1).is_err());
}

#[test]
fn sequence_rollback_skips_the_reserved_range() {
    let directory = tempdir().expect("temp directory");
    let path = directory.path().join("spool.db");
    let mut spool = Spool::create(&path, 1).expect("create enrollment spool");
    assert_eq!(spool.next_sequence().expect("first sequence"), 1);
    assert_eq!(spool.next_sequence().expect("second sequence"), 2);
    spool
        .set_transport_sequence(1)
        .expect("simulate restored database");
    assert_eq!(
        spool
            .reconcile_sequence_checkpoint(2)
            .expect("reconcile reserved sequence"),
        2
    );
    assert_eq!(spool.next_sequence().expect("sequence after recovery"), 3);
}

#[test]
fn transport_sequence_stops_at_the_protocol_limit() {
    let directory = tempdir().expect("temp directory");
    let path = directory.path().join("spool.db");
    let mut spool =
        Spool::create(&path, alphaping_protocol::MAX_SEQUENCE).expect("create near-limit spool");
    assert_eq!(
        spool.next_sequence().expect("last safe sequence"),
        alphaping_protocol::MAX_SEQUENCE
    );
    assert!(spool.next_sequence().is_err());
}

#[test]
fn live_sequence_is_persisted_per_session_and_rotates_with_the_key() {
    let directory = tempfile::tempdir().expect("tempdir");
    let path = directory.path().join("spool.db");
    let mut spool = Spool::open(&path).expect("open spool");
    assert_eq!(spool.next_live_sequence(&[1; 16]).expect("first"), 1);
    assert_eq!(spool.next_live_sequence(&[1; 16]).expect("second"), 2);
    drop(spool);

    let mut reopened = Spool::open(&path).expect("reopen spool");
    assert_eq!(reopened.next_live_sequence(&[1; 16]).expect("persisted"), 3);
    assert_eq!(reopened.next_live_sequence(&[2; 16]).expect("rotated"), 1);
    assert!(reopened.next_live_sequence(&[3; 15]).is_err());
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
        sample_interval_seconds: Some(10),
        report_interval_seconds: Some(60),
        container_monitoring_enabled: Some(true),
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

#[test]
fn command_remains_due_after_a_crash_during_its_final_attempt() {
    let directory = tempdir().expect("temp directory");
    let mut spool = Spool::open(directory.path().join("spool.db")).expect("open spool");
    let command = AgentCommand {
        id: "018f5f7e-7d28-7e12-a521-3456789abcde".to_owned(),
        r#type: AgentCommandType::CheckUpdate as i32,
        not_before_ms: 60_000,
        expires_at_ms: 3_600_000,
        attempt_limit: 1,
        payload_schema_version: 1,
        requested_version: String::new(),
        bypass_rollout: false,
    };
    spool
        .accept_commands(std::slice::from_ref(&command), 60_000)
        .expect("accept command");
    assert_eq!(
        spool
            .mark_command_attempt(&command.id, 90_000)
            .expect("mark final attempt"),
        1
    );

    let recovered = spool
        .due_command(90_000)
        .expect("read command after restart")
        .expect("exhausted command remains visible");
    assert_eq!(recovered.command, command);
    assert_eq!(recovered.attempt_count, 1);
}

#[test]
fn probe_secrets_are_encrypted_and_bound_to_the_identity_and_revision() {
    let directory = tempdir().expect("temp directory");
    let path = directory.path().join("spool.db");
    let secret = b"private-probe-header-never-store-in-plaintext";
    let config = AgentConfigSnapshot {
        revision: 9,
        digest: secret.to_vec(),
        ..Default::default()
    };
    {
        let mut spool = Spool::open(&path).expect("open spool");
        // Simulate the old plaintext schema, then migrate in place.
        spool.connection.execute("INSERT INTO probe_config (singleton, revision, payload, updated_at) VALUES (1, 9, ?, 0)", [encode_message(&config)]).expect("legacy config");
        spool.protect_probe_config(&[7; 32]).expect("migrate");
        let stored: Vec<u8> = spool
            .connection
            .query_row("SELECT payload FROM probe_config", [], |row| row.get(0))
            .expect("stored ciphertext");
        assert!(!stored.windows(secret.len()).any(|window| window == secret));
        assert_eq!(spool.load_probe_config().expect("read config"), config);
        spool
            .protect_probe_config(&[8; 32])
            .expect("set different identity");
        assert!(spool.load_probe_config().is_err());
    }
    let spool = Spool::open(&path).expect("reopen with original identity");
    assert_eq!(
        spool.load_probe_config().expect("read after restart"),
        config
    );
    spool
        .connection
        .execute("UPDATE probe_config SET revision = 10", [])
        .expect("tamper revision");
    assert!(spool.load_probe_config().is_err());
}

#[test]
fn sqlite_capacity_rejects_growth_without_deleting_pending_deliveries() {
    let directory = tempdir().expect("temp directory");
    let spool = Spool::open(directory.path().join("spool.db")).expect("open spool");
    spool
        .configure_capacity(9 * 1024 * 1024)
        .expect("configure capacity");
    spool
        .connection
        .execute("CREATE TABLE pressure (payload BLOB)", [])
        .expect("test table");
    assert!(
        spool
            .connection
            .execute("INSERT INTO pressure VALUES (zeroblob(2097152))", [])
            .is_err()
    );
    spool
        .connection
        .execute("INSERT INTO pressure VALUES (zeroblob(1024))", [])
        .expect("small writes still work");
}

#[test]
fn pressure_uses_the_main_database_budget_after_reserving_wal_space() {
    let directory = tempdir().expect("temp directory");
    let mut spool = Spool::open(directory.path().join("spool.db")).expect("open spool");
    let budget = 9 * 1024 * 1024;
    spool
        .configure_capacity(budget)
        .expect("configure capacity");
    let now = 10 * 86_400_000_i64;
    let mut filled = false;
    for index in 0..1000_i64 {
        let observed_at = now - index * 10_000;
        if spool
            .connection
            .execute(
                "INSERT INTO samples (sample_bucket, observed_at, payload, created_at)
             VALUES (?, ?, zeroblob(8192), ?)",
                rusqlite::params![observed_at, observed_at, now],
            )
            .is_err()
        {
            filled = true;
            break;
        }
    }
    assert!(filled, "fixture must reach the SQLite page cap");
    let outcome = spool
        .enforce_capacity(budget, now)
        .expect("compact full spool");
    assert!(
        outcome.compacted_samples > 0,
        "WAL reserve must not hide main-DB pressure"
    );
    spool
        .append_sample(&sample(now + 10_000), now)
        .expect("sampling resumes after compaction");
}

#[cfg(unix)]
#[test]
fn spool_files_have_private_permissions_and_reject_symlinks() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let directory = tempdir().expect("temp directory");
    let path = directory.path().join("spool.db");
    let spool = Spool::create(&path, 1).expect("create spool");
    assert_eq!(
        std::fs::metadata(&path)
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    drop(spool);
    let link = directory.path().join("link.db");
    symlink(&path, &link).expect("symlink");
    assert!(Spool::open_existing(&link).is_err());
}
