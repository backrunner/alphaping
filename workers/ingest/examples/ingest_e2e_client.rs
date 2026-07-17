use std::{
    env,
    error::Error,
    fs, io,
    time::{SystemTime, UNIX_EPOCH},
};

use alphaping_agent::{
    enrollment::{build_enrollment_proof, validate_enrollment_response},
    uploader::EnvelopeCodec,
};
use alphaping_protocol::{
    compress_message, decode_message, encode_message,
    v1::{AckStatus, EncryptedEnvelope, EnrollmentResponse, MachineReport, MetricSample},
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

fn invalid_data(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn now_ms() -> Result<i64, Box<dyn Error>> {
    Ok(i64::try_from(
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis(),
    )?)
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

async fn verify_revoked_key(
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
    let envelope = codec.encode_report(4, now_ms()?, &report_id, &compressed_payload)?;
    let response = post_protobuf(client, &format!("{origin}/v1/reports"), envelope).await?;
    if response.status() != StatusCode::NOT_FOUND {
        return Err(invalid_data("revoked Agent key accepted a report").into());
    }
    println!("Ingest rejected the revoked Agent key");
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
    if mode == "verify-revoked" {
        let state_path = arguments
            .next()
            .ok_or_else(|| invalid_data("missing E2E session path"))?;
        if arguments.next().is_some() || !origin.starts_with("http://127.0.0.1:") {
            return Err(invalid_data(
                "usage: ingest_e2e_client verify-revoked LOCAL_ORIGIN SESSION_PATH",
            )
            .into());
        }
        return verify_revoked_key(&client, &origin, &state_path).await;
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
        })
        .collect();
    let report = MachineReport {
        report_id: report_id.clone(),
        machine_pk: enrollment.machine_pk,
        workspace_pk: enrollment.workspace_pk,
        nominal_minute_ms: nominal_minute,
        samples,
        schema_version: 3,
        container_inventory: None,
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
    let acknowledgement = codec.decode_ack(&response.bytes().await?, 1, &report_id)?;
    if AckStatus::try_from(acknowledgement.status)? != AckStatus::Committed {
        return Err(invalid_data("first durable report was not committed").into());
    }

    let duplicate_envelope = codec.encode_report(2, now_ms()?, &report_id, &compressed)?;
    let response = post_protobuf(&client, &reports_endpoint, duplicate_envelope).await?;
    if response.status() != StatusCode::OK {
        return Err(invalid_data("idempotent report retry was rejected").into());
    }
    let acknowledgement = codec.decode_ack(&response.bytes().await?, 2, &report_id)?;
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
    let threshold_payload = compress_message(&threshold_report)?;
    let threshold_envelope =
        codec.encode_report(3, now_ms()?, &threshold_report_id, &threshold_payload)?;
    let response = post_protobuf(&client, &reports_endpoint, threshold_envelope).await?;
    if response.status() != StatusCode::OK {
        return Err(invalid_data("threshold report was rejected").into());
    }
    let acknowledgement = codec.decode_ack(&response.bytes().await?, 3, &threshold_report_id)?;
    if AckStatus::try_from(acknowledgement.status)? != AckStatus::Committed {
        return Err(invalid_data("threshold report was not committed").into());
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
            report_id_hex: hex::encode(report_id),
            compressed_payload_hex: hex::encode(compressed),
        })?,
    )?;

    println!(
        "Ingest enrollment, token rejection, encrypted report, ACK, duplicate, replay, and tamper flow passed"
    );
    Ok(())
}
