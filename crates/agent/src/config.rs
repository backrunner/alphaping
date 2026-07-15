use std::{fs, path::Path};

use anyhow::{Context, Result, bail};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct AgentConfig {
    pub endpoint: String,
    pub agent_id: String,
    pub machine_pk: u64,
    pub workspace_pk: u64,
    pub key_epoch: u32,
    pub data_key_hex: String,
    pub nonce_prefix_hex: String,
    pub spool_path: String,
    #[serde(default = "default_sample_interval")]
    pub sample_interval_seconds: u64,
    #[serde(default = "default_report_interval")]
    pub report_interval_seconds: u64,
    #[serde(default = "default_spool_bytes")]
    pub max_spool_bytes: u64,
}

const fn default_sample_interval() -> u64 {
    10
}

const fn default_report_interval() -> u64 {
    60
}

const fn default_spool_bytes() -> u64 {
    512 * 1024 * 1024
}

impl AgentConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let content = fs::read_to_string(path)
            .with_context(|| format!("failed to read config at {}", path.display()))?;
        let config: Self = toml::from_str(&content).context("agent config is invalid")?;
        config.validate()?;
        Ok(config)
    }

    fn validate(&self) -> Result<()> {
        if !self.endpoint.starts_with("https://") {
            bail!("endpoint must use HTTPS");
        }
        if self.sample_interval_seconds < 5 || self.report_interval_seconds < 60 {
            bail!("sample/report intervals are below the supported minimum");
        }
        if !self
            .report_interval_seconds
            .is_multiple_of(self.sample_interval_seconds)
        {
            bail!("report interval must be divisible by sample interval");
        }
        if hex::decode(&self.data_key_hex)?.len() != 32 {
            bail!("data key must be 32 bytes");
        }
        if hex::decode(&self.nonce_prefix_hex)?.len() != 4 {
            bail!("nonce prefix must be 4 bytes");
        }
        Ok(())
    }

    pub fn data_key(&self) -> Result<[u8; 32]> {
        hex::decode(&self.data_key_hex)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid data key"))
    }

    pub fn nonce_prefix(&self) -> Result<[u8; 4]> {
        hex::decode(&self.nonce_prefix_hex)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid nonce prefix"))
    }
}
