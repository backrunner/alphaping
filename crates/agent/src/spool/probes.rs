use alphaping_protocol::{
    decode_message, encode_message,
    v1::{AgentConfigSnapshot, ProbeResult},
};
use anyhow::{Context, Result, bail};
use rusqlite::{OptionalExtension, params};

use super::Spool;

impl Spool {
    pub fn protect_probe_config(&mut self, identity_secret: &[u8; 32]) -> Result<()> {
        self.config_key = Some(alphaping_crypto::local_config_key(identity_secret)?);
        let legacy = self
            .connection
            .query_row(
                "SELECT revision, payload FROM probe_config WHERE singleton = 1 AND encrypted = 0",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?)),
            )
            .optional()?;
        if let Some((revision, payload)) = legacy {
            let encrypted = self.encrypt_probe_config(revision, &payload)?;
            self.connection.execute(
                "UPDATE probe_config SET payload = ?, encrypted = 1 WHERE singleton = 1",
                [encrypted],
            )?;
            self.connection
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        }
        Ok(())
    }

    fn encrypt_probe_config(&self, revision: i64, plaintext: &[u8]) -> Result<Vec<u8>> {
        let key = self
            .config_key
            .as_ref()
            .context("probe configuration encryption key is unavailable")?;
        let mut nonce = [0_u8; 12];
        getrandom::fill(&mut nonce)?;
        let ciphertext = alphaping_crypto::seal(
            key,
            nonce[..4].try_into()?,
            u64::from_be_bytes(nonce[4..].try_into()?),
            &revision.to_be_bytes(),
            plaintext,
        )?;
        let mut payload = nonce.to_vec();
        payload.extend(ciphertext);
        Ok(payload)
    }

    pub fn load_probe_config(&self) -> Result<AgentConfigSnapshot> {
        self.connection
            .query_row(
                "SELECT revision, payload, encrypted FROM probe_config WHERE singleton = 1",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, Vec<u8>>(1)?,
                        row.get::<_, bool>(2)?,
                    ))
                },
            )
            .optional()?
            .map(
                |(revision, payload, encrypted)| -> Result<AgentConfigSnapshot> {
                    let plaintext = if encrypted {
                        let key = self
                            .config_key
                            .as_ref()
                            .context("probe configuration encryption key is unavailable")?;
                        anyhow::ensure!(
                            payload.len() >= 28,
                            "encrypted probe configuration is truncated"
                        );
                        alphaping_crypto::open_with_nonce(
                            key,
                            payload[..12].try_into()?,
                            &revision.to_be_bytes(),
                            &payload[12..],
                        )?
                    } else {
                        payload
                    };
                    Ok(decode_message(&plaintext)?)
                },
            )
            .transpose()
            .map(|config| config.unwrap_or_default())
    }

    pub fn apply_probe_config(
        &mut self,
        config: &AgentConfigSnapshot,
        now_ms: i64,
    ) -> Result<bool> {
        let current = self.applied_config_revision()?;
        if config.revision < current {
            bail!("probe configuration revision rolled back");
        }
        if config.revision == current {
            return Ok(false);
        }
        let revision = i64::try_from(config.revision)?;
        let payload = self.encrypt_probe_config(revision, &encode_message(config))?;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO probe_config (singleton, revision, payload, updated_at, encrypted)
             VALUES (1, ?, ?, ?, 1)
             ON CONFLICT(singleton) DO UPDATE SET
               revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at, encrypted = 1",
            params![revision, payload, now_ms],
        )?;
        transaction.execute(
            "UPDATE meta SET value = ? WHERE key = 'applied_config_revision'",
            [i64::try_from(config.revision)?],
        )?;
        transaction.commit()?;
        Ok(true)
    }

    pub fn append_probe_result(&self, result: &ProbeResult, now_ms: i64) -> Result<bool> {
        let nominal_minute = result.nominal_slot_ms.div_euclid(60_000) * 60_000;
        let inserted = self.connection.execute(
            "INSERT OR IGNORE INTO probe_results
             (execution_id, nominal_minute, observed_at, payload, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![
                result.execution_id,
                nominal_minute,
                result.observed_at_ms,
                encode_message(result),
                now_ms
            ],
        )?;
        Ok(inserted == 1)
    }

    pub fn applied_config_revision(&self) -> Result<u64> {
        let revision: i64 = self.connection.query_row(
            "SELECT value FROM meta WHERE key = 'applied_config_revision'",
            [],
            |row| row.get(0),
        )?;
        u64::try_from(revision).context("configuration revision is invalid")
    }
}
