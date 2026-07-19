use alphaping_protocol::{
    MAX_ENVELOPE_BYTES, PROTOCOL_VERSION, decode_message, encode_message,
    v1::{EnrollmentRequest, EnrollmentResponse},
};
use anyhow::{Context, Result, bail};
use ed25519_dalek::{Signer, SigningKey};

use crate::uploader::pq_client;

pub struct EnrollmentMaterial {
    pub response: EnrollmentResponse,
    pub identity_private_key: [u8; 32],
}

pub struct EnrollmentProof {
    pub request: EnrollmentRequest,
    pub identity_private_key: [u8; 32],
}

pub fn build_enrollment_proof(token: &str, machine_claim_id: &str) -> Result<EnrollmentProof> {
    if token.len() < 32 || token.len() > 256 {
        bail!("enrollment token has an invalid length");
    }
    if machine_claim_id.len() != 36 {
        bail!("machine claim is invalid");
    }
    let mut identity_private_key = [0_u8; 32];
    getrandom::fill(&mut identity_private_key).context("failed to create agent identity")?;
    let identity_public_key = SigningKey::from_bytes(&identity_private_key)
        .verifying_key()
        .to_bytes();
    let mut request = EnrollmentRequest {
        token: token.as_bytes().to_vec(),
        identity_public_key: identity_public_key.to_vec(),
        platform: std::env::consts::OS.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
        agent_version: env!("CARGO_PKG_VERSION").to_owned(),
        protocol_version: PROTOCOL_VERSION,
        machine_claim_id: machine_claim_id.to_owned(),
        request_nonce: {
            let mut nonce = vec![0_u8; 32];
            getrandom::fill(&mut nonce).context("failed to create enrollment nonce")?;
            nonce
        },
        supported_protocol_versions: vec![PROTOCOL_VERSION],
        pq_hybrid: true,
        signature: Vec::new(),
        hostname: sysinfo::System::host_name().unwrap_or_default(),
        os_name: sysinfo::System::name().unwrap_or_default(),
        os_version: sysinfo::System::os_version().unwrap_or_default(),
        kernel_version: sysinfo::System::kernel_version().unwrap_or_default(),
    };
    request.signature = SigningKey::from_bytes(&identity_private_key)
        .sign(&encode_message(&request))
        .to_bytes()
        .to_vec();
    Ok(EnrollmentProof {
        request,
        identity_private_key,
    })
}

pub fn validate_enrollment_response(
    enrollment: &EnrollmentResponse,
    machine_claim_id: &str,
) -> Result<()> {
    if enrollment.agent_id.is_empty()
        || enrollment.data_key.len() != 32
        || enrollment.nonce_prefix.len() != 4
        || enrollment.sample_interval_seconds < 5
        || enrollment.report_interval_seconds < 60
        || enrollment.machine_claim_id != machine_claim_id
        || enrollment.initial_client_sequence == 0
        || enrollment.max_envelope_bytes as usize != MAX_ENVELOPE_BYTES
    {
        bail!("enrollment response is invalid");
    }
    Ok(())
}

async fn read_bounded_response(mut response: reqwest::Response) -> Result<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_ENVELOPE_BYTES as u64)
    {
        bail!("enrollment response is too large");
    }
    let capacity = response
        .content_length()
        .and_then(|length| usize::try_from(length).ok())
        .unwrap_or_default()
        .min(MAX_ENVELOPE_BYTES);
    let mut body = Vec::with_capacity(capacity);
    while let Some(chunk) = response
        .chunk()
        .await
        .context("failed to read enrollment response")?
    {
        append_response_chunk(&mut body, &chunk)?;
    }
    Ok(body)
}

fn append_response_chunk(body: &mut Vec<u8>, chunk: &[u8]) -> Result<()> {
    if chunk.len() > MAX_ENVELOPE_BYTES.saturating_sub(body.len()) {
        bail!("enrollment response is too large");
    }
    body.extend_from_slice(chunk);
    Ok(())
}

pub async fn enroll(
    origin: &str,
    token: &str,
    machine_claim_id: &str,
) -> Result<EnrollmentMaterial> {
    if !origin.starts_with("https://") {
        bail!("enrollment endpoint must use HTTPS");
    }
    let proof = build_enrollment_proof(token, machine_claim_id)?;
    let endpoint = format!("{}/v1/enroll", origin.trim_end_matches('/'));
    let response = pq_client()?
        .post(endpoint)
        .header("content-type", "application/x-protobuf")
        .body(encode_message(&proof.request))
        .send()
        .await
        .context("enrollment request failed")?;
    if !response.status().is_success() {
        bail!("enrollment was rejected");
    }
    let body = read_bounded_response(response).await?;
    let enrollment: EnrollmentResponse = decode_message(&body)?;
    validate_enrollment_response(&enrollment, machine_claim_id)?;
    Ok(EnrollmentMaterial {
        response: enrollment,
        identity_private_key: proof.identity_private_key,
    })
}

#[cfg(test)]
mod tests {
    use alphaping_protocol::{MAX_ENVELOPE_BYTES, encode_message, v1::EnrollmentResponse};
    use ed25519_dalek::{Signature, VerifyingKey};

    use super::{append_response_chunk, build_enrollment_proof, validate_enrollment_response};

    #[test]
    fn enrollment_proof_binds_the_token_and_machine_claim() {
        let proof = build_enrollment_proof(
            "abcdefghijklmnopqrstuvwxyzABCDEFGH012345678",
            "018f5f7e-7d28-7e12-a521-23456789abcd",
        )
        .expect("proof should be constructed");
        let key_bytes: [u8; 32] = proof
            .request
            .identity_public_key
            .as_slice()
            .try_into()
            .expect("identity key length");
        let key = VerifyingKey::from_bytes(&key_bytes).expect("identity key");
        let signature = Signature::from_slice(&proof.request.signature).expect("signature");
        let mut unsigned = proof.request.clone();
        unsigned.signature.clear();
        key.verify_strict(&encode_message(&unsigned), &signature)
            .expect("proof signature");

        unsigned.machine_claim_id = "018f5f7e-7d28-7e12-a521-000000000000".to_owned();
        assert!(
            key.verify_strict(&encode_message(&unsigned), &signature)
                .is_err()
        );
    }

    #[test]
    fn enrollment_response_requires_safe_transport_limits() {
        let machine_claim_id = "018f5f7e-7d28-7e12-a521-23456789abcd";
        let mut response = EnrollmentResponse {
            agent_id: "018f5f7e-7d28-7e12-a521-123456789abc".to_owned(),
            machine_pk: 1,
            workspace_pk: 1,
            key_epoch: 1,
            data_key: vec![1; 32],
            nonce_prefix: vec![2; 4],
            config_revision: 1,
            sample_interval_seconds: 10,
            report_interval_seconds: 60,
            server_time_ms: 1,
            max_clock_skew_ms: 300_000,
            max_envelope_bytes: MAX_ENVELOPE_BYTES as u32,
            initial_client_sequence: 1,
            initial_server_sequence: 1,
            machine_claim_id: machine_claim_id.to_owned(),
            container_monitoring_enabled: true,
        };
        assert!(validate_enrollment_response(&response, machine_claim_id).is_ok());
        response.initial_client_sequence = 0;
        assert!(validate_enrollment_response(&response, machine_claim_id).is_err());
    }

    #[test]
    fn enrollment_response_chunks_cannot_exceed_the_envelope_limit() {
        let mut body = vec![0_u8; MAX_ENVELOPE_BYTES - 2];
        append_response_chunk(&mut body, &[1, 2]).expect("exact limit should be accepted");
        assert_eq!(body.len(), MAX_ENVELOPE_BYTES);

        let error = append_response_chunk(&mut body, &[3])
            .expect_err("a chunk beyond the response budget must be rejected");
        assert!(error.to_string().contains("too large"));
        assert_eq!(body.len(), MAX_ENVELOPE_BYTES);
    }
}
