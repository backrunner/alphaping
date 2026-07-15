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

pub async fn enroll(
    origin: &str,
    token: &str,
    machine_claim_id: &str,
) -> Result<EnrollmentMaterial> {
    if !origin.starts_with("https://") {
        bail!("enrollment endpoint must use HTTPS");
    }
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
    };
    request.signature = SigningKey::from_bytes(&identity_private_key)
        .sign(&encode_message(&request))
        .to_bytes()
        .to_vec();
    let endpoint = format!("{}/v1/enroll", origin.trim_end_matches('/'));
    let response = pq_client()?
        .post(endpoint)
        .header("content-type", "application/x-protobuf")
        .body(encode_message(&request))
        .send()
        .await
        .context("enrollment request failed")?;
    if !response.status().is_success() {
        bail!("enrollment was rejected");
    }
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_ENVELOPE_BYTES)
    {
        bail!("enrollment response is too large");
    }
    let body = response.bytes().await?;
    if body.len() > MAX_ENVELOPE_BYTES {
        bail!("enrollment response is too large");
    }
    let enrollment: EnrollmentResponse = decode_message(&body)?;
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
    Ok(EnrollmentMaterial {
        response: enrollment,
        identity_private_key,
    })
}
