use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result, bail};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use sha2::{Digest, Sha256};

const MAX_SIGNATURES: usize = 16;
const MAX_KEYS: usize = 16;

#[derive(Clone, Debug, Deserialize)]
pub struct TrustedRoot {
    pub spec_version: String,
    pub version: u64,
    pub expires_at_ms: i64,
    keys: BTreeMap<String, KeyDescription>,
    roles: BTreeMap<String, RoleDescription>,
}

#[derive(Clone, Debug, Deserialize)]
struct KeyDescription {
    scheme: String,
    public_key_hex: String,
}

#[derive(Clone, Debug, Deserialize)]
struct RoleDescription {
    key_ids: Vec<String>,
    threshold: usize,
}

#[derive(Clone, Debug, Deserialize)]
struct MetadataEnvelope {
    signed: Value,
    signatures: Vec<MetadataSignature>,
}

#[derive(Clone, Debug, Deserialize)]
struct MetadataSignature {
    key_id: String,
    signature_hex: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MetadataFile {
    pub version: u64,
    pub length: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TimestampMetadata {
    #[serde(rename = "type")]
    pub metadata_type: String,
    pub spec_version: String,
    pub version: u64,
    pub expires_at_ms: i64,
    pub snapshot: MetadataFile,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SnapshotMetadata {
    #[serde(rename = "type")]
    pub metadata_type: String,
    pub spec_version: String,
    pub version: u64,
    pub expires_at_ms: i64,
    pub targets: MetadataFile,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TargetsMetadata {
    #[serde(rename = "type")]
    pub metadata_type: String,
    pub spec_version: String,
    pub version: u64,
    pub expires_at_ms: i64,
    pub targets: BTreeMap<String, TargetDescription>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TargetDescription {
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub channel: String,
    pub length: u64,
    pub sha256: String,
    pub rollout_percent: u8,
}

impl TrustedRoot {
    pub fn from_json(bytes: &[u8], now_ms: i64) -> Result<Self> {
        if bytes.len() > 64 * 1024 {
            bail!("update root metadata is too large");
        }
        let root: Self =
            serde_json::from_slice(bytes).context("update root metadata is invalid")?;
        if root.spec_version != "1.0"
            || root.version == 0
            || root.expires_at_ms <= now_ms
            || root.keys.is_empty()
            || root.keys.len() > MAX_KEYS
        {
            bail!("update root metadata fields are invalid");
        }
        for role in ["timestamp", "snapshot", "targets"] {
            let definition = root
                .roles
                .get(role)
                .with_context(|| format!("update root omitted the {role} role"))?;
            if definition.threshold == 0
                || definition.threshold > definition.key_ids.len()
                || definition
                    .key_ids
                    .iter()
                    .any(|key_id| !root.keys.contains_key(key_id))
            {
                bail!("update root role is invalid");
            }
        }
        Ok(root)
    }

    pub fn verify<T: DeserializeOwned>(
        &self,
        bytes: &[u8],
        role: &str,
        expected_type: &str,
        now_ms: i64,
    ) -> Result<T> {
        if bytes.len() > 256 * 1024 {
            bail!("update metadata is too large");
        }
        let envelope: MetadataEnvelope =
            serde_json::from_slice(bytes).context("update metadata envelope is invalid")?;
        if envelope.signatures.is_empty() || envelope.signatures.len() > MAX_SIGNATURES {
            bail!("update metadata signatures are invalid");
        }
        let definition = self
            .roles
            .get(role)
            .context("update metadata role is not trusted")?;
        let canonical = serde_json::to_vec(&envelope.signed)?;
        let mut verified = BTreeSet::new();
        for signature in envelope.signatures {
            let key_id = signature.key_id.clone();
            if !definition.key_ids.contains(&signature.key_id)
                || !verified.insert(signature.key_id.clone())
            {
                continue;
            }
            let key = self
                .keys
                .get(&signature.key_id)
                .context("update metadata key is missing")?;
            if key.scheme != "ed25519" {
                bail!("update metadata key scheme is unsupported");
            }
            let public_key: [u8; 32] = hex::decode(&key.public_key_hex)
                .context("update public key is invalid")?
                .try_into()
                .map_err(|_| anyhow::anyhow!("update public key is invalid"))?;
            let verifying_key =
                VerifyingKey::from_bytes(&public_key).context("update public key is invalid")?;
            let signature = Signature::from_slice(
                &hex::decode(&signature.signature_hex).context("update signature is invalid")?,
            )
            .context("update signature is invalid")?;
            if verifying_key.verify_strict(&canonical, &signature).is_err() {
                verified.remove(&key_id);
            }
        }
        if verified.len() < definition.threshold {
            bail!("update metadata signature threshold was not met");
        }
        let metadata: Value = envelope.signed;
        if metadata.get("type").and_then(Value::as_str) != Some(expected_type)
            || metadata.get("spec_version").and_then(Value::as_str) != Some("1.0")
            || metadata
                .get("expires_at_ms")
                .and_then(Value::as_i64)
                .is_none_or(|expires_at| expires_at <= now_ms)
        {
            bail!("update metadata type or expiry is invalid");
        }
        serde_json::from_value(metadata).context("update metadata fields are invalid")
    }
}

impl MetadataFile {
    pub fn verify(&self, bytes: &[u8]) -> Result<()> {
        if self.length != bytes.len() as u64
            || self.sha256.len() != 64
            || !self.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            bail!("update metadata length or hash is invalid");
        }
        let actual = hex::encode(Sha256::digest(bytes));
        if !actual.eq_ignore_ascii_case(&self.sha256) {
            bail!("update metadata hash did not match");
        }
        Ok(())
    }
}

pub fn embedded_root(now_ms: i64) -> Result<TrustedRoot> {
    let root = option_env!("ALPHAPING_UPDATE_ROOT_JSON")
        .context("release root is not embedded in this Agent build")?;
    TrustedRoot::from_json(root.as_bytes(), now_ms)
}

pub fn embedded_root_sha256(now_ms: i64) -> Result<String> {
    let root = option_env!("ALPHAPING_UPDATE_ROOT_JSON")
        .context("release root is not embedded in this Agent build")?;
    TrustedRoot::from_json(root.as_bytes(), now_ms)?;
    let canonical: Value = serde_json::from_str(root)?;
    Ok(hex::encode(Sha256::digest(serde_json::to_vec(&canonical)?)))
}
