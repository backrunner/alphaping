use std::{
    fs,
    path::{Path, PathBuf},
};

use alphaping_protocol::{
    compress_message, decode_message, encode_message,
    v1::{AgentCommandResult, ContainerInventory, MachineReport, MetricSample, ProbeResult},
};
use anyhow::{Context, Result, bail};
use rusqlite::{Connection, OptionalExtension, params};
use uuid::Uuid;

mod capacity;
mod commands;
mod probes;
pub use commands::PendingCommand;

#[derive(Debug, Clone)]
pub struct PendingDelivery {
    pub report_id: Vec<u8>,
    pub nominal_minute_ms: i64,
    pub payload: Vec<u8>,
    pub attempt_count: u32,
}

pub struct Spool {
    connection: Connection,
    path: PathBuf,
}

impl Spool {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(&path)?;
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             CREATE TABLE IF NOT EXISTS meta (
               key TEXT PRIMARY KEY NOT NULL,
               value INTEGER NOT NULL
             ) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS meta_blobs (
               key TEXT PRIMARY KEY NOT NULL,
               value BLOB NOT NULL
             ) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS samples (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               sample_bucket INTEGER NOT NULL UNIQUE,
               observed_at INTEGER NOT NULL,
               payload BLOB NOT NULL,
               created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS container_snapshots (
               nominal_minute INTEGER PRIMARY KEY NOT NULL,
               observed_at INTEGER NOT NULL,
               payload BLOB NOT NULL,
               created_at INTEGER NOT NULL
             ) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS deliveries (
               report_id BLOB PRIMARY KEY NOT NULL,
               nominal_minute INTEGER NOT NULL UNIQUE,
               payload BLOB NOT NULL,
               payload_hash BLOB NOT NULL,
               created_at INTEGER NOT NULL,
               next_attempt_at INTEGER NOT NULL,
               attempt_count INTEGER NOT NULL DEFAULT 0,
               last_error_code TEXT,
               catalog_digest BLOB,
               catalog_included INTEGER NOT NULL DEFAULT 0
             ) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS delivery_samples (
               report_id BLOB NOT NULL REFERENCES deliveries(report_id) ON DELETE CASCADE,
               sample_id INTEGER NOT NULL REFERENCES samples(id) ON DELETE RESTRICT,
               PRIMARY KEY (report_id, sample_id)
             ) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS probe_config (
               singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
               revision INTEGER NOT NULL,
               payload BLOB NOT NULL,
               updated_at INTEGER NOT NULL
             ) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS probe_results (
               execution_id BLOB PRIMARY KEY NOT NULL,
               nominal_minute INTEGER NOT NULL,
               observed_at INTEGER NOT NULL,
               payload BLOB NOT NULL,
               created_at INTEGER NOT NULL
             ) WITHOUT ROWID;
             CREATE INDEX IF NOT EXISTS probe_results_minute_idx
               ON probe_results (nominal_minute, observed_at);
             CREATE TABLE IF NOT EXISTS agent_commands (
               command_id TEXT PRIMARY KEY NOT NULL,
               payload BLOB NOT NULL,
               state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'completed')),
               attempt_count INTEGER NOT NULL DEFAULT 0,
               attempt_limit INTEGER NOT NULL,
               next_attempt_at INTEGER NOT NULL,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             ) WITHOUT ROWID;
             CREATE INDEX IF NOT EXISTS agent_commands_due_idx
               ON agent_commands (state, next_attempt_at);
             CREATE TABLE IF NOT EXISTS agent_command_results (
               command_id TEXT PRIMARY KEY NOT NULL,
               payload BLOB NOT NULL,
               completed_at INTEGER NOT NULL
             ) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS delivery_command_results (
               report_id BLOB NOT NULL REFERENCES deliveries(report_id) ON DELETE CASCADE,
               command_id TEXT NOT NULL REFERENCES agent_command_results(command_id) ON DELETE RESTRICT,
               PRIMARY KEY (report_id, command_id)
             ) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS data_gaps (
               hour_start INTEGER PRIMARY KEY NOT NULL,
               dropped_samples INTEGER NOT NULL,
               reason TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             ) WITHOUT ROWID;",
        )?;
        ensure_delivery_catalog_columns(&connection)?;
        connection.execute(
            "INSERT OR IGNORE INTO meta (key, value) VALUES ('transport_sequence', 0)",
            [],
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO meta (key, value) VALUES ('applied_config_revision', 0)",
            [],
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO meta (key, value) VALUES ('live_sequence', 0)",
            [],
        )?;
        Ok(Self { connection, path })
    }

    pub fn append_sample(&mut self, sample: &MetricSample, now_ms: i64) -> Result<bool> {
        let bucket = sample.observed_at_ms.div_euclid(10_000) * 10_000;
        let inserted = self.connection.execute(
            "INSERT OR IGNORE INTO samples (sample_bucket, observed_at, payload, created_at)
             VALUES (?, ?, ?, ?)",
            params![
                bucket,
                sample.observed_at_ms,
                encode_message(sample),
                now_ms
            ],
        )?;
        Ok(inserted == 1)
    }

    pub fn append_container_inventory(
        &self,
        inventory: &ContainerInventory,
        now_ms: i64,
    ) -> Result<()> {
        let nominal_minute = inventory.observed_at_ms.div_euclid(60_000) * 60_000;
        self.connection.execute(
            "INSERT INTO container_snapshots (nominal_minute, observed_at, payload, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(nominal_minute) DO UPDATE SET
               observed_at = excluded.observed_at, payload = excluded.payload,
               created_at = excluded.created_at
             WHERE excluded.observed_at >= container_snapshots.observed_at",
            params![
                nominal_minute,
                inventory.observed_at_ms,
                encode_message(inventory),
                now_ms
            ],
        )?;
        Ok(())
    }

    pub fn create_next_delivery(
        &mut self,
        machine_pk: u64,
        workspace_pk: u64,
        now_ms: i64,
    ) -> Result<Option<Vec<u8>>> {
        let nominal_minute = self
            .connection
            .query_row(
                "SELECT (s.observed_at / 60000) * 60000
                 FROM samples s LEFT JOIN delivery_samples ds ON ds.sample_id = s.id
                 WHERE ds.sample_id IS NULL AND s.observed_at < ?
                 ORDER BY s.observed_at LIMIT 1",
                [now_ms.div_euclid(60_000) * 60_000],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let Some(nominal_minute) = nominal_minute else {
            return Ok(None);
        };
        if self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM deliveries WHERE nominal_minute = ?)",
            [nominal_minute],
            |row| row.get::<_, bool>(0),
        )? {
            bail!("a stable delivery already exists for nominal minute {nominal_minute}");
        }

        let mut statement = self.connection.prepare(
            "SELECT s.id, s.payload FROM samples s
             LEFT JOIN delivery_samples ds ON ds.sample_id = s.id
             WHERE ds.sample_id IS NULL AND s.observed_at >= ? AND s.observed_at < ?
             ORDER BY s.observed_at LIMIT 6",
        )?;
        let rows = statement
            .query_map(params![nominal_minute, nominal_minute + 60_000], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
            })?;
        let mut sample_ids = Vec::with_capacity(6);
        let mut samples = Vec::with_capacity(6);
        for row in rows {
            let (sample_id, bytes) = row?;
            sample_ids.push(sample_id);
            samples.push(decode_message::<MetricSample>(&bytes)?);
        }
        drop(statement);
        if samples.is_empty() {
            return Ok(None);
        }
        let mut container_inventory = self
            .connection
            .query_row(
                "SELECT payload FROM container_snapshots WHERE nominal_minute = ?",
                [nominal_minute],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()?
            .map(|bytes| decode_message::<ContainerInventory>(&bytes))
            .transpose()?;
        let catalog_digest = container_inventory
            .as_ref()
            .map(|inventory| inventory.catalog_digest.clone());
        let last_acked_catalog = self
            .connection
            .query_row(
                "SELECT value FROM meta_blobs WHERE key = 'container_catalog_digest'",
                [],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()?;
        let catalog_included = catalog_digest
            .as_ref()
            .is_some_and(|digest| last_acked_catalog.as_ref() != Some(digest));
        if let Some(inventory) = &mut container_inventory {
            inventory.catalog_included = catalog_included;
            if !catalog_included {
                inventory.catalog.clear();
            }
        }
        let mut probe_statement = self.connection.prepare(
            "SELECT p.execution_id, p.payload FROM probe_results p
             WHERE p.nominal_minute <= ?
             ORDER BY p.nominal_minute, p.observed_at LIMIT 512",
        )?;
        let probe_rows = probe_statement.query_map([nominal_minute], |row| {
            Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Vec<u8>>(1)?))
        })?;
        let mut probe_result_ids = Vec::new();
        let mut probe_results = Vec::new();
        for row in probe_rows {
            let (execution_id, payload) = row?;
            probe_result_ids.push(execution_id);
            probe_results.push(decode_message::<ProbeResult>(&payload)?);
        }
        drop(probe_statement);

        let mut command_statement = self.connection.prepare(
            "SELECT r.command_id, r.payload FROM agent_command_results r
             LEFT JOIN delivery_command_results d ON d.command_id = r.command_id
             WHERE d.command_id IS NULL ORDER BY r.completed_at LIMIT 16",
        )?;
        let command_rows = command_statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })?;
        let mut command_result_ids = Vec::new();
        let mut command_results = Vec::new();
        for row in command_rows {
            let (command_id, payload) = row?;
            command_result_ids.push(command_id);
            command_results.push(decode_message::<AgentCommandResult>(&payload)?);
        }
        drop(command_statement);

        let report_id = Uuid::now_v7().into_bytes().to_vec();
        let report = MachineReport {
            report_id: report_id.clone(),
            machine_pk,
            workspace_pk,
            nominal_minute_ms: nominal_minute,
            samples,
            schema_version: 3,
            container_inventory,
            probe_results,
            applied_config_revision: self.applied_config_revision()?,
            command_results,
            agent_version: env!("CARGO_PKG_VERSION").to_owned(),
        };
        let payload = compress_message(&report)?;
        let payload_hash = blake3::hash(&payload);
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO deliveries
             (report_id, nominal_minute, payload, payload_hash, created_at, next_attempt_at)
             VALUES (?, ?, ?, ?, ?, ?)",
            params![
                report_id,
                nominal_minute,
                payload,
                payload_hash.as_bytes(),
                now_ms,
                now_ms
            ],
        )?;
        transaction.execute(
            "UPDATE deliveries SET catalog_digest = ?, catalog_included = ? WHERE report_id = ?",
            params![catalog_digest, catalog_included, report_id],
        )?;
        for sample_id in sample_ids {
            transaction.execute(
                "INSERT INTO delivery_samples (report_id, sample_id) VALUES (?, ?)",
                params![report_id, sample_id],
            )?;
        }
        for execution_id in probe_result_ids {
            transaction.execute(
                "DELETE FROM probe_results WHERE execution_id = ?",
                [execution_id],
            )?;
        }
        for command_id in command_result_ids {
            transaction.execute(
                "INSERT INTO delivery_command_results (report_id, command_id) VALUES (?, ?)",
                params![report_id, command_id],
            )?;
        }
        transaction.execute(
            "DELETE FROM container_snapshots WHERE nominal_minute = ?",
            [nominal_minute],
        )?;
        transaction.commit()?;
        Ok(Some(report_id))
    }

    pub fn due_delivery(&self, now_ms: i64) -> Result<Option<PendingDelivery>> {
        self.connection
            .query_row(
                "SELECT report_id, nominal_minute, payload, attempt_count
                 FROM deliveries WHERE next_attempt_at <= ?
                 ORDER BY nominal_minute LIMIT 1",
                [now_ms],
                |row| {
                    Ok(PendingDelivery {
                        report_id: row.get(0)?,
                        nominal_minute_ms: row.get(1)?,
                        payload: row.get(2)?,
                        attempt_count: row.get(3)?,
                    })
                },
            )
            .optional()
            .context("failed to read due delivery")
    }

    pub fn next_sequence(&mut self) -> Result<u64> {
        let transaction = self.connection.transaction()?;
        let current: i64 = transaction.query_row(
            "SELECT value FROM meta WHERE key = 'transport_sequence'",
            [],
            |row| row.get(0),
        )?;
        let next = current
            .checked_add(1)
            .context("transport sequence exhausted")?;
        transaction.execute(
            "UPDATE meta SET value = ? WHERE key = 'transport_sequence'",
            [next],
        )?;
        transaction.commit()?;
        u64::try_from(next).context("transport sequence rolled back")
    }

    pub fn next_live_sequence(&mut self, session_id: &[u8]) -> Result<u64> {
        if session_id.len() != 16 {
            bail!("live session ID must be 16 bytes");
        }
        let transaction = self.connection.transaction()?;
        let stored = transaction
            .query_row(
                "SELECT value FROM meta_blobs WHERE key = 'live_session_id'",
                [],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()?;
        if stored.as_deref() != Some(session_id) {
            transaction.execute(
                "INSERT INTO meta_blobs (key, value) VALUES ('live_session_id', ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [session_id],
            )?;
            transaction.execute("UPDATE meta SET value = 0 WHERE key = 'live_sequence'", [])?;
        }
        let current: i64 = transaction.query_row(
            "SELECT value FROM meta WHERE key = 'live_sequence'",
            [],
            |row| row.get(0),
        )?;
        let next = current.checked_add(1).context("live sequence exhausted")?;
        if next > 1_000_000 {
            bail!("live sequence exceeded the session limit");
        }
        transaction.execute(
            "UPDATE meta SET value = ? WHERE key = 'live_sequence'",
            [next],
        )?;
        transaction.commit()?;
        u64::try_from(next).context("live sequence rolled back")
    }

    pub fn mark_failure(
        &self,
        report_id: &[u8],
        next_attempt_at: i64,
        error_code: &str,
    ) -> Result<()> {
        self.connection.execute(
            "UPDATE deliveries SET attempt_count = attempt_count + 1,
             next_attempt_at = ?, last_error_code = ? WHERE report_id = ?",
            params![next_attempt_at, error_code, report_id],
        )?;
        Ok(())
    }

    pub fn wake_backlog(&self, retry_at: i64) -> Result<usize> {
        self.connection
            .execute(
                "UPDATE deliveries SET next_attempt_at = MIN(next_attempt_at, ?)",
                [retry_at],
            )
            .context("failed to wake delivery backlog")
    }

    pub fn acknowledge(&mut self, report_id: &[u8]) -> Result<bool> {
        let transaction = self.connection.transaction()?;
        let catalog = transaction
            .query_row(
                "SELECT catalog_digest, catalog_included FROM deliveries WHERE report_id = ?",
                [report_id],
                |row| Ok((row.get::<_, Option<Vec<u8>>>(0)?, row.get::<_, bool>(1)?)),
            )
            .optional()?;
        let sample_ids = {
            let mut statement = transaction
                .prepare("SELECT sample_id FROM delivery_samples WHERE report_id = ?")?;
            statement
                .query_map([report_id], |row| row.get::<_, i64>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let command_ids = {
            let mut statement = transaction
                .prepare("SELECT command_id FROM delivery_command_results WHERE report_id = ?")?;
            statement
                .query_map([report_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        transaction.execute(
            "DELETE FROM delivery_samples WHERE report_id = ?",
            [report_id],
        )?;
        let deleted_delivery =
            transaction.execute("DELETE FROM deliveries WHERE report_id = ?", [report_id])?;
        if let Some((Some(digest), true)) = catalog {
            transaction.execute(
                "INSERT INTO meta_blobs (key, value) VALUES ('container_catalog_digest', ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [digest],
            )?;
        }
        let mut deleted_samples = 0;
        for sample_id in sample_ids {
            deleted_samples +=
                transaction.execute("DELETE FROM samples WHERE id = ?", [sample_id])?;
        }
        for command_id in command_ids {
            transaction.execute(
                "DELETE FROM agent_command_results WHERE command_id = ?",
                [&command_id],
            )?;
            transaction.execute(
                "DELETE FROM agent_commands WHERE command_id = ? AND state = 'completed'",
                [&command_id],
            )?;
        }
        transaction.commit()?;
        Ok(deleted_delivery == 1 && deleted_samples > 0)
    }

    pub fn delivery_count(&self) -> Result<u64> {
        self.connection
            .query_row("SELECT COUNT(*) FROM deliveries", [], |row| row.get(0))
            .context("failed to count deliveries")
    }
}

fn ensure_delivery_catalog_columns(connection: &Connection) -> Result<()> {
    let columns = {
        let mut statement = connection.prepare("PRAGMA table_info(deliveries)")?;
        statement
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    if !columns.iter().any(|column| column == "catalog_digest") {
        connection.execute("ALTER TABLE deliveries ADD COLUMN catalog_digest BLOB", [])?;
    }
    if !columns.iter().any(|column| column == "catalog_included") {
        connection.execute(
            "ALTER TABLE deliveries ADD COLUMN catalog_included INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
