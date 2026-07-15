use std::{
    fs,
    path::{Path, PathBuf},
};

use alphaping_protocol::{
    compress_message, decode_message, encode_message,
    v1::{MachineReport, MetricSample},
};
use anyhow::{Context, Result, bail};
use rusqlite::{Connection, OptionalExtension, params};
use uuid::Uuid;

const MIN_FREE_BYTES: u64 = 256 * 1024 * 1024;

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
             CREATE TABLE IF NOT EXISTS samples (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               sample_bucket INTEGER NOT NULL UNIQUE,
               observed_at INTEGER NOT NULL,
               payload BLOB NOT NULL,
               created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS deliveries (
               report_id BLOB PRIMARY KEY NOT NULL,
               nominal_minute INTEGER NOT NULL UNIQUE,
               payload BLOB NOT NULL,
               payload_hash BLOB NOT NULL,
               created_at INTEGER NOT NULL,
               next_attempt_at INTEGER NOT NULL,
               attempt_count INTEGER NOT NULL DEFAULT 0,
               last_error_code TEXT
             ) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS delivery_samples (
               report_id BLOB NOT NULL REFERENCES deliveries(report_id) ON DELETE CASCADE,
               sample_id INTEGER NOT NULL REFERENCES samples(id) ON DELETE RESTRICT,
               PRIMARY KEY (report_id, sample_id)
             ) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS data_gaps (
               hour_start INTEGER PRIMARY KEY NOT NULL,
               dropped_samples INTEGER NOT NULL,
               reason TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             ) WITHOUT ROWID;",
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO meta (key, value) VALUES ('transport_sequence', 0)",
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
                 WHERE ds.sample_id IS NULL ORDER BY s.observed_at LIMIT 1",
                [],
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

        let report_id = Uuid::now_v7().into_bytes().to_vec();
        let report = MachineReport {
            report_id: report_id.clone(),
            machine_pk,
            workspace_pk,
            nominal_minute_ms: nominal_minute,
            samples,
            schema_version: 1,
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
        for sample_id in sample_ids {
            transaction.execute(
                "INSERT INTO delivery_samples (report_id, sample_id) VALUES (?, ?)",
                params![report_id, sample_id],
            )?;
        }
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
        let sample_ids = {
            let mut statement = transaction
                .prepare("SELECT sample_id FROM delivery_samples WHERE report_id = ?")?;
            statement
                .query_map([report_id], |row| row.get::<_, i64>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        transaction.execute(
            "DELETE FROM delivery_samples WHERE report_id = ?",
            [report_id],
        )?;
        let deleted_delivery =
            transaction.execute("DELETE FROM deliveries WHERE report_id = ?", [report_id])?;
        let mut deleted_samples = 0;
        for sample_id in sample_ids {
            deleted_samples +=
                transaction.execute("DELETE FROM samples WHERE id = ?", [sample_id])?;
        }
        transaction.commit()?;
        Ok(deleted_delivery == 1 && deleted_samples > 0)
    }

    pub fn delivery_count(&self) -> Result<u64> {
        self.connection
            .query_row("SELECT COUNT(*) FROM deliveries", [], |row| row.get(0))
            .context("failed to count deliveries")
    }

    pub fn enforce_capacity(&mut self, max_bytes: u64, now_ms: i64) -> Result<usize> {
        let used = self.allocated_bytes()?;
        let parent = self.path.parent();
        let free = parent
            .map(fs2::available_space)
            .transpose()?
            .unwrap_or(u64::MAX);
        let total = parent
            .map(fs2::total_space)
            .transpose()?
            .unwrap_or(u64::MAX);
        let reserve = MIN_FREE_BYTES.max(total / 20);
        let ratio = used as f64 / max_bytes.max(1) as f64;
        if ratio < 0.70 && free >= reserve {
            return Ok(0);
        }
        let mut dropped = self.connection.execute(
            "DELETE FROM samples WHERE id IN (
               SELECT id FROM (
                 SELECT s.id,
                   ROW_NUMBER() OVER (PARTITION BY s.observed_at / 60000 ORDER BY s.observed_at DESC) AS rank
                 FROM samples s LEFT JOIN delivery_samples ds ON ds.sample_id = s.id
                 WHERE ds.sample_id IS NULL
               ) WHERE rank > 1 LIMIT 1000
             )",
            [],
        )?;
        if ratio >= 0.85 || free < reserve {
            dropped += self.connection.execute(
                "DELETE FROM samples WHERE id IN (
                   SELECT s.id FROM samples s LEFT JOIN delivery_samples ds ON ds.sample_id = s.id
                   WHERE ds.sample_id IS NULL ORDER BY s.observed_at LIMIT 1000
                 )",
                [],
            )?;
        }
        if ratio >= 0.95 {
            dropped += self.connection.execute(
                "DELETE FROM samples WHERE id IN (
                   SELECT s.id FROM samples s LEFT JOIN delivery_samples ds ON ds.sample_id = s.id
                   WHERE ds.sample_id IS NULL ORDER BY s.observed_at LIMIT 5000
                 )",
                [],
            )?;
        }
        if dropped > 0 {
            let hour = now_ms.div_euclid(3_600_000) * 3_600_000;
            self.connection.execute(
                "INSERT INTO data_gaps (hour_start, dropped_samples, reason, updated_at)
                 VALUES (?, ?, 'spool_pressure', ?)
                 ON CONFLICT(hour_start) DO UPDATE SET
                   dropped_samples = data_gaps.dropped_samples + excluded.dropped_samples,
                   updated_at = excluded.updated_at",
                params![hour, dropped, now_ms],
            )?;
        }
        Ok(dropped)
    }

    fn allocated_bytes(&self) -> Result<u64> {
        let page_count: u64 = self
            .connection
            .query_row("PRAGMA page_count", [], |row| row.get(0))?;
        let page_size: u64 = self
            .connection
            .query_row("PRAGMA page_size", [], |row| row.get(0))?;
        Ok(page_count.saturating_mul(page_size))
    }
}

#[cfg(test)]
mod tests {
    use alphaping_protocol::v1::MetricSample;
    use tempfile::tempdir;

    use super::Spool;

    fn sample(observed_at_ms: i64) -> MetricSample {
        MetricSample {
            observed_at_ms,
            cpu_permille: 100,
            ..MetricSample::default()
        }
    }

    #[test]
    fn ack_is_the_only_path_that_removes_a_delivery() {
        let directory = tempdir().expect("temp directory");
        let mut spool = Spool::open(directory.path().join("spool.db")).expect("open spool");
        for index in 0..6 {
            spool
                .append_sample(&sample(60_000 + index * 10_000), 120_000)
                .expect("append sample");
        }
        let report_id = spool
            .create_next_delivery(7, 2, 120_000)
            .expect("create delivery")
            .expect("delivery exists");
        assert_eq!(spool.delivery_count().expect("count"), 1);
        spool
            .mark_failure(&report_id, 130_000, "network")
            .expect("mark failure");
        assert_eq!(spool.delivery_count().expect("count"), 1);
        assert!(spool.acknowledge(&report_id).expect("ack"));
        assert_eq!(spool.delivery_count().expect("count"), 0);
    }

    #[test]
    fn sequence_is_persisted_before_use() {
        let directory = tempdir().expect("temp directory");
        let path = directory.path().join("spool.db");
        let mut spool = Spool::open(&path).expect("open spool");
        assert_eq!(spool.next_sequence().expect("sequence"), 1);
        drop(spool);
        let mut reopened = Spool::open(&path).expect("reopen spool");
        assert_eq!(reopened.next_sequence().expect("sequence"), 2);
    }
}
