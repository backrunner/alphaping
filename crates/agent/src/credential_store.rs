#[cfg(target_os = "macos")]
use anyhow::{Context, Result};
#[cfg(target_os = "macos")]
use security_framework::os::macos::keychain::SecKeychain;

#[cfg(target_os = "macos")]
const SYSTEM_KEYCHAIN_PATH: &str = "/Library/Keychains/System.keychain";
#[cfg(target_os = "macos")]
const IDENTITY_SERVICE: &str = "top.backrunner.alphaping.agent.identity";
#[cfg(target_os = "macos")]
const DATA_KEY_SERVICE: &str = "top.backrunner.alphaping.agent.data-key";

#[cfg(target_os = "macos")]
pub fn store_system_credentials(
    agent_id: &str,
    key_epoch: u32,
    data_key: &[u8; 32],
    identity_private_key: &[u8; 32],
) -> Result<()> {
    let _interaction = SecKeychain::disable_user_interaction()
        .context("failed to disable macOS Keychain prompts")?;
    let keychain = SecKeychain::open(SYSTEM_KEYCHAIN_PATH)
        .context("failed to open the macOS System Keychain")?;
    set_keychain_secret(
        &keychain,
        DATA_KEY_SERVICE,
        &data_key_account(agent_id, key_epoch),
        data_key,
    )
    .context("failed to store the Agent data key in the macOS System Keychain")?;
    set_keychain_secret(&keychain, IDENTITY_SERVICE, agent_id, identity_private_key)
        .context("failed to store the Agent identity in the macOS System Keychain")
}

#[cfg(target_os = "macos")]
pub fn store_system_data_key(agent_id: &str, key_epoch: u32, data_key: &[u8; 32]) -> Result<()> {
    let _interaction = SecKeychain::disable_user_interaction()
        .context("failed to disable macOS Keychain prompts")?;
    let keychain = SecKeychain::open(SYSTEM_KEYCHAIN_PATH)
        .context("failed to open the macOS System Keychain")?;
    set_keychain_secret(
        &keychain,
        DATA_KEY_SERVICE,
        &data_key_account(agent_id, key_epoch),
        data_key,
    )
    .context("failed to store the rotated Agent data key in the macOS System Keychain")
}

#[cfg(target_os = "macos")]
pub fn store_system_identity(agent_id: &str, identity_private_key: &[u8; 32]) -> Result<()> {
    let _interaction = SecKeychain::disable_user_interaction()
        .context("failed to disable macOS Keychain prompts")?;
    let keychain = SecKeychain::open(SYSTEM_KEYCHAIN_PATH)
        .context("failed to open the macOS System Keychain")?;
    set_keychain_secret(&keychain, IDENTITY_SERVICE, agent_id, identity_private_key)
        .context("failed to store the Agent identity in the macOS System Keychain")
}

#[cfg(target_os = "macos")]
pub fn load_system_data_key(agent_id: &str, key_epoch: u32) -> Result<[u8; 32]> {
    load_system_secret(DATA_KEY_SERVICE, &data_key_account(agent_id, key_epoch))
        .context("failed to load the Agent data key from the macOS System Keychain")
}

#[cfg(target_os = "macos")]
pub fn load_system_identity(agent_id: &str) -> Result<[u8; 32]> {
    load_system_secret(IDENTITY_SERVICE, agent_id)
        .context("failed to load the Agent identity from the macOS System Keychain")
}

#[cfg(target_os = "macos")]
fn load_system_secret(service: &str, account: &str) -> Result<[u8; 32]> {
    let _interaction = SecKeychain::disable_user_interaction()
        .context("failed to disable macOS Keychain prompts")?;
    let keychain = SecKeychain::open(SYSTEM_KEYCHAIN_PATH)
        .context("failed to open the macOS System Keychain")?;
    let value = get_keychain_secret(&keychain, service, account)?;
    value
        .try_into()
        .map_err(|_| anyhow::anyhow!("macOS Keychain credential has an invalid length"))
}

#[cfg(target_os = "macos")]
fn data_key_account(agent_id: &str, key_epoch: u32) -> String {
    format!("{agent_id}:epoch:{key_epoch}")
}

#[cfg(target_os = "macos")]
fn set_keychain_secret(
    keychain: &SecKeychain,
    service: &str,
    account: &str,
    value: &[u8],
) -> security_framework::base::Result<()> {
    keychain.set_generic_password(service, account, value)
}

#[cfg(target_os = "macos")]
fn get_keychain_secret(keychain: &SecKeychain, service: &str, account: &str) -> Result<Vec<u8>> {
    let (password, _) = keychain
        .find_generic_password(service, account)
        .context("macOS Keychain credential was not found")?;
    Ok(password.as_ref().to_vec())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use security_framework::os::macos::keychain::CreateOptions;
    use tempfile::tempdir;

    use super::{get_keychain_secret, set_keychain_secret};

    #[test]
    fn generic_secret_round_trips_without_the_system_keychain() {
        let directory = tempdir().expect("temporary keychain directory");
        let path = directory.path().join("agent-test.keychain");
        let mut options = CreateOptions::new();
        options.password("alphaping-test-only");
        let keychain = options.create(&path).expect("temporary keychain");
        set_keychain_secret(&keychain, "alphaping.test", "agent-1", &[7; 32])
            .expect("store keychain secret");
        assert_eq!(
            get_keychain_secret(&keychain, "alphaping.test", "agent-1")
                .expect("load keychain secret"),
            vec![7; 32]
        );
    }
}
