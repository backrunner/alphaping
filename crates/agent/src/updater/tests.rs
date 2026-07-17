use ed25519_dalek::{Signer, SigningKey};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use super::metadata::{MetadataFile, TargetsMetadata, TrustedRoot};

fn signed(value: Value, keys: &[(String, SigningKey)]) -> Vec<u8> {
    let canonical = serde_json::to_vec(&value).expect("canonical metadata");
    serde_json::to_vec(&json!({
        "signed": value,
        "signatures": keys.iter().map(|(id, key)| json!({
            "key_id": id,
            "signature_hex": hex::encode(key.sign(&canonical).to_bytes()),
        })).collect::<Vec<_>>(),
    }))
    .expect("signed metadata")
}

fn root(keys: &[(String, SigningKey)], now: i64) -> TrustedRoot {
    let public_keys = keys
        .iter()
        .map(|(id, key)| {
            (
                id.clone(),
                json!({
                    "scheme": "ed25519",
                    "public_key_hex": hex::encode(key.verifying_key().to_bytes()),
                }),
            )
        })
        .collect::<serde_json::Map<_, _>>();
    let key_ids = keys.iter().map(|(id, _)| id).collect::<Vec<_>>();
    let bytes = serde_json::to_vec(&json!({
        "spec_version": "1.0",
        "version": 1,
        "expires_at_ms": now + 86_400_000,
        "keys": public_keys,
        "roles": {
            "timestamp": { "key_ids": [key_ids[0]], "threshold": 1 },
            "snapshot": { "key_ids": [key_ids[0]], "threshold": 1 },
            "targets": { "key_ids": key_ids, "threshold": 2 },
        },
    }))
    .expect("root metadata");
    TrustedRoot::from_json(&bytes, now).expect("trusted root")
}

#[test]
fn targets_require_the_configured_signature_threshold() {
    let now = 1_752_580_800_000;
    let keys = vec![
        ("targets-a".to_owned(), SigningKey::from_bytes(&[7; 32])),
        ("targets-b".to_owned(), SigningKey::from_bytes(&[9; 32])),
    ];
    let root = root(&keys, now);
    let value = json!({
        "type": "targets",
        "spec_version": "1.0",
        "version": 4,
        "expires_at_ms": now + 3_600_000,
        "targets": {},
    });
    let one_signature = signed(value.clone(), &keys[..1]);
    assert!(
        root.verify::<TargetsMetadata>(&one_signature, "targets", "targets", now)
            .is_err()
    );
    let two_signatures = signed(value, &keys);
    let verified = root
        .verify::<TargetsMetadata>(&two_signatures, "targets", "targets", now)
        .expect("threshold metadata");
    assert_eq!(verified.version, 4);
}

#[test]
fn chained_metadata_hash_rejects_tampering() {
    let bytes = b"signed snapshot";
    let file = MetadataFile {
        version: 2,
        length: bytes.len() as u64,
        sha256: hex::encode(Sha256::digest(bytes)),
    };
    assert!(file.verify(bytes).is_ok());
    assert!(file.verify(b"tampered snapshot").is_err());
}

#[test]
fn expired_signed_metadata_is_rejected() {
    let now = 1_752_580_800_000;
    let keys = vec![
        ("targets-a".to_owned(), SigningKey::from_bytes(&[7; 32])),
        ("targets-b".to_owned(), SigningKey::from_bytes(&[9; 32])),
    ];
    let root = root(&keys, now);
    let expired = signed(
        json!({
            "type": "targets",
            "spec_version": "1.0",
            "version": 4,
            "expires_at_ms": now,
            "targets": {},
        }),
        &keys,
    );
    assert!(
        root.verify::<TargetsMetadata>(&expired, "targets", "targets", now)
            .is_err()
    );
}
