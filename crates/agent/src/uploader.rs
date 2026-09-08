use std::{sync::Arc, time::Duration};

use alphaping_crypto::{DirectionalKeys, open, seal};
use alphaping_protocol::{
    MAX_ENVELOPE_BYTES, PROTOCOL_VERSION, decode_message, encode_message,
    v1::{AckStatus, DurableAck, EncryptedEnvelope, EnvelopeHeader},
};
use reqwest::Client;
use rustls::{
    ClientConfig, RootCertStore,
    crypto::{CryptoProvider, aws_lc_rs},
    version::TLS13,
};
use thiserror::Error;

use crate::spool::PendingDelivery;

#[derive(Debug, Error)]
pub enum UploadError {
    #[error("transport failed")]
    Transport(#[from] reqwest::Error),
    #[error("server rejected the agent identity")]
    Revoked,
    #[error("server returned a transient status")]
    ServerStatus,
    #[error("server permanently rejected the report with status {0}")]
    PermanentStatus(u16),
    #[error("response exceeded the protocol limit")]
    ResponseTooLarge,
    #[error("response protocol was invalid")]
    Protocol,
    #[error("response authentication failed")]
    Authentication,
}

#[derive(Clone)]
pub struct Uploader {
    client: Client,
    endpoint: String,
    codec: EnvelopeCodec,
}

#[derive(Clone)]
pub struct EnvelopeCodec {
    agent_id: Vec<u8>,
    key_epoch: u32,
    nonce_prefix: [u8; 4],
    keys: DirectionalKeys,
}

pub fn pq_tls_config() -> Result<Arc<ClientConfig>, UploadError> {
    let provider = CryptoProvider {
        kx_groups: vec![aws_lc_rs::kx_group::X25519MLKEM768],
        ..aws_lc_rs::default_provider()
    };
    let roots = RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls = ClientConfig::builder_with_provider(Arc::new(provider))
        .with_protocol_versions(&[&TLS13])
        .map_err(|_| UploadError::Protocol)?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(Arc::new(tls))
}

pub fn pq_client() -> Result<Client, UploadError> {
    Ok(Client::builder()
        .use_preconfigured_tls(pq_tls_config()?.as_ref().clone())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(8))
        .build()?)
}

impl Uploader {
    pub fn new(
        endpoint: String,
        agent_id: Vec<u8>,
        key_epoch: u32,
        root_key: [u8; 32],
        nonce_prefix: [u8; 4],
    ) -> Result<Self, UploadError> {
        let client = pq_client()?;
        Ok(Self {
            client,
            endpoint,
            codec: EnvelopeCodec::new(agent_id, key_epoch, root_key, nonce_prefix)?,
        })
    }

    pub async fn upload(
        &self,
        delivery: &PendingDelivery,
        sequence: u64,
        now_ms: i64,
    ) -> Result<DurableAck, UploadError> {
        let envelope =
            self.codec
                .encode_report(sequence, now_ms, &delivery.report_id, &delivery.payload)?;

        let response = self
            .client
            .post(&self.endpoint)
            .header("content-type", "application/x-protobuf")
            .body(envelope)
            .send()
            .await?;
        if let Some(error) = response_status_error(response.status()) {
            return Err(error);
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_ENVELOPE_BYTES as u64)
        {
            return Err(UploadError::ResponseTooLarge);
        }
        let body = read_bounded_response(response).await?;
        self.codec.decode_ack(
            &body,
            sequence,
            &delivery.report_id,
            blake3::hash(&delivery.payload).as_bytes(),
        )
    }
}

fn response_status_error(status: reqwest::StatusCode) -> Option<UploadError> {
    match status.as_u16() {
        200..=299 => None,
        401 | 403 => Some(UploadError::Revoked),
        400 | 413 | 415 | 422 => Some(UploadError::PermanentStatus(status.as_u16())),
        _ => Some(UploadError::ServerStatus),
    }
}

async fn read_bounded_response(mut response: reqwest::Response) -> Result<Vec<u8>, UploadError> {
    let capacity = response
        .content_length()
        .and_then(|length| usize::try_from(length).ok())
        .unwrap_or_default()
        .min(MAX_ENVELOPE_BYTES);
    let mut body = Vec::with_capacity(capacity);
    while let Some(chunk) = response.chunk().await? {
        append_response_chunk(&mut body, &chunk)?;
    }
    Ok(body)
}

fn append_response_chunk(body: &mut Vec<u8>, chunk: &[u8]) -> Result<(), UploadError> {
    if chunk.len() > MAX_ENVELOPE_BYTES.saturating_sub(body.len()) {
        return Err(UploadError::ResponseTooLarge);
    }
    body.extend_from_slice(chunk);
    Ok(())
}

impl EnvelopeCodec {
    pub fn new(
        agent_id: Vec<u8>,
        key_epoch: u32,
        root_key: [u8; 32],
        nonce_prefix: [u8; 4],
    ) -> Result<Self, UploadError> {
        let keys = DirectionalKeys::derive(&root_key, &agent_id, key_epoch)
            .map_err(|_| UploadError::Authentication)?;
        Ok(Self {
            agent_id,
            key_epoch,
            nonce_prefix,
            keys,
        })
    }

    pub fn encode_report(
        &self,
        sequence: u64,
        sent_at_ms: i64,
        report_id: &[u8],
        compressed_payload: &[u8],
    ) -> Result<Vec<u8>, UploadError> {
        if sequence == 0 || report_id.is_empty() {
            return Err(UploadError::Protocol);
        }
        let header = EnvelopeHeader {
            protocol_version: PROTOCOL_VERSION,
            agent_id: self.agent_id.clone(),
            key_epoch: self.key_epoch,
            sequence,
            sent_at_ms,
            report_id: report_id.to_vec(),
        };
        let aad = encode_message(&header);
        let ciphertext = seal(
            &self.keys.client_to_server,
            self.nonce_prefix,
            sequence,
            &aad,
            compressed_payload,
        )
        .map_err(|_| UploadError::Authentication)?;
        let envelope = encode_message(&EncryptedEnvelope {
            header: Some(header),
            ciphertext,
        });
        if envelope.len() > MAX_ENVELOPE_BYTES {
            return Err(UploadError::Protocol);
        }
        Ok(envelope)
    }

    pub fn decode_ack(
        &self,
        body: &[u8],
        expected_sequence: u64,
        expected_report_id: &[u8],
        expected_payload_hash: &[u8],
    ) -> Result<DurableAck, UploadError> {
        if body.len() > MAX_ENVELOPE_BYTES {
            return Err(UploadError::ResponseTooLarge);
        }
        let response_envelope: EncryptedEnvelope =
            decode_message(body).map_err(|_| UploadError::Protocol)?;
        let response_header = response_envelope.header.ok_or(UploadError::Protocol)?;
        if response_header.agent_id != self.agent_id
            || response_header.key_epoch != self.key_epoch
            || response_header.sequence != expected_sequence
            || response_header.report_id != expected_report_id
        {
            return Err(UploadError::Protocol);
        }
        let response_aad = encode_message(&response_header);
        let plaintext = open(
            &self.keys.server_to_client,
            self.nonce_prefix,
            expected_sequence,
            &response_aad,
            &response_envelope.ciphertext,
        )
        .map_err(|_| UploadError::Authentication)?;
        let acknowledgement: DurableAck =
            decode_message(&plaintext).map_err(|_| UploadError::Protocol)?;
        let status =
            AckStatus::try_from(acknowledgement.status).map_err(|_| UploadError::Protocol)?;
        if acknowledgement.report_id != expected_report_id
            || acknowledgement.payload_hash != expected_payload_hash
            || !matches!(status, AckStatus::Committed | AckStatus::Duplicate)
        {
            return Err(UploadError::Protocol);
        }
        Ok(acknowledgement)
    }
}

#[cfg(test)]
mod tests {
    use alphaping_crypto::{DirectionalKeys, open, seal};
    use alphaping_protocol::{
        MAX_ENVELOPE_BYTES, PROTOCOL_VERSION, decode_message, encode_message,
        v1::{AckStatus, DurableAck, EncryptedEnvelope, EnvelopeHeader},
    };

    use super::{
        EnvelopeCodec, UploadError, append_response_chunk, pq_client, response_status_error,
    };

    #[test]
    fn pq_http_client_accepts_the_preconfigured_rustls_backend() {
        pq_client().expect("PQ HTTP client should initialize");
    }

    #[test]
    fn envelope_codec_round_trips_authenticated_report_and_ack() {
        let agent_id = b"018f5f7e-7d28-7e12-a521-123456789abc".to_vec();
        let root_key = [7; 32];
        let nonce_prefix = [1, 2, 3, 4];
        let codec = EnvelopeCodec::new(agent_id.clone(), 1, root_key, nonce_prefix)
            .expect("codec should initialize");
        let report_id = [9; 16];
        let compressed = b"compressed protobuf";
        let request = codec
            .encode_report(4, 100, &report_id, compressed)
            .expect("request envelope");
        let request: EncryptedEnvelope = decode_message(&request).expect("request protobuf");
        let request_header = request.header.expect("request header");
        let keys = DirectionalKeys::derive(&root_key, &agent_id, 1).expect("keys");
        assert_eq!(
            open(
                &keys.client_to_server,
                nonce_prefix,
                4,
                &encode_message(&request_header),
                &request.ciphertext,
            )
            .expect("authenticated request"),
            compressed
        );

        let acknowledgement = DurableAck {
            report_id: report_id.to_vec(),
            status: AckStatus::Committed as i32,
            committed_at_ms: 101,
            config_revision: 1,
            config: None,
            commands: Vec::new(),
            live_session: None,
            key_rotation: None,
            payload_hash: blake3::hash(compressed).as_bytes().to_vec(),
        };
        let response_header = EnvelopeHeader {
            protocol_version: PROTOCOL_VERSION,
            agent_id,
            key_epoch: 1,
            sequence: 4,
            sent_at_ms: 101,
            report_id: report_id.to_vec(),
        };
        let ciphertext = seal(
            &keys.server_to_client,
            nonce_prefix,
            4,
            &encode_message(&response_header),
            &encode_message(&acknowledgement),
        )
        .expect("response encryption");
        let response = encode_message(&EncryptedEnvelope {
            header: Some(response_header),
            ciphertext,
        });
        assert_eq!(
            codec
                .decode_ack(
                    &response,
                    4,
                    &report_id,
                    blake3::hash(compressed).as_bytes(),
                )
                .expect("authenticated ACK"),
            acknowledgement
        );
        assert!(matches!(
            codec.decode_ack(
                &response,
                5,
                &report_id,
                blake3::hash(compressed).as_bytes(),
            ),
            Err(UploadError::Protocol)
        ));
        assert!(matches!(
            codec.decode_ack(&response, 4, &report_id, &[0; 32]),
            Err(UploadError::Protocol)
        ));
    }

    #[test]
    fn response_chunks_stop_at_the_protocol_limit() {
        let mut body = Vec::new();
        append_response_chunk(&mut body, &vec![1; MAX_ENVELOPE_BYTES - 1])
            .expect("first response chunk");
        append_response_chunk(&mut body, &[2]).expect("response at exact limit");
        assert_eq!(body.len(), MAX_ENVELOPE_BYTES);
        assert!(matches!(
            append_response_chunk(&mut body, &[3]),
            Err(UploadError::ResponseTooLarge)
        ));
        assert_eq!(body.len(), MAX_ENVELOPE_BYTES);
    }

    #[test]
    fn only_stable_payload_statuses_are_permanent() {
        for status in [400, 413, 415, 422] {
            assert!(matches!(
                response_status_error(reqwest::StatusCode::from_u16(status).expect("status")),
                Some(UploadError::PermanentStatus(value)) if value == status
            ));
        }
        for status in [408, 409, 425, 429, 500, 502, 503, 504] {
            assert!(matches!(
                response_status_error(reqwest::StatusCode::from_u16(status).expect("status")),
                Some(UploadError::ServerStatus)
            ));
        }
        assert!(matches!(
            response_status_error(reqwest::StatusCode::UNAUTHORIZED),
            Some(UploadError::Revoked)
        ));
        assert!(response_status_error(reqwest::StatusCode::OK).is_none());
    }
}
