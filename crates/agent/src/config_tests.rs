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

#[cfg(windows)]
#[test]
fn protected_config_reloads_with_lf_crlf_or_no_final_newline() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let path = directory.path().join("agent.toml");
    let mut original = config();
    original.transport_sequence_checkpoint = 1_024;
    original.save(&path).expect("protect config");
    let stored = std::fs::read(&path).expect("read protected config");
    assert!(stored.starts_with(b"ALPHAPING-DPAPI-1\n"));
    assert!(stored.ends_with(b"\n"));

    for ending in [b"\n".as_slice(), b"\r\n", b""] {
        let mut encoded = stored.trim_ascii_end().to_vec();
        encoded.extend_from_slice(ending);
        std::fs::write(&path, &encoded).expect("write newline variant");
        let recovered = AgentConfig::load(&path).expect("reload protected config");
        assert_eq!(recovered.transport_sequence_checkpoint, 1_024);
        assert_eq!(recovered.data_key().expect("data key"), [1; 32]);
        assert_eq!(recovered.identity_private_key().expect("identity"), [3; 32]);
    }

    let mut corrupt = stored;
    corrupt[b"ALPHAPING-DPAPI-1\n".len()] = b'!';
    std::fs::write(&path, corrupt).expect("write corrupt config");
    assert!(AgentConfig::load(&path).is_err());
}
