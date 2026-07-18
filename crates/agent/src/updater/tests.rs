use std::{collections::BTreeMap, sync::Arc};

use ed25519_dalek::{Signer, SigningKey};
use semver::Version;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

use super::{
    client::{MetadataVersions, UpdateClient},
    metadata::{MetadataFile, TargetsMetadata, TrustedRoot},
};

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

fn metadata_file(version: u64, bytes: &[u8]) -> Value {
    json!({
        "version": version,
        "length": bytes.len(),
        "sha256": hex::encode(Sha256::digest(bytes)),
    })
}

async fn serve_files(files: BTreeMap<String, Vec<u8>>) -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind update fixture");
    let address = listener.local_addr().expect("fixture address");
    let files = Arc::new(files);
    let requests = files.len();
    let task = tokio::spawn(async move {
        for _ in 0..requests {
            let (mut stream, _) = listener.accept().await.expect("accept update request");
            let mut request = vec![0_u8; 8 * 1024];
            let length = stream
                .read(&mut request)
                .await
                .expect("read update request");
            let request = std::str::from_utf8(&request[..length]).expect("HTTP request text");
            let path = request
                .lines()
                .next()
                .and_then(|line| line.split_ascii_whitespace().nth(1))
                .expect("HTTP request path");
            let body = files.get(path).expect("known update fixture path");
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("write update headers");
            stream.write_all(body).await.expect("write update body");
        }
    });
    (format!("http://{address}"), task)
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

#[tokio::test]
async fn downloads_an_artifact_through_the_full_signed_metadata_chain() {
    let now = 1_752_580_800_000;
    let keys = vec![
        ("targets-a".to_owned(), SigningKey::from_bytes(&[7; 32])),
        ("targets-b".to_owned(), SigningKey::from_bytes(&[9; 32])),
    ];
    let trusted_root = root(&keys, now);
    let artifact_path = "alphaping-agent-test-bin";
    let artifact = b"signed Agent artifact fixture\n".to_vec();
    let targets = signed(
        json!({
            "type": "targets",
            "spec_version": "1.0",
            "version": 3,
            "expires_at_ms": now + 3_600_000,
            "targets": {
                (artifact_path): {
                    "version": "0.2.0",
                    "platform": std::env::consts::OS,
                    "arch": std::env::consts::ARCH,
                    "channel": "stable",
                    "length": artifact.len(),
                    "sha256": hex::encode(Sha256::digest(&artifact)),
                    "rollout_percent": 100,
                }
            },
        }),
        &keys,
    );
    let snapshot = signed(
        json!({
            "type": "snapshot",
            "spec_version": "1.0",
            "version": 2,
            "expires_at_ms": now + 3_600_000,
            "targets": metadata_file(3, &targets),
        }),
        &keys[..1],
    );
    let timestamp = signed(
        json!({
            "type": "timestamp",
            "spec_version": "1.0",
            "version": 1,
            "expires_at_ms": now + 3_600_000,
            "snapshot": metadata_file(2, &snapshot),
        }),
        &keys[..1],
    );
    let files = BTreeMap::from([
        ("/alphaping-tuf-timestamp.json".to_owned(), timestamp),
        ("/alphaping-tuf-snapshot.json".to_owned(), snapshot),
        ("/alphaping-tuf-targets.json".to_owned(), targets),
        (format!("/{artifact_path}"), artifact.clone()),
    ]);
    let (base_url, server) = serve_files(files).await;
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let client = UpdateClient::with_base_url(
        reqwest::Client::builder()
            .build()
            .expect("update HTTP client"),
        trusted_root,
        "agent-update-e2e".to_owned(),
        base_url,
    );

    let (downloaded, versions) = client
        .find_update(
            &Version::parse("0.1.0").expect("current version"),
            None,
            "stable",
            false,
            MetadataVersions::default(),
            now,
        )
        .await
        .expect("verified update");

    let downloaded = downloaded.expect("selected update");
    assert_eq!(downloaded.version, Version::parse("0.2.0").unwrap());
    assert_eq!(downloaded.bytes, artifact);
    assert_eq!(versions.timestamp, 1);
    assert_eq!(versions.snapshot, 2);
    assert_eq!(versions.targets, 3);
    server.await.expect("update fixture completed");
}

#[tokio::test]
async fn exact_version_install_respects_rollout_selection() {
    let now = 1_752_580_800_000;
    let keys = vec![
        ("targets-a".to_owned(), SigningKey::from_bytes(&[7; 32])),
        ("targets-b".to_owned(), SigningKey::from_bytes(&[9; 32])),
    ];
    let trusted_root = root(&keys, now);
    let artifact_path = "alphaping-agent-test-bin";
    let artifact = b"signed Agent artifact fixture\n";
    let targets = signed(
        json!({
            "type": "targets",
            "spec_version": "1.0",
            "version": 3,
            "expires_at_ms": now + 3_600_000,
            "targets": {
                (artifact_path): {
                    "version": "0.2.0",
                    "platform": std::env::consts::OS,
                    "arch": std::env::consts::ARCH,
                    "channel": "stable",
                    "length": artifact.len(),
                    "sha256": hex::encode(Sha256::digest(artifact)),
                    "rollout_percent": 0,
                }
            },
        }),
        &keys,
    );
    let snapshot = signed(
        json!({
            "type": "snapshot",
            "spec_version": "1.0",
            "version": 2,
            "expires_at_ms": now + 3_600_000,
            "targets": metadata_file(3, &targets),
        }),
        &keys[..1],
    );
    let timestamp = signed(
        json!({
            "type": "timestamp",
            "spec_version": "1.0",
            "version": 1,
            "expires_at_ms": now + 3_600_000,
            "snapshot": metadata_file(2, &snapshot),
        }),
        &keys[..1],
    );
    let files = BTreeMap::from([
        ("/alphaping-tuf-timestamp.json".to_owned(), timestamp),
        ("/alphaping-tuf-snapshot.json".to_owned(), snapshot),
        ("/alphaping-tuf-targets.json".to_owned(), targets),
    ]);
    let (base_url, server) = serve_files(files).await;
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let client = UpdateClient::with_base_url(
        reqwest::Client::builder()
            .build()
            .expect("update HTTP client"),
        trusted_root,
        "agent-update-e2e".to_owned(),
        base_url,
    );

    let (downloaded, _) = client
        .find_update(
            &Version::parse("0.1.0").expect("current version"),
            Some(&Version::parse("0.2.0").expect("requested version")),
            "stable",
            false,
            MetadataVersions::default(),
            now,
        )
        .await
        .expect("verified rollout exclusion");

    assert!(downloaded.is_none());
    server.await.expect("update fixture completed");
}
