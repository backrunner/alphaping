use std::{collections::BTreeMap, sync::Mutex};

use anyhow::{Context, Result, bail};
use futures_util::StreamExt;
use reqwest::Client;
use semver::Version;
use sha2::{Digest, Sha256};

use super::metadata::{
    SnapshotMetadata, TargetDescription, TargetsMetadata, TimestampMetadata, TrustedRoot,
};

const RELEASE_BASE_URL: &str = "https://github.com/BackRunner/alphaping/releases/latest/download";
const MAX_METADATA_BYTES: usize = 256 * 1024;
const MAX_ARTIFACT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct MetadataVersions {
    pub timestamp: u64,
    pub snapshot: u64,
    pub targets: u64,
}

#[derive(Debug)]
pub struct DownloadedTarget {
    pub version: Version,
    pub bytes: Vec<u8>,
}

pub struct UpdateClient {
    http: Client,
    root: TrustedRoot,
    agent_id: String,
    base_url: String,
    metadata_cache: Mutex<BTreeMap<String, CacheEntry>>,
}

#[derive(Clone)]
struct CacheEntry {
    etag: String,
    bytes: Vec<u8>,
}

impl UpdateClient {
    pub fn new(http: Client, root: TrustedRoot, agent_id: String) -> Self {
        Self::with_base_url(http, root, agent_id, RELEASE_BASE_URL.to_owned())
    }

    pub(super) fn with_base_url(
        http: Client,
        root: TrustedRoot,
        agent_id: String,
        base_url: String,
    ) -> Self {
        Self {
            http,
            root,
            agent_id,
            base_url,
            metadata_cache: Mutex::new(BTreeMap::new()),
        }
    }

    pub async fn find_update(
        &self,
        current_version: &Version,
        requested_version: Option<&Version>,
        channel: &str,
        bypass_rollout: bool,
        previous: MetadataVersions,
        now_ms: i64,
    ) -> Result<(Option<DownloadedTarget>, MetadataVersions)> {
        let timestamp_bytes = self
            .fetch_bounded("alphaping-tuf-timestamp.json", MAX_METADATA_BYTES)
            .await?;
        let timestamp: TimestampMetadata =
            self.root
                .verify(&timestamp_bytes, "timestamp", "timestamp", now_ms)?;
        if timestamp.version < previous.timestamp || timestamp.snapshot.version < previous.snapshot
        {
            bail!("update timestamp attempted a metadata rollback");
        }

        let snapshot_bytes = self
            .fetch_bounded("alphaping-tuf-snapshot.json", MAX_METADATA_BYTES)
            .await?;
        timestamp.snapshot.verify(&snapshot_bytes)?;
        let snapshot: SnapshotMetadata =
            self.root
                .verify(&snapshot_bytes, "snapshot", "snapshot", now_ms)?;
        if snapshot.version != timestamp.snapshot.version
            || snapshot.version < previous.snapshot
            || snapshot.targets.version < previous.targets
        {
            bail!("update snapshot metadata version is invalid");
        }

        let targets_bytes = self
            .fetch_bounded("alphaping-tuf-targets.json", MAX_METADATA_BYTES)
            .await?;
        snapshot.targets.verify(&targets_bytes)?;
        let targets: TargetsMetadata =
            self.root
                .verify(&targets_bytes, "targets", "targets", now_ms)?;
        if targets.version != snapshot.targets.version || targets.version < previous.targets {
            bail!("update targets metadata version is invalid");
        }
        let versions = MetadataVersions {
            timestamp: timestamp.version,
            snapshot: snapshot.version,
            targets: targets.version,
        };

        let platform = std::env::consts::OS;
        let arch = std::env::consts::ARCH;
        let mut candidates = targets
            .targets
            .into_iter()
            .filter_map(|(path, target)| {
                let version = Version::parse(&target.version).ok()?;
                (target.platform == platform
                    && target.arch == arch
                    && target.channel == channel
                    && valid_target_path(&path)
                    && target.length > 0
                    && target.length <= MAX_ARTIFACT_BYTES as u64
                    && target.sha256.len() == 64
                    && target.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
                    && target.rollout_percent <= 100)
                    .then_some((path, target, version))
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| right.2.cmp(&left.2));
        let selected = if let Some(requested) = requested_version {
            candidates
                .into_iter()
                .find(|(_, _, version)| version == requested)
                .with_context(|| format!("requested Agent version {requested} is not published"))?
        } else {
            let Some(candidate) = candidates
                .into_iter()
                .find(|(_, _, version)| version > current_version)
            else {
                return Ok((None, versions));
            };
            candidate
        };
        if !bypass_rollout && !self.within_rollout(&selected.2, &selected.1) {
            return Ok((None, versions));
        }

        let bytes = self
            .fetch_bounded(&selected.0, selected.1.length as usize)
            .await?;
        if bytes.len() as u64 != selected.1.length
            || !hex::encode(Sha256::digest(&bytes)).eq_ignore_ascii_case(&selected.1.sha256)
        {
            bail!("Agent update artifact length or hash did not match signed metadata");
        }
        Ok((
            Some(DownloadedTarget {
                version: selected.2,
                bytes,
            }),
            versions,
        ))
    }

    fn within_rollout(&self, version: &Version, target: &TargetDescription) -> bool {
        if target.rollout_percent == 100 {
            return true;
        }
        let mut identity = blake3::Hasher::new();
        identity.update(b"alphaping/update-rollout/v1");
        identity.update(self.agent_id.as_bytes());
        identity.update(version.to_string().as_bytes());
        u16::from_be_bytes(
            identity.finalize().as_bytes()[..2]
                .try_into()
                .unwrap_or([0; 2]),
        ) % 100
            < u16::from(target.rollout_percent)
    }

    async fn fetch_bounded(&self, path: &str, maximum: usize) -> Result<Vec<u8>> {
        if !valid_target_path(path) || maximum == 0 || maximum > MAX_ARTIFACT_BYTES {
            bail!("update download path or bound is invalid");
        }
        // Only these three fixed-size documents belong in the long-lived cache.
        // Release binaries may be much larger and change paths on every update.
        let cache_metadata = maximum == MAX_METADATA_BYTES
            && matches!(
                path,
                "alphaping-tuf-timestamp.json"
                    | "alphaping-tuf-snapshot.json"
                    | "alphaping-tuf-targets.json"
            );
        let cached = if cache_metadata {
            self.metadata_cache
                .lock()
                .map_err(|_| anyhow::anyhow!("update metadata cache lock failed"))?
                .get(path)
                .cloned()
        } else {
            None
        };
        let mut request = self
            .http
            .get(format!("{}/{path}", self.base_url.trim_end_matches('/')))
            .header("accept", "application/octet-stream");
        if let Some(cached) = &cached {
            request = request.header("if-none-match", &cached.etag);
        }
        let response = request.send().await?;
        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            return cached
                .map(|entry| entry.bytes)
                .context("metadata origin returned 304 without a cached response");
        }
        let response = response.error_for_status()?;
        let etag = response
            .headers()
            .get("etag")
            .and_then(|value| value.to_str().ok())
            .filter(|value| value.len() <= 256)
            .map(str::to_owned);
        if response
            .content_length()
            .is_some_and(|length| length > maximum as u64)
        {
            bail!("update download exceeded its signed length");
        }
        let mut bytes = Vec::with_capacity(maximum.min(1024 * 1024));
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            if bytes.len().saturating_add(chunk.len()) > maximum {
                bail!("update download exceeded its signed length");
            }
            bytes.extend_from_slice(&chunk);
        }
        if cache_metadata && let Some(etag) = etag {
            self.metadata_cache
                .lock()
                .map_err(|_| anyhow::anyhow!("update metadata cache lock failed"))?
                .insert(
                    path.to_owned(),
                    CacheEntry {
                        etag,
                        bytes: bytes.clone(),
                    },
                );
        }
        Ok(bytes)
    }
}

fn valid_target_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 160
        && !path.starts_with('/')
        && !path
            .split('/')
            .any(|segment| segment.is_empty() || segment == "..")
        && path
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    #[tokio::test]
    async fn etag_cache_retains_only_metadata_and_reuses_conditional_responses() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for index in 0..5 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0_u8; 8192];
                let length = stream.read(&mut request).await.unwrap();
                let request = String::from_utf8_lossy(&request[..length]);
                let response = if index == 4 {
                    assert!(
                        request
                            .to_ascii_lowercase()
                            .contains("if-none-match: \"fixture\"")
                    );
                    "HTTP/1.1 304 Not Modified\r\nConnection: close\r\n\r\n"
                } else {
                    assert!(!request.to_ascii_lowercase().contains("if-none-match:"));
                    "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nETag: \"fixture\"\r\nConnection: close\r\n\r\ndata"
                };
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let keys = [
            ("a".to_owned(), SigningKey::from_bytes(&[7; 32])),
            ("b".to_owned(), SigningKey::from_bytes(&[9; 32])),
        ];
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        let client = UpdateClient::with_base_url(
            Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .unwrap(),
            super::super::tests::root(&keys, 1_800_000_000_000),
            "cache-test".into(),
            format!("http://{address}"),
        );
        for path in [
            "alphaping-tuf-timestamp.json",
            "agent-v1",
            "agent-v2",
            "agent-v3",
            "alphaping-tuf-timestamp.json",
        ] {
            // An artifact can have the same byte limit as metadata; the limit
            // alone must not decide whether its payload stays in memory.
            assert_eq!(
                client
                    .fetch_bounded(path, MAX_METADATA_BYTES)
                    .await
                    .unwrap(),
                b"data"
            );
        }
        server.await.unwrap();
        let cache = client.metadata_cache.lock().unwrap();
        assert_eq!(cache.len(), 1);
        assert!(cache.contains_key("alphaping-tuf-timestamp.json"));
    }
}
