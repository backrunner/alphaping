use super::{AgentConfig, CredentialStorage, redact_inline_credentials};

fn config() -> AgentConfig {
    AgentConfig {
        endpoint: "https://ingest.example.test/v1/reports".to_owned(),
        agent_id: "018f5f7e-7d28-7e12-a521-123456789abc".to_owned(),
        machine_pk: 7,
        workspace_pk: 3,
        key_epoch: 1,
        data_key_hex: hex::encode([1; 32]),
        nonce_prefix_hex: hex::encode([2; 4]),
        identity_private_key_hex: hex::encode([3; 32]),
        transport_sequence_checkpoint: 0,
        credential_storage: CredentialStorage::RestrictedFile,
        spool_path: "/tmp/alphaping-config-test.db".to_owned(),
        sample_interval_seconds: 10,
        report_interval_seconds: 60,
        max_spool_bytes: 512 * 1024 * 1024,
        container_monitoring_enabled: true,
        auto_update: true,
        update_channel: "stable".to_owned(),
        pinned_version: None,
    }
}

#[test]
fn legacy_config_defaults_to_the_restricted_file() {
    let mut value = toml::Value::try_from(config()).expect("config TOML value");
    value
        .as_table_mut()
        .expect("config table")
        .remove("credential_storage");
    let parsed: AgentConfig = value.try_into().expect("legacy Agent config");
    assert_eq!(parsed.credential_storage, CredentialStorage::RestrictedFile);
}

#[test]
fn legacy_config_defaults_to_an_unset_sequence_checkpoint() {
    let mut value = toml::Value::try_from(config()).expect("config TOML value");
    value
        .as_table_mut()
        .expect("config table")
        .remove("transport_sequence_checkpoint");
    let parsed: AgentConfig = value.try_into().expect("legacy Agent config");
    assert_eq!(parsed.transport_sequence_checkpoint, 0);
}

#[test]
fn keychain_config_redacts_inline_credentials() {
    let mut stored = config();
    stored.credential_storage = CredentialStorage::SystemKeychain;
    redact_inline_credentials(&mut stored);
    let serialized = toml::to_string(&stored).expect("stored Agent config");
    assert!(stored.data_key_hex.is_empty());
    assert!(stored.identity_private_key_hex.is_empty());
    assert!(!serialized.contains(&hex::encode([1; 32])));
    assert!(!serialized.contains(&hex::encode([3; 32])));
    assert_eq!(stored.nonce_prefix_hex, hex::encode([2; 4]));
}
