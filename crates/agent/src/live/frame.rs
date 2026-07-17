use alphaping_crypto::seal;
use alphaping_protocol::{encode_message, v1::LiveSessionCredential, v1::MetricSample};
use anyhow::{Context, Result, bail};

const MAX_LIVE_FRAME_BYTES: usize = 16 * 1024;

pub(super) fn validate_credential(credential: &LiveSessionCredential, now_ms: i64) -> Result<()> {
    if !credential.endpoint.starts_with("wss://")
        || credential.endpoint.len() > 512
        || credential
            .endpoint
            .bytes()
            .any(|byte| byte.is_ascii_whitespace())
        || credential.ticket.is_empty()
        || credential.ticket.len() > 4_096
        || !credential
            .ticket
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        || credential.session_id.len() != 16
        || credential.session_key.len() != 32
        || credential.nonce_prefix.len() != 4
        || credential.expires_at_ms <= now_ms
        || credential.expires_at_ms > now_ms.saturating_add(15 * 60_000)
    {
        bail!("live session credential is invalid");
    }
    Ok(())
}

pub(super) fn seal_live_snapshot(
    credential: &LiveSessionCredential,
    machine_pk: u64,
    sequence: u64,
    sample: &MetricSample,
) -> Result<Vec<u8>> {
    if sample.observed_at_ms <= 0 || sequence == 0 || sequence > 1_000_000 {
        bail!("live snapshot header is invalid");
    }
    let session_key: [u8; 32] = credential
        .session_key
        .as_slice()
        .try_into()
        .context("live session key is invalid")?;
    let nonce_prefix: [u8; 4] = credential
        .nonce_prefix
        .as_slice()
        .try_into()
        .context("live nonce prefix is invalid")?;
    let mut aad = Vec::with_capacity(44);
    aad.extend_from_slice(b"APL1");
    aad.extend_from_slice(&credential.session_id);
    aad.extend_from_slice(&machine_pk.to_be_bytes());
    aad.extend_from_slice(&sequence.to_be_bytes());
    aad.extend_from_slice(
        &u64::try_from(sample.observed_at_ms)
            .context("live observed time is invalid")?
            .to_be_bytes(),
    );
    let ciphertext = seal(
        &session_key,
        nonce_prefix,
        sequence,
        &aad,
        &encode_message(sample),
    )
    .context("live snapshot encryption failed")?;
    let ciphertext_len = u32::try_from(ciphertext.len()).context("live snapshot is too large")?;
    let mut frame = Vec::with_capacity(48 + ciphertext.len());
    frame.extend_from_slice(&aad);
    frame.extend_from_slice(&ciphertext_len.to_be_bytes());
    frame.extend_from_slice(&ciphertext);
    if frame.len() > MAX_LIVE_FRAME_BYTES {
        bail!("live snapshot exceeds the frame limit");
    }
    Ok(frame)
}

#[cfg(test)]
mod tests {
    use alphaping_crypto::open;
    use alphaping_protocol::{decode_message, v1::MetricSample};

    use super::{LiveSessionCredential, seal_live_snapshot, validate_credential};

    fn credential(expires_at_ms: i64) -> LiveSessionCredential {
        LiveSessionCredential {
            endpoint: "wss://live.example.test/v1/live/workspace-1".to_owned(),
            ticket: "payload.signature".to_owned(),
            session_id: vec![1; 16],
            session_key: vec![2; 32],
            nonce_prefix: vec![3; 4],
            expires_at_ms,
        }
    }

    #[test]
    fn frame_header_is_authenticated_and_plaintext_is_protobuf() {
        let sample = MetricSample {
            observed_at_ms: 1_752_580_800_000,
            cpu_permille: 417,
            memory_used_bytes: 2_048,
            load_1m_milli: Some(1_250),
            uptime_seconds: Some(86_400),
            ..MetricSample::default()
        };
        let credential = credential(sample.observed_at_ms + 60_000);
        let frame = seal_live_snapshot(&credential, 7, 3, &sample).expect("live frame");
        assert_eq!(&frame[..4], b"APL1");
        assert_eq!(&frame[4..20], &[1; 16]);
        let ciphertext_len = u32::from_be_bytes(frame[44..48].try_into().expect("length"));
        assert_eq!(
            usize::try_from(ciphertext_len).expect("size"),
            frame.len() - 48
        );
        let plaintext =
            open(&[2; 32], [3; 4], 3, &frame[..44], &frame[48..]).expect("authenticated frame");
        assert_eq!(
            decode_message::<MetricSample>(&plaintext).expect("protobuf sample"),
            sample
        );
    }

    #[test]
    fn credential_rejects_plaintext_transport_and_invalid_key_sizes() {
        let mut value = credential(100_000);
        assert!(validate_credential(&value, 1).is_ok());
        value.endpoint = "ws://live.example.test".to_owned();
        assert!(validate_credential(&value, 1).is_err());
        value.endpoint = "wss://live.example.test".to_owned();
        value.session_key.pop();
        assert!(validate_credential(&value, 1).is_err());
    }
}
