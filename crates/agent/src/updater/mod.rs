mod client;
mod install;
mod metadata;

use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use semver::Version;

use crate::{config::AgentConfig, uploader::pq_client};

use self::{
    client::{MetadataVersions, UpdateClient},
    install::install_verified_binary,
    metadata::embedded_root,
};

#[cfg(windows)]
pub use install::apply_windows_update;
pub use metadata::embedded_root_sha256;

pub enum UpdateRequest {
    Check {
        bypass_rollout: bool,
    },
    Install {
        version: Version,
        bypass_rollout: bool,
    },
}

#[derive(Debug)]
pub struct UpdateOutcome {
    pub result_code: &'static str,
    pub installed_version: String,
    pub restart_required: bool,
}

pub struct Updater {
    client: UpdateClient,
    config_path: PathBuf,
    state_path: PathBuf,
    channel: String,
    pinned_version: Option<Version>,
}

impl Updater {
    pub fn new(config: &AgentConfig, config_path: &Path, now_ms: i64) -> Result<Self> {
        let root = embedded_root(now_ms)?;
        let state_path = Path::new(&config.spool_path).with_extension("update-state.json");
        Ok(Self {
            client: UpdateClient::new(pq_client()?, root, config.agent_id.clone()),
            config_path: config_path.to_path_buf(),
            state_path,
            channel: config.update_channel.clone(),
            pinned_version: config
                .pinned_version
                .as_deref()
                .map(Version::parse)
                .transpose()?,
        })
    }

    pub async fn execute(&self, request: UpdateRequest, now_ms: i64) -> Result<UpdateOutcome> {
        let current = Version::parse(env!("CARGO_PKG_VERSION"))?;
        let (requested, bypass_rollout) = match request {
            UpdateRequest::Check { bypass_rollout } => {
                (self.pinned_version.as_ref(), bypass_rollout)
            }
            UpdateRequest::Install {
                ref version,
                bypass_rollout,
            } => (Some(version), bypass_rollout),
        };
        if requested == Some(&current) {
            return Ok(UpdateOutcome {
                result_code: "up_to_date",
                installed_version: current.to_string(),
                restart_required: false,
            });
        }
        let previous = self.load_versions()?;
        let (target, versions) = self
            .client
            .find_update(
                &current,
                requested,
                &self.channel,
                bypass_rollout,
                previous,
                now_ms,
            )
            .await?;
        self.save_versions(versions)?;
        let Some(target) = target else {
            return Ok(UpdateOutcome {
                result_code: "up_to_date_or_not_selected",
                installed_version: current.to_string(),
                restart_required: false,
            });
        };
        install_verified_binary(
            &target.bytes,
            &self.config_path,
            &target.version.to_string(),
        )
        .await?;
        Ok(UpdateOutcome {
            result_code: "installed_restart_pending",
            installed_version: target.version.to_string(),
            restart_required: true,
        })
    }

    fn load_versions(&self) -> Result<MetadataVersions> {
        if !self.state_path.exists() {
            return Ok(MetadataVersions::default());
        }
        let bytes = fs::read(&self.state_path).context("cannot read update rollback state")?;
        if bytes.len() > 4 * 1024 {
            anyhow::bail!("update rollback state is too large");
        }
        serde_json::from_slice(&bytes).context("update rollback state is invalid")
    }

    fn save_versions(&self, versions: MetadataVersions) -> Result<()> {
        if let Some(parent) = self.state_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let temporary = self
            .state_path
            .with_extension(format!("tmp-{}", uuid::Uuid::now_v7()));
        let mut options = fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        use std::io::Write;
        let mut file = options.open(&temporary)?;
        file.write_all(&serde_json::to_vec(&versions)?)?;
        file.sync_all()?;
        fs::rename(&temporary, &self.state_path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
