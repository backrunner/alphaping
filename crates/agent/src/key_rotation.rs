use alphaping_protocol::v1::KeyRotationProposal;
use anyhow::{Result, bail};

use crate::config::AgentConfig;

const MAX_FUTURE_SKEW_MS: i64 = 5 * 60_000;
const MIN_KEY_LIFETIME_MS: i64 = 24 * 60 * 60_000;
const MAX_KEY_LIFETIME_MS: i64 = 90 * 24 * 60 * 60_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ValidatedKeyRotation {
    pub key_epoch: u32,
    pub data_key: [u8; 32],
    pub nonce_prefix: [u8; 4],
}

pub fn validate_key_rotation(
    proposal: &KeyRotationProposal,
    current_epoch: u32,
    now_ms: i64,
) -> Result<ValidatedKeyRotation> {
    let expected_epoch = current_epoch
        .checked_add(1)
        .ok_or_else(|| anyhow::anyhow!("Agent key epoch is exhausted"))?;
    if proposal.key_epoch != expected_epoch {
        bail!("Agent key rotation epoch is not the next epoch");
    }
    let data_key = proposal
        .data_key
        .as_slice()
        .try_into()
        .map_err(|_| anyhow::anyhow!("Agent key rotation data key is invalid"))?;
    let nonce_prefix = proposal
        .nonce_prefix
        .as_slice()
        .try_into()
        .map_err(|_| anyhow::anyhow!("Agent key rotation nonce prefix is invalid"))?;
    let lifetime = proposal
        .valid_until_ms
        .checked_sub(proposal.valid_from_ms)
        .ok_or_else(|| anyhow::anyhow!("Agent key rotation validity window is invalid"))?;
    if proposal.valid_from_ms > now_ms.saturating_add(MAX_FUTURE_SKEW_MS)
        || proposal.valid_until_ms <= now_ms.saturating_add(MIN_KEY_LIFETIME_MS)
        || !(MIN_KEY_LIFETIME_MS..=MAX_KEY_LIFETIME_MS).contains(&lifetime)
    {
        bail!("Agent key rotation validity window is invalid");
    }
    Ok(ValidatedKeyRotation {
        key_epoch: proposal.key_epoch,
        data_key,
        nonce_prefix,
    })
}

pub fn rotated_agent_config(
    current: &AgentConfig,
    proposal: &KeyRotationProposal,
    now_ms: i64,
) -> Result<AgentConfig> {
    let rotation = validate_key_rotation(proposal, current.key_epoch, now_ms)?;
    let mut updated = current.clone();
    updated.key_epoch = rotation.key_epoch;
    updated.data_key_hex = hex::encode(rotation.data_key);
    updated.nonce_prefix_hex = hex::encode(rotation.nonce_prefix);
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use alphaping_protocol::v1::KeyRotationProposal;

    use crate::config::AgentConfig;

    use super::{MAX_KEY_LIFETIME_MS, rotated_agent_config, validate_key_rotation};

    fn proposal(now_ms: i64) -> KeyRotationProposal {
        KeyRotationProposal {
            key_epoch: 2,
            data_key: vec![7; 32],
            nonce_prefix: vec![1, 2, 3, 4],
            valid_from_ms: now_ms,
            valid_until_ms: now_ms + MAX_KEY_LIFETIME_MS,
        }
    }

    #[test]
    fn accepts_the_next_authenticated_key_epoch() {
        let now_ms = 1_800_000_000_000;
        let validated =
            validate_key_rotation(&proposal(now_ms), 1, now_ms).expect("valid rotation proposal");
        assert_eq!(validated.key_epoch, 2);
        assert_eq!(validated.data_key, [7; 32]);
        assert_eq!(validated.nonce_prefix, [1, 2, 3, 4]);
    }

    #[test]
    fn rejects_skipped_epochs_and_malformed_material() {
        let now_ms = 1_800_000_000_000;
        let mut skipped = proposal(now_ms);
        skipped.key_epoch = 3;
        assert!(validate_key_rotation(&skipped, 1, now_ms).is_err());

        let mut malformed = proposal(now_ms);
        malformed.data_key.pop();
        assert!(validate_key_rotation(&malformed, 1, now_ms).is_err());
    }

    #[test]
    fn rejects_expired_or_overlong_validity_windows() {
        let now_ms = 1_800_000_000_000;
        let mut expired = proposal(now_ms);
        expired.valid_from_ms = now_ms - MAX_KEY_LIFETIME_MS;
        expired.valid_until_ms = now_ms;
        assert!(validate_key_rotation(&expired, 1, now_ms).is_err());

        let mut overlong = proposal(now_ms);
        overlong.valid_until_ms += 1;
        assert!(validate_key_rotation(&overlong, 1, now_ms).is_err());
    }

    #[test]
    fn updates_only_the_transport_key_material() {
        let now_ms = 1_800_000_000_000;
        let current = AgentConfig {
            endpoint: "https://ingest.example.test/v1/reports".to_owned(),
            agent_id: "018f5f7e-7d28-7e12-a521-123456789abc".to_owned(),
            machine_pk: 7,
            workspace_pk: 3,
            key_epoch: 1,
            data_key_hex: hex::encode([1; 32]),
            nonce_prefix_hex: hex::encode([2; 4]),
            identity_private_key_hex: hex::encode([3; 32]),
            spool_path: "/tmp/alphaping-key-rotation-test.db".to_owned(),
            sample_interval_seconds: 10,
            report_interval_seconds: 60,
            max_spool_bytes: 512 * 1024 * 1024,
            container_monitoring_enabled: true,
            auto_update: true,
            update_channel: "stable".to_owned(),
            pinned_version: None,
        };
        let updated =
            rotated_agent_config(&current, &proposal(now_ms), now_ms).expect("rotated config");
        assert_eq!(updated.key_epoch, 2);
        assert_eq!(updated.data_key_hex, hex::encode([7; 32]));
        assert_eq!(updated.nonce_prefix_hex, "01020304");
        assert_eq!(
            updated.identity_private_key_hex,
            current.identity_private_key_hex
        );
        assert_eq!(updated.spool_path, current.spool_path);
    }
}
