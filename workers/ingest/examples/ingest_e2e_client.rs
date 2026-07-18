use std::{
    env,
    error::Error,
    fs, io,
    time::{SystemTime, UNIX_EPOCH},
};

use alphaping_agent::{
    enrollment::{build_enrollment_proof, validate_enrollment_response},
    key_rotation::validate_key_rotation,
    uploader::EnvelopeCodec,
};
use alphaping_protocol::{
    compress_message, decode_message, decompress_message, encode_message,
    v1::{
        AckStatus, AgentCommandResult, AgentCommandResultStatus, AgentCommandType,
        ContainerCatalogEntry, ContainerInventory, ContainerMetric, ContainerPort,
        EncryptedEnvelope, EnrollmentResponse, MachineReport, MetricSample, RuntimeSnapshot,
    },
};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
struct StoredSession {
    agent_id: String,
    key_epoch: u32,
    root_key_hex: String,
    nonce_prefix_hex: String,
    report_id_hex: String,
    compressed_payload_hex: String,
}

#[derive(Deserialize, Serialize)]
struct StoredRotation {
    key_epoch: u32,
    root_key_hex: String,
    nonce_prefix_hex: String,
}

fn invalid_data(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn now_ms() -> Result<i64, Box<dyn Error>> {
    Ok(i64::try_from(
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis(),
    )?)
}

fn container_inventory(observed_at_ms: i64) -> ContainerInventory {
    let container_key = vec![0x42; 16];
    ContainerInventory {
        observed_at_ms,
        catalog_digest: vec![0x24; 32],
        runtimes: vec![
            RuntimeSnapshot {
                kind: 1,
                instance: "default".to_owned(),
                availability: 1,
                version: "27.0.0".to_owned(),
                detail_code: String::new(),
            },
            RuntimeSnapshot {
                kind: 2,
                instance: "default".to_owned(),
                availability: 3,
                version: String::new(),
                detail_code: "profile_stopped".to_owned(),
            },
            RuntimeSnapshot {
                kind: 3,
                instance: "default".to_owned(),
                availability: 2,
                version: String::new(),
                detail_code: "profile_absent".to_owned(),
            },
            RuntimeSnapshot {
                kind: 4,
                instance: "default".to_owned(),
                availability: 1,
                version: "0.7.0".to_owned(),
                detail_code: String::new(),
            },
        ],
        catalog: vec![
            ContainerCatalogEntry {
                container_key: container_key.clone(),
                runtime: 1,
                runtime_instance: "default".to_owned(),
                runtime_container_id: "0123456789abcdef".to_owned(),
                name: "api".to_owned(),
                image: "example/api:1".to_owned(),
            },
            ContainerCatalogEntry {
                container_key: vec![0x43; 16],
                runtime: 1,
                runtime_instance: "default".to_owned(),
                runtime_container_id: "fedcba9876543210".to_owned(),
                name: "worker".to_owned(),
                image: "example/worker:1".to_owned(),
            },
        ],
        metrics: vec![ContainerMetric {
            container_key,
            state: 2,
            health: 3,
            started_at_ms: observed_at_ms - 60_000,
            restart_count: 1,
            cpu_permille: 125,
            memory_used_bytes: 134_217_728,
            memory_limit_bytes: 536_870_912,
            network_rx_bytes_per_second: 4_096,
            network_tx_bytes_per_second: 2_048,
            network_rx_bytes_total: 1_048_576,
            network_tx_bytes_total: 524_288,
            ports: vec![ContainerPort {
                private_port: 8080,
                public_port: 8443,
                protocol: "tcp".to_owned(),
                host_ip: "127.0.0.1".to_owned(),
            }],
            exit_code: 0,
        }],
        catalog_included: true,
    }
}

async fn post_protobuf(
    client: &Client,
    endpoint: &str,
    body: Vec<u8>,
) -> Result<reqwest::Response, Box<dyn Error>> {
    Ok(client
        .post(endpoint)
        .header("content-type", "application/x-protobuf")
        .body(body)
        .send()
        .await?)
}

async fn expect_enrollment_rejected(
    client: &Client,
    endpoint: &str,
    token: &str,
    machine_id: &str,
) -> Result<(), Box<dyn Error>> {
    let proof = build_enrollment_proof(token, machine_id)?;
    let response = post_protobuf(client, endpoint, encode_message(&proof.request)).await?;
    if response.status() != StatusCode::NOT_FOUND {
        return Err(invalid_data("invalid enrollment token was not rejected").into());
    }
    Ok(())
}

async fn verify_report_rejected(
    client: &Client,
    origin: &str,
    state_path: &str,
    accepted_message: &str,
    success_message: &str,
) -> Result<(), Box<dyn Error>> {
    let session: StoredSession = serde_json::from_slice(&fs::read(state_path)?)?;
    let root_key: [u8; 32] = hex::decode(&session.root_key_hex)?
        .try_into()
        .map_err(|_| invalid_data("stored E2E root key length changed"))?;
    let nonce_prefix: [u8; 4] = hex::decode(&session.nonce_prefix_hex)?
        .try_into()
        .map_err(|_| invalid_data("stored E2E nonce prefix length changed"))?;
    let report_id = hex::decode(&session.report_id_hex)?;
    let compressed_payload = hex::decode(&session.compressed_payload_hex)?;
    let codec = EnvelopeCodec::new(
        session.agent_id.into_bytes(),
        session.key_epoch,
        root_key,
        nonce_prefix,
    )?;
    let envelope = codec.encode_report(8, now_ms()?, &report_id, &compressed_payload)?;
    let response = post_protobuf(client, &format!("{origin}/v1/reports"), envelope).await?;
    if response.status() != StatusCode::NOT_FOUND {
        return Err(invalid_data(accepted_message).into());
    }
    println!("{success_message}");
    Ok(())
}

async fn verify_command_delivery(
    client: &Client,
    origin: &str,
    state_path: &str,
) -> Result<(), Box<dyn Error>> {
    let session: StoredSession = serde_json::from_slice(&fs::read(state_path)?)?;
    let root_key: [u8; 32] = hex::decode(&session.root_key_hex)?
        .try_into()
        .map_err(|_| invalid_data("stored E2E root key length changed"))?;
    let nonce_prefix: [u8; 4] = hex::decode(&session.nonce_prefix_hex)?
        .try_into()
        .map_err(|_| invalid_data("stored E2E nonce prefix length changed"))?;
    let report_id = hex::decode(&session.report_id_hex)?;
    let compressed_payload = hex::decode(&session.compressed_payload_hex)?;
    let codec = EnvelopeCodec::new(
        session.agent_id.into_bytes(),
        session.key_epoch,
        root_key,
        nonce_prefix,
    )?;
    let endpoint = format!("{origin}/v1/reports");
    let envelope = codec.encode_report(6, now_ms()?, &report_id, &compressed_payload)?;
    let response = post_protobuf(client, &endpoint, envelope).await?;
    if response.status() != StatusCode::OK {
        return Err(invalid_data("command delivery report was rejected").into());
    }
    let acknowledgement = codec.decode_ack(
        &response.bytes().await?,
        6,
        &report_id,
        blake3::hash(&compressed_payload).as_bytes(),
    )?;
    if AckStatus::try_from(acknowledgement.status)? != AckStatus::Duplicate
        || acknowledgement.commands.len() != 1
    {
        return Err(invalid_data("pending command was not delivered in the encrypted ACK").into());
    }
    let command = &acknowledgement.commands[0];
    if AgentCommandType::try_from(command.r#type)? != AgentCommandType::CheckUpdate
        || command.payload_schema_version != 1
        || !command.bypass_rollout
        || !command.requested_version.is_empty()
    {
        return Err(
            invalid_data("delivered update command exceeded its allowlisted schema").into(),
        );
    }

    let mut result_report: MachineReport = decompress_message(&compressed_payload)?;
    result_report.report_id = vec![0x7c; 16];
    result_report.nominal_minute_ms += 60_000;
    for sample in &mut result_report.samples {
        sample.observed_at_ms += 60_000;
    }
    if let Some(inventory) = &mut result_report.container_inventory {
        inventory.observed_at_ms += 60_000;
    }
    result_report.command_results = vec![AgentCommandResult {
        command_id: command.id.clone(),
        status: AgentCommandResultStatus::Succeeded as i32,
        completed_at_ms: now_ms()?,
        result_code: "no_update_available".to_owned(),
        installed_version: "0.1.0".to_owned(),
    }];
    let result_payload = compress_message(&result_report)?;
    let envelope = codec.encode_report(7, now_ms()?, &result_report.report_id, &result_payload)?;
    let response = post_protobuf(client, &endpoint, envelope).await?;
    if response.status() != StatusCode::OK {
        return Err(invalid_data("command result report was rejected").into());
    }
    let acknowledgement = codec.decode_ack(
        &response.bytes().await?,
        7,
        &result_report.report_id,
        blake3::hash(&result_payload).as_bytes(),
    )?;
    if AckStatus::try_from(acknowledgement.status)? != AckStatus::Committed {
        return Err(invalid_data("command result report was not committed").into());
    }
    println!("Ingest delivered and persisted an allowlisted Agent update command");
    Ok(())
}

async fn verify_config_delivery(
    client: &Client,
    origin: &str,
    state_path: &str,
) -> Result<(), Box<dyn Error>> {
    let session: StoredSession = serde_json::from_slice(&fs::read(state_path)?)?;
    let root_key: [u8; 32] = hex::decode(&session.root_key_hex)?
        .try_into()
        .map_err(|_| invalid_data("stored E2E root key length changed"))?;
    let nonce_prefix: [u8; 4] = hex::decode(&session.nonce_prefix_hex)?
        .try_into()
        .map_err(|_| invalid_data("stored E2E nonce prefix length changed"))?;
    let codec = EnvelopeCodec::new(
        session.agent_id.into_bytes(),
        session.key_epoch,
        root_key,
        nonce_prefix,
    )?;
    let mut report: MachineReport =
        decompress_message(&hex::decode(&session.compressed_payload_hex)?)?;
    report.report_id = vec![0x8d; 16];
    report.nominal_minute_ms -= 120_000;
    for sample in &mut report.samples {
        sample.observed_at_ms -= 120_000;
    }
    if let Some(inventory) = &mut report.container_inventory {
        inventory.observed_at_ms -= 120_000;
    }
    let payload = compress_message(&report)?;
    let endpoint = format!("{origin}/v1/reports");
    let envelope = codec.encode_report(5, now_ms()?, &report.report_id, &payload)?;
    let response = post_protobuf(client, &endpoint, envelope).await?;
    if response.status() != StatusCode::OK {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(invalid_data(&format!(
            "configuration delivery report was rejected with {status}: {body}"
        ))
        .into());
    }
    let acknowledgement = codec.decode_ack(
        &response.bytes().await?,
        5,
        &report.report_id,
        blake3::hash(&payload).as_bytes(),
    )?;
    let config = acknowledgement
        .config
        .as_ref()
        .ok_or_else(|| invalid_data("configuration ACK omitted Agent configuration"))?;
    if acknowledgement.config_revision != 2
        || config.revision != 2
        || config.sample_interval_seconds != Some(15)
        || config.report_interval_seconds != Some(120)
        || config.container_monitoring_enabled != Some(false)
    {
        return Err(invalid_data("Agent configuration omitted machine collection settings").into());
    }
    let mut unsigned_config = config.clone();
    unsigned_config.digest.clear();
    if config.digest != blake3::hash(&encode_message(&unsigned_config)).as_bytes() {
        return Err(
            invalid_data("Agent configuration digest did not cover collection settings").into(),
        );
    }
    println!("Ingest delivered authenticated Agent collection settings");
    Ok(())
}

async fn verify_rotation_proposal(
    client: &Client,
    origin: &str,
    state_path: &str,
    rotation_path: &str,
) -> Result<(), Box<dyn Error>> {
    let session: StoredSession = serde_json::from_slice(&fs::read(state_path)?)?;
    let root_key: [u8; 32] = hex::decode(&session.root_key_hex)?
        .try_into()
        .map_err(|_| invalid_data("stored E2E root key length changed"))?;
    let nonce_prefix: [u8; 4] = hex::decode(&session.nonce_prefix_hex)?
        .try_into()
        .map_err(|_| invalid_data("stored E2E nonce prefix length changed"))?;
    let report_id = hex::decode(&session.report_id_hex)?;
    let compressed_payload = hex::decode(&session.compressed_payload_hex)?;
    let codec = EnvelopeCodec::new(
        session.agent_id.into_bytes(),
        session.key_epoch,
        root_key,
        nonce_prefix,
    )?;
    let endpoint = format!("{origin}/v1/reports");
    let mut proposals = Vec::with_capacity(2);
    for sequence in [8, 9] {
        let envelope = codec.encode_report(sequence, now_ms()?, &report_id, &compressed_payload)?;
        let response = post_protobuf(client, &endpoint, envelope).await?;
        if response.status() != StatusCode::OK {
            return Err(invalid_data("rotation proposal report was rejected").into());
        }
        let acknowledgement = codec.decode_ack(
            &response.bytes().await?,
            sequence,
            &report_id,
            blake3::hash(&compressed_payload).as_bytes(),
        )?;
        if AckStatus::try_from(acknowledgement.status)? != AckStatus::Duplicate {
            return Err(invalid_data("rotation proposal retry was not a duplicate ACK").into());
        }
        proposals.push(
            acknowledgement
                .key_rotation
                .ok_or_else(|| invalid_data("rotation proposal was omitted from encrypted ACK"))?,
        );
    }
    if proposals[0] != proposals[1] {
        return Err(invalid_data("rotation proposal changed across retries").into());
    }
    let validated = validate_key_rotation(&proposals[0], session.key_epoch, now_ms()?)?;
    fs::write(
        rotation_path,
        serde_json::to_vec(&StoredRotation {
            key_epoch: validated.key_epoch,
            root_key_hex: hex::encode(validated.data_key),
            nonce_prefix_hex: hex::encode(validated.nonce_prefix),
        })?,
    )?;
    println!("Ingest returned a stable authenticated key rotation proposal");
    Ok(())
}

async fn verify_rotation_activation(
    client: &Client,
    origin: &str,
    state_path: &str,
    rotation_path: &str,
) -> Result<(), Box<dyn Error>> {
    let session: StoredSession = serde_json::from_slice(&fs::read(state_path)?)?;
    let rotation: StoredRotation = serde_json::from_slice(&fs::read(rotation_path)?)?;
    let root_key: [u8; 32] = hex::decode(&rotation.root_key_hex)?
        .try_into()
        .map_err(|_| invalid_data("rotated E2E root key length changed"))?;
    let nonce_prefix: [u8; 4] = hex::decode(&rotation.nonce_prefix_hex)?
        .try_into()
        .map_err(|_| invalid_data("rotated E2E nonce prefix length changed"))?;
    let codec = EnvelopeCodec::new(
        session.agent_id.into_bytes(),
        rotation.key_epoch,
        root_key,
        nonce_prefix,
    )?;
    let mut report: MachineReport =
        decompress_message(&hex::decode(&session.compressed_payload_hex)?)?;
    report.report_id = vec![0x9e; 16];
    report.nominal_minute_ms -= 180_000;
    for sample in &mut report.samples {
        sample.observed_at_ms -= 180_000;
    }
    if let Some(inventory) = &mut report.container_inventory {
        inventory.observed_at_ms -= 180_000;
    }
    let payload = compress_message(&report)?;
    let endpoint = format!("{origin}/v1/reports");
    let envelope = codec.encode_report(10, now_ms()?, &report.report_id, &payload)?;
    let response = post_protobuf(client, &endpoint, envelope).await?;
    if response.status() != StatusCode::OK {
        return Err(invalid_data("rotated key report was rejected").into());
    }
    let acknowledgement = codec.decode_ack(
        &response.bytes().await?,
        10,
        &report.report_id,
        blake3::hash(&payload).as_bytes(),
    )?;
    if AckStatus::try_from(acknowledgement.status)? != AckStatus::Committed
        || acknowledgement.key_rotation.is_some()
    {
        return Err(invalid_data("rotated key report did not activate the new epoch").into());
    }
    for sequence in [100, 99] {
        let envelope = codec.encode_report(sequence, now_ms()?, &report.report_id, &payload)?;
        let response = post_protobuf(client, &endpoint, envelope).await?;
        if response.status() != StatusCode::OK {
            return Err(
                invalid_data("rotated epoch replay window rejected a valid sequence").into(),
            );
        }
        codec.decode_ack(
            &response.bytes().await?,
            sequence,
            &report.report_id,
            blake3::hash(&payload).as_bytes(),
        )?;
    }
    let stale = codec.encode_report(37, now_ms()?, &report.report_id, &payload)?;
    let response = post_protobuf(client, &endpoint, stale).await?;
    if response.status() != StatusCode::NOT_FOUND {
        return Err(invalid_data("sequence outside the replay window was accepted").into());
    }
    println!("Ingest accepted the rotated key epoch and committed its report");
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args().skip(1);
    let mode = arguments
        .next()
        .ok_or_else(|| invalid_data("missing mode"))?;
    let origin = arguments
        .next()
        .ok_or_else(|| invalid_data("missing origin"))?;
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .map_err(|_| invalid_data("failed to install the E2E rustls provider"))?;
    let client = Client::builder().build()?;
    if mode == "verify-command" {
        let state_path = arguments
            .next()
            .ok_or_else(|| invalid_data("missing E2E session path"))?;
        if arguments.next().is_some() || !origin.starts_with("http://127.0.0.1:") {
            return Err(invalid_data(
                "usage: ingest_e2e_client verify-command LOCAL_ORIGIN SESSION_PATH",
            )
            .into());
        }
        return verify_command_delivery(&client, &origin, &state_path).await;
    }
    if mode == "verify-config" {
        let state_path = arguments
            .next()
            .ok_or_else(|| invalid_data("missing E2E session path"))?;
        if arguments.next().is_some() || !origin.starts_with("http://127.0.0.1:") {
            return Err(invalid_data(
                "usage: ingest_e2e_client verify-config LOCAL_ORIGIN SESSION_PATH",
            )
            .into());
        }
        return verify_config_delivery(&client, &origin, &state_path).await;
    }
    if mode == "verify-rotation-proposal" || mode == "verify-rotation-activation" {
        let state_path = arguments
            .next()
            .ok_or_else(|| invalid_data("missing E2E session path"))?;
        let rotation_path = arguments
            .next()
            .ok_or_else(|| invalid_data("missing E2E rotation path"))?;
        if arguments.next().is_some() || !origin.starts_with("http://127.0.0.1:") {
            return Err(invalid_data(
                "usage: ingest_e2e_client verify-rotation-proposal|verify-rotation-activation LOCAL_ORIGIN SESSION_PATH ROTATION_PATH",
            )
            .into());
        }
        return if mode == "verify-rotation-proposal" {
            verify_rotation_proposal(&client, &origin, &state_path, &rotation_path).await
        } else {
            verify_rotation_activation(&client, &origin, &state_path, &rotation_path).await
        };
    }
    if mode == "verify-revoked" || mode == "verify-workspace-deleted" {
        let state_path = arguments
            .next()
            .ok_or_else(|| invalid_data("missing E2E session path"))?;
        if arguments.next().is_some() || !origin.starts_with("http://127.0.0.1:") {
            return Err(invalid_data(
                "usage: ingest_e2e_client verify-revoked|verify-workspace-deleted LOCAL_ORIGIN SESSION_PATH",
            )
            .into());
        }
        let (accepted_message, success_message) = if mode == "verify-revoked" {
            (
                "revoked Agent key accepted a report",
                "Ingest rejected the revoked Agent key",
            )
        } else {
            (
                "deleted workspace accepted an Agent report",
                "Ingest rejected reports for a deleted workspace",
            )
        };
        return verify_report_rejected(
            &client,
            &origin,
            &state_path,
            accepted_message,
            success_message,
        )
        .await;
    }
    if mode != "run" {
        return Err(invalid_data("unknown E2E client mode").into());
    }
    let token = arguments
        .next()
        .ok_or_else(|| invalid_data("missing token"))?;
    let machine_id = arguments
        .next()
        .ok_or_else(|| invalid_data("missing machine ID"))?;
    let expired_token = arguments
        .next()
        .ok_or_else(|| invalid_data("missing expired token"))?;
    let revoked_token = arguments
        .next()
        .ok_or_else(|| invalid_data("missing revoked token"))?;
    let state_path = arguments
        .next()
        .ok_or_else(|| invalid_data("missing E2E session path"))?;
    if arguments.next().is_some() || !origin.starts_with("http://127.0.0.1:") {
        return Err(invalid_data(
            "usage: ingest_e2e_client run LOCAL_ORIGIN TOKEN MACHINE_ID EXPIRED_TOKEN REVOKED_TOKEN SESSION_PATH",
        )
        .into());
    }

    let enrollment_endpoint = format!("{origin}/v1/enroll");
    expect_enrollment_rejected(&client, &enrollment_endpoint, &expired_token, &machine_id).await?;
    expect_enrollment_rejected(&client, &enrollment_endpoint, &revoked_token, &machine_id).await?;
    let proof = build_enrollment_proof(&token, &machine_id)?;
    let enrollment_body = encode_message(&proof.request);
    let response = post_protobuf(&client, &enrollment_endpoint, enrollment_body.clone()).await?;
    if response.status() != StatusCode::OK {
        return Err(invalid_data("valid enrollment was rejected").into());
    }
    let enrollment: EnrollmentResponse = decode_message(&response.bytes().await?)?;
    validate_enrollment_response(&enrollment, &machine_id)?;

    let reused = post_protobuf(&client, &enrollment_endpoint, enrollment_body).await?;
    if reused.status() != StatusCode::NOT_FOUND {
        return Err(invalid_data("used enrollment token was accepted again").into());
    }

    let now = now_ms()?;
    let nominal_minute = now - now.rem_euclid(60_000);
    let report_id = vec![0x5a; 16];
    let samples = (0_u32..6)
        .map(|index| MetricSample {
            observed_at_ms: nominal_minute + i64::from(index) * 10_000,
            cpu_permille: 200 + index * 10,
            memory_used_bytes: 1_073_741_824 + u64::from(index) * 1_024,
            memory_total_bytes: 4_294_967_296,
            storage_used_bytes: 8_589_934_592,
            storage_total_bytes: 17_179_869_184,
            network_rx_bytes_per_second: 4_096 + u64::from(index),
            network_tx_bytes_per_second: 2_048 + u64::from(index),
            network_rx_bytes_total: 1_000_000 + u64::from(index) * 40_960,
            network_tx_bytes_total: 500_000 + u64::from(index) * 20_480,
            load_1m_milli: Some(1_200 + index * 10),
            uptime_seconds: Some(86_400 + u64::from(index)),
        })
        .collect();
    let report = MachineReport {
        report_id: report_id.clone(),
        machine_pk: enrollment.machine_pk,
        workspace_pk: enrollment.workspace_pk,
        nominal_minute_ms: nominal_minute,
        samples,
        schema_version: 4,
        container_inventory: Some(container_inventory(now)),
        probe_results: Vec::new(),
        applied_config_revision: enrollment.config_revision,
        command_results: Vec::new(),
        agent_version: "business-marker-1".to_owned(),
    };
    let compressed = compress_message(&report)?;
    let root_key: [u8; 32] = enrollment
        .data_key
        .as_slice()
        .try_into()
        .map_err(|_| invalid_data("enrollment root key length changed"))?;
    let nonce_prefix: [u8; 4] = enrollment
        .nonce_prefix
        .as_slice()
        .try_into()
        .map_err(|_| invalid_data("enrollment nonce prefix length changed"))?;
    let codec = EnvelopeCodec::new(
        enrollment.agent_id.as_bytes().to_vec(),
        enrollment.key_epoch,
        root_key,
        nonce_prefix,
    )?;
    let reports_endpoint = format!("{origin}/v1/reports");
    let first_envelope = codec.encode_report(1, now, &report_id, &compressed)?;
    if first_envelope
        .windows(b"business-marker-1".len())
        .any(|window| window == b"business-marker-1")
    {
        return Err(invalid_data("encrypted envelope exposed report plaintext").into());
    }
    let response = post_protobuf(&client, &reports_endpoint, first_envelope.clone()).await?;
    if response.status() != StatusCode::OK {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(invalid_data(&format!(
            "first durable report was rejected with {status}: {body}"
        ))
        .into());
    }
    let acknowledgement = codec.decode_ack(
        &response.bytes().await?,
        1,
        &report_id,
        blake3::hash(&compressed).as_bytes(),
    )?;
    if AckStatus::try_from(acknowledgement.status)? != AckStatus::Committed {
        return Err(invalid_data("first durable report was not committed").into());
    }
    let duplicate_envelope = codec.encode_report(2, now_ms()?, &report_id, &compressed)?;
    let response = post_protobuf(&client, &reports_endpoint, duplicate_envelope).await?;
    if response.status() != StatusCode::OK {
        return Err(invalid_data("idempotent report retry was rejected").into());
    }
    let acknowledgement = codec.decode_ack(
        &response.bytes().await?,
        2,
        &report_id,
        blake3::hash(&compressed).as_bytes(),
    )?;
    if AckStatus::try_from(acknowledgement.status)? != AckStatus::Duplicate {
        return Err(invalid_data("idempotent report retry was not classified as duplicate").into());
    }

    let threshold_report_id = vec![0x6b; 16];
    let threshold_minute = nominal_minute + 60_000;
    let mut threshold_report = report.clone();
    threshold_report.report_id.clone_from(&threshold_report_id);
    threshold_report.nominal_minute_ms = threshold_minute;
    for (index, sample) in threshold_report.samples.iter_mut().enumerate() {
        sample.observed_at_ms = threshold_minute + i64::try_from(index)? * 10_000;
        sample.cpu_permille = 980;
    }
    if let Some(inventory) = &mut threshold_report.container_inventory {
        inventory.observed_at_ms = threshold_minute;
    }
    let threshold_payload = compress_message(&threshold_report)?;
    let threshold_envelope =
        codec.encode_report(3, now_ms()?, &threshold_report_id, &threshold_payload)?;
    let response = post_protobuf(&client, &reports_endpoint, threshold_envelope).await?;
    if response.status() != StatusCode::OK {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(invalid_data(&format!(
            "threshold report was rejected with {status}: {body}"
        ))
        .into());
    }
    let acknowledgement = codec.decode_ack(
        &response.bytes().await?,
        3,
        &threshold_report_id,
        blake3::hash(&threshold_payload).as_bytes(),
    )?;
    if AckStatus::try_from(acknowledgement.status)? != AckStatus::Committed {
        return Err(invalid_data("threshold report was not committed").into());
    }

    for sequence in [50, 49] {
        let envelope = codec.encode_report(sequence, now_ms()?, &report_id, &compressed)?;
        let response = post_protobuf(&client, &reports_endpoint, envelope).await?;
        if response.status() != StatusCode::OK {
            return Err(invalid_data("out-of-order transport sequence was rejected").into());
        }
        let acknowledgement = codec.decode_ack(
            &response.bytes().await?,
            sequence,
            &report_id,
            blake3::hash(&compressed).as_bytes(),
        )?;
        if AckStatus::try_from(acknowledgement.status)? != AckStatus::Duplicate {
            return Err(invalid_data("out-of-order report did not receive a duplicate ACK").into());
        }
    }
    let concurrent = codec.encode_report(48, now_ms()?, &report_id, &compressed)?;
    let (left, right) = tokio::join!(
        post_protobuf(&client, &reports_endpoint, concurrent.clone()),
        post_protobuf(&client, &reports_endpoint, concurrent),
    );
    let mut statuses = [left?.status(), right?.status()];
    statuses.sort();
    if statuses != [StatusCode::OK, StatusCode::NOT_FOUND] {
        return Err(invalid_data("concurrent replay claim was not atomic").into());
    }

    let replay = post_protobuf(&client, &reports_endpoint, first_envelope).await?;
    if replay.status() != StatusCode::NOT_FOUND {
        return Err(invalid_data("replayed transport sequence was not rejected").into());
    }
    let mut tampered: EncryptedEnvelope =
        decode_message(&codec.encode_report(4, now_ms()?, &report_id, &compressed)?)?;
    let byte = tampered
        .ciphertext
        .last_mut()
        .ok_or_else(|| invalid_data("test ciphertext is empty"))?;
    *byte ^= 0x80;
    let rejected = post_protobuf(&client, &reports_endpoint, encode_message(&tampered)).await?;
    if rejected.status() != StatusCode::NOT_FOUND {
        return Err(invalid_data("tampered report ciphertext was not rejected").into());
    }

    fs::write(
        &state_path,
        serde_json::to_vec(&StoredSession {
            agent_id: enrollment.agent_id,
            key_epoch: enrollment.key_epoch,
            root_key_hex: hex::encode(root_key),
            nonce_prefix_hex: hex::encode(nonce_prefix),
            report_id_hex: hex::encode(threshold_report_id),
            compressed_payload_hex: hex::encode(threshold_payload),
        })?,
    )?;

    println!(
        "Ingest enrollment, token rejection, encrypted report, ACK, duplicate, replay, and tamper flow passed"
    );
    Ok(())
}
