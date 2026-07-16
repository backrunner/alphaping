use alphaping_protocol::{
    MAX_ENVELOPE_BYTES, compress_message, encode_message,
    v1::{
        AgentConfigSnapshot, HttpProbeRequest, MachineReport, MetricSample, ProbeKind, ProbeResult,
        ProbeState, ProbeTask, probe_task,
    },
};

fn task(index: u64) -> ProbeTask {
    ProbeTask {
        check_id: format!("018f5f7e-7d28-7e12-a521-{index:012x}"),
        check_pk: index + 1,
        service_pk: index + 101,
        workspace_pk: 1,
        config_revision: 9,
        kind: ProbeKind::Http as i32,
        interval_seconds: 5,
        phase_seconds: (index % 5) as u32,
        timeout_ms: 5_000,
        request: Some(probe_task::Request::Http(HttpProbeRequest {
            url: format!("https://service-{index}.example.com/health"),
            method: "GET".to_owned(),
            expected_status: vec![200, 204],
            max_redirects: 3,
            max_response_bytes: 65_536,
            ..HttpProbeRequest::default()
        })),
    }
}

#[test]
fn maximum_agent_probe_config_fits_the_encrypted_ack_budget() {
    let config = AgentConfigSnapshot {
        revision: 9,
        probe_tasks: (0..32).map(task).collect(),
        created_at_ms: 1_752_574_800_000,
        digest: vec![7; 32],
    };
    assert!(encode_message(&config).len() <= 48 * 1024);
}

#[test]
fn one_minute_of_five_second_probe_results_fits_the_report_budget() {
    let mut results = Vec::new();
    for task_index in 0..32_u64 {
        for sample_index in 0..12_i64 {
            results.push(ProbeResult {
                execution_id: blake3::hash(format!("{task_index}:{sample_index}").as_bytes())
                    .as_bytes()
                    .to_vec(),
                check_id: format!("018f5f7e-7d28-7e12-a521-{task_index:012x}"),
                check_pk: task_index + 1,
                service_pk: task_index + 101,
                workspace_pk: 1,
                executor_agent_id: "018f5f7e-7d28-7e12-a521-aaaaaaaaaaaa".to_owned(),
                config_revision: 9,
                nominal_slot_ms: 1_752_574_800_000 + sample_index * 5_000,
                observed_at_ms: 1_752_574_800_100 + sample_index * 5_000,
                state: ProbeState::Healthy as i32,
                latency_ms: Some(12 + sample_index as u32),
                ..ProbeResult::default()
            });
        }
    }
    let report = MachineReport {
        report_id: vec![9; 16],
        machine_pk: 1,
        workspace_pk: 1,
        nominal_minute_ms: 1_752_574_800_000,
        samples: (0..6)
            .map(|index| MetricSample {
                observed_at_ms: 1_752_574_800_000 + index * 10_000,
                ..MetricSample::default()
            })
            .collect(),
        schema_version: 3,
        container_inventory: None,
        probe_results: results,
        applied_config_revision: 9,
        command_results: Vec::new(),
        agent_version: "0.1.0".to_owned(),
    };
    let payload = compress_message(&report).expect("probe report should compress");
    assert!(payload.len() <= MAX_ENVELOPE_BYTES - 1_024);
}
