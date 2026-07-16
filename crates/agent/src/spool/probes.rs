use alphaping_protocol::{
    decode_message, encode_message,
    v1::{AgentConfigSnapshot, ProbeResult},
};
use anyhow::{Context, Result, bail};
use rusqlite::{OptionalExtension, params};

use super::Spool;

impl Spool {
    pub fn load_probe_config(&self) -> Result<AgentConfigSnapshot> {
        self.connection
            .query_row(
                "SELECT payload FROM probe_config WHERE singleton = 1",
                [],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()?
            .map(|payload| decode_message(&payload).map_err(anyhow::Error::from))
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
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO probe_config (singleton, revision, payload, updated_at)
             VALUES (1, ?, ?, ?)
             ON CONFLICT(singleton) DO UPDATE SET
               revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at",
            params![config.revision, encode_message(config), now_ms],
        )?;
        transaction.execute(
            "UPDATE meta SET value = ? WHERE key = 'applied_config_revision'",
            [config.revision],
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
