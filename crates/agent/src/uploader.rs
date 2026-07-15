use std::{sync::Arc, time::Duration};

use alphaping_crypto::{DirectionalKeys, open, seal};
use alphaping_protocol::{
    MAX_ENVELOPE_BYTES, PROTOCOL_VERSION, decode_message, encode_message,
    v1::{AckStatus, DurableAck, EncryptedEnvelope, EnvelopeHeader},
};
use prost::Message;
use reqwest::Client;
use rustls::{
    ClientConfig, RootCertStore,
    crypto::{CryptoProvider, aws_lc_rs},
    version::TLS13,
};
use thiserror::Error;

use crate::spool::{PendingDelivery, Spool};

#[derive(Debug, Error)]
pub enum UploadError {
    #[error("transport failed")]
    Transport(#[from] reqwest::Error),
    #[error("server rejected the agent identity")]
    Revoked,
    #[error("server returned a transient status")]
    ServerStatus,
    #[error("response exceeded the protocol limit")]
    ResponseTooLarge,
    #[error("response protocol was invalid")]
    Protocol,
    #[error("response authentication failed")]
    Authentication,
    #[error("local sequence state failed")]
    Sequence,
}

pub struct Uploader {
    client: Client,
    endpoint: String,
    agent_id: Vec<u8>,
    key_epoch: u32,
    nonce_prefix: [u8; 4],
    keys: DirectionalKeys,
}

impl Uploader {
    pub fn new(
        endpoint: String,
        agent_id: Vec<u8>,
        key_epoch: u32,
        root_key: [u8; 32],
        nonce_prefix: [u8; 4],
    ) -> Result<Self, UploadError> {
        let keys = DirectionalKeys::derive(&root_key, &agent_id, key_epoch)
            .map_err(|_| UploadError::Authentication)?;
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
        let client = Client::builder()
            .use_preconfigured_tls(tls)
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(8))
            .build()?;
        Ok(Self {
            client,
            endpoint,
            agent_id,
            key_epoch,
            nonce_prefix,
            keys,
        })
    }

    pub async fn upload(
        &self,
        spool: &mut Spool,
        delivery: &PendingDelivery,
        now_ms: i64,
    ) -> Result<(), UploadError> {
        let sequence = spool.next_sequence().map_err(|_| UploadError::Sequence)?;
        let header = EnvelopeHeader {
            protocol_version: PROTOCOL_VERSION,
            agent_id: self.agent_id.clone(),
            key_epoch: self.key_epoch,
            sequence,
            sent_at_ms: now_ms,
            report_id: delivery.report_id.clone(),
        };
        let aad = encode_message(&header);
        let ciphertext = seal(
            &self.keys.client_to_server,
            self.nonce_prefix,
            sequence,
            &aad,
            &delivery.payload,
        )
        .map_err(|_| UploadError::Authentication)?;
        let envelope = EncryptedEnvelope {
            header: Some(header),
            ciphertext,
        }
        .encode_to_vec();
        if envelope.len() > MAX_ENVELOPE_BYTES {
            return Err(UploadError::Protocol);
        }

        let response = self
            .client
            .post(&self.endpoint)
            .header("content-type", "application/x-protobuf")
            .body(envelope)
            .send()
            .await?;
        if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            return Err(UploadError::Revoked);
        }
        if !response.status().is_success() {
            return Err(UploadError::ServerStatus);
        }
        if response
            .content_length()
            .is_some_and(|length| length as usize > MAX_ENVELOPE_BYTES)
        {
            return Err(UploadError::ResponseTooLarge);
        }
        let body = response.bytes().await?;
        if body.len() > MAX_ENVELOPE_BYTES {
            return Err(UploadError::ResponseTooLarge);
        }
        let response_envelope: EncryptedEnvelope =
            decode_message(&body).map_err(|_| UploadError::Protocol)?;
        let response_header = response_envelope.header.ok_or(UploadError::Protocol)?;
        if response_header.agent_id != self.agent_id
            || response_header.key_epoch != self.key_epoch
            || response_header.sequence != sequence
            || response_header.report_id != delivery.report_id
        {
            return Err(UploadError::Protocol);
        }
        let response_aad = encode_message(&response_header);
        let plaintext = open(
            &self.keys.server_to_client,
            self.nonce_prefix,
            sequence,
            &response_aad,
            &response_envelope.ciphertext,
        )
        .map_err(|_| UploadError::Authentication)?;
        let acknowledgement: DurableAck =
            decode_message(&plaintext).map_err(|_| UploadError::Protocol)?;
        let status =
            AckStatus::try_from(acknowledgement.status).map_err(|_| UploadError::Protocol)?;
        if acknowledgement.report_id != delivery.report_id
            || !matches!(status, AckStatus::Committed | AckStatus::Duplicate)
        {
            return Err(UploadError::Protocol);
        }
        if !spool
            .acknowledge(&delivery.report_id)
            .map_err(|_| UploadError::Sequence)?
        {
            return Err(UploadError::Protocol);
        }
        Ok(())
    }
}
