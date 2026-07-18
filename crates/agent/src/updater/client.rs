use std::{collections::BTreeMap, sync::Mutex};

use anyhow::{Context, Result, bail};
use futures_util::StreamExt;
use reqwest::Client;
use semver::Version;
use sha2::{Digest, Sha256};

use super::metadata::{
    SnapshotMetadata, TargetDescription, TargetsMetadata, TimestampMetadata, TrustedRoot,
};

const RELEASE_BASE_URL: &str = "https://github.com/alkinum/alphaping/releases/latest/download";
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
        let cached = if maximum == MAX_METADATA_BYTES {
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
        if let Some(etag) = etag {
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
