use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

use anyhow::{Context, Result, bail};
#[cfg(windows)]
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialStorage {
    #[default]
    RestrictedFile,
    SystemKeychain,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AgentConfig {
    pub endpoint: String,
    pub agent_id: String,
    pub machine_pk: u64,
    pub workspace_pk: u64,
    pub key_epoch: u32,
    pub data_key_hex: String,
    pub nonce_prefix_hex: String,
    pub identity_private_key_hex: String,
    #[serde(default)]
    pub credential_storage: CredentialStorage,
    pub spool_path: String,
    #[serde(default = "default_sample_interval")]
    pub sample_interval_seconds: u64,
    #[serde(default = "default_report_interval")]
    pub report_interval_seconds: u64,
    #[serde(default = "default_spool_bytes")]
    pub max_spool_bytes: u64,
    #[serde(default)]
    pub container_monitoring_enabled: bool,
    #[serde(default = "default_auto_update")]
    pub auto_update: bool,
    #[serde(default = "default_update_channel")]
    pub update_channel: String,
    #[serde(default)]
    pub pinned_version: Option<String>,
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

const fn default_auto_update() -> bool {
    true
}

fn default_update_channel() -> String {
    "stable".to_owned()
}

impl AgentConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let stored = fs::read(path)
            .with_context(|| format!("failed to read config at {}", path.display()))?;
        let (plaintext, legacy_plaintext) = decode_stored_config(&stored)?;
        let content = String::from_utf8(plaintext).context("agent config is not UTF-8")?;
        let mut config: Self = toml::from_str(&content).context("agent config is invalid")?;
        config.validate()?;
        migrate_preferred_credential_storage(&mut config, path)?;
        if legacy_plaintext {
            config.save(path)?;
        }
        Ok(config)
    }

    fn validate(&self) -> Result<()> {
        #[cfg(not(target_os = "macos"))]
        if self.credential_storage == CredentialStorage::SystemKeychain {
            bail!("System Keychain credential storage is only available on macOS");
        }
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
        if hex::decode(&self.nonce_prefix_hex)?.len() != 4 {
            bail!("nonce prefix must be 4 bytes");
        }
        self.data_key()?;
        self.identity_private_key()?;
        if self.update_channel != "stable" {
            bail!("only the stable update channel is currently supported");
        }
        if self
            .pinned_version
            .as_deref()
            .is_some_and(|version| semver::Version::parse(version).is_err())
        {
            bail!("pinned Agent version is invalid");
        }
        Ok(())
    }

    pub fn data_key(&self) -> Result<[u8; 32]> {
        if !self.data_key_hex.is_empty() {
            return hex::decode(&self.data_key_hex)?
                .try_into()
                .map_err(|_| anyhow::anyhow!("invalid data key"));
        }
        match self.credential_storage {
            CredentialStorage::RestrictedFile => bail!("data key must be 32 bytes"),
            CredentialStorage::SystemKeychain => {
                #[cfg(target_os = "macos")]
                return crate::credential_store::load_system_data_key(
                    &self.agent_id,
                    self.key_epoch,
                );
                #[cfg(not(target_os = "macos"))]
                bail!("System Keychain credential storage is only available on macOS");
            }
        }
    }

    pub fn nonce_prefix(&self) -> Result<[u8; 4]> {
        hex::decode(&self.nonce_prefix_hex)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid nonce prefix"))
    }

    pub fn identity_private_key(&self) -> Result<[u8; 32]> {
        if !self.identity_private_key_hex.is_empty() {
            return hex::decode(&self.identity_private_key_hex)?
                .try_into()
                .map_err(|_| anyhow::anyhow!("invalid identity private key"));
        }
        match self.credential_storage {
            CredentialStorage::RestrictedFile => bail!("identity private key must be 32 bytes"),
            CredentialStorage::SystemKeychain => {
                #[cfg(target_os = "macos")]
                return crate::credential_store::load_system_identity(&self.agent_id);
                #[cfg(not(target_os = "macos"))]
                bail!("System Keychain credential storage is only available on macOS");
            }
        }
    }

    #[cfg(target_os = "macos")]
    pub fn prefer_system_keychain(&mut self) -> Result<()> {
        let data_key: [u8; 32] = hex::decode(&self.data_key_hex)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid data key"))?;
        let identity_private_key: [u8; 32] = hex::decode(&self.identity_private_key_hex)?
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid identity private key"))?;
        crate::credential_store::store_system_credentials(
            &self.agent_id,
            self.key_epoch,
            &data_key,
            &identity_private_key,
        )?;
        self.credential_storage = CredentialStorage::SystemKeychain;
        self.data_key_hex.clear();
        self.identity_private_key_hex.clear();
        Ok(())
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        self.validate()?;
        let stored = config_for_storage(self)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
            set_directory_permissions(parent)?;
        }
        let temporary = path.with_extension(format!("tmp-{}", uuid::Uuid::now_v7()));
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        let serialized = toml::to_string_pretty(&stored)?;
        file.write_all(&encode_stored_config(serialized.as_bytes())?)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn config_for_storage(config: &AgentConfig) -> Result<AgentConfig> {
    let mut stored = config.clone();
    if stored.credential_storage == CredentialStorage::SystemKeychain {
        let has_data_key = !stored.data_key_hex.is_empty();
        let has_identity = !stored.identity_private_key_hex.is_empty();
        if has_data_key && has_identity {
            crate::credential_store::store_system_credentials(
                &stored.agent_id,
                stored.key_epoch,
                &stored.data_key()?,
                &stored.identity_private_key()?,
            )?;
        } else if has_data_key {
            crate::credential_store::store_system_data_key(
                &stored.agent_id,
                stored.key_epoch,
                &stored.data_key()?,
            )?;
        } else if has_identity {
            crate::credential_store::store_system_identity(
                &stored.agent_id,
                &stored.identity_private_key()?,
            )?;
        }
        redact_inline_credentials(&mut stored);
    }
    Ok(stored)
}

#[cfg(not(target_os = "macos"))]
fn config_for_storage(config: &AgentConfig) -> Result<AgentConfig> {
    Ok(config.clone())
}

#[cfg(any(target_os = "macos", test))]
fn redact_inline_credentials(config: &mut AgentConfig) {
    config.data_key_hex.clear();
    config.identity_private_key_hex.clear();
}

#[cfg(target_os = "macos")]
fn migrate_preferred_credential_storage(config: &mut AgentConfig, path: &Path) -> Result<()> {
    if config.credential_storage == CredentialStorage::RestrictedFile
        && config.prefer_system_keychain().is_ok()
    {
        config.save(path)?;
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn migrate_preferred_credential_storage(_config: &mut AgentConfig, _path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(not(windows))]
fn decode_stored_config(stored: &[u8]) -> Result<(Vec<u8>, bool)> {
    Ok((stored.to_vec(), false))
}

#[cfg(not(windows))]
fn encode_stored_config(plaintext: &[u8]) -> Result<Vec<u8>> {
    Ok(plaintext.to_vec())
}

#[cfg(windows)]
fn decode_stored_config(stored: &[u8]) -> Result<(Vec<u8>, bool)> {
    const PREFIX: &[u8] = b"ALPHAPING-DPAPI-1\n";
    if !stored.starts_with(PREFIX) {
        return Ok((stored.to_vec(), true));
    }
    let protected = STANDARD
        .decode(&stored[PREFIX.len()..])
        .context("DPAPI config encoding is invalid")?;
    Ok((dpapi_unprotect(&protected)?, false))
}

#[cfg(windows)]
fn encode_stored_config(plaintext: &[u8]) -> Result<Vec<u8>> {
    let protected = dpapi_protect(plaintext)?;
    let mut encoded = b"ALPHAPING-DPAPI-1\n".to_vec();
    encoded.extend_from_slice(STANDARD.encode(protected).as_bytes());
    encoded.push(b'\n');
    Ok(encoded)
}

#[cfg(windows)]
fn dpapi_protect(plaintext: &[u8]) -> Result<Vec<u8>> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CRYPT_INTEGER_BLOB, CRYPTPROTECT_LOCAL_MACHINE, CryptProtectData,
        },
    };

    let input_length = u32::try_from(plaintext.len()).context("Agent config is too large")?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: input_length,
        pbData: plaintext.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let succeeded = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_LOCAL_MACHINE,
            &mut output,
        )
    };
    if succeeded == 0 {
        return Err(std::io::Error::last_os_error()).context("DPAPI config protection failed");
    }
    let protected =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(protected)
}

#[cfg(windows)]
fn dpapi_unprotect(protected: &[u8]) -> Result<Vec<u8>> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{CRYPT_INTEGER_BLOB, CryptUnprotectData},
    };

    let input_length = u32::try_from(protected.len()).context("Agent config is too large")?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: input_length,
        pbData: protected.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let succeeded = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut output,
        )
    };
    if succeeded == 0 {
        return Err(std::io::Error::last_os_error()).context("DPAPI config decryption failed");
    }
    let plaintext =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(plaintext)
}

#[cfg(unix)]
fn set_directory_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_directory_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
