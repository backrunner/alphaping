use anyhow::Result;
use rusqlite::params;

use super::Spool;

const MIN_FREE_BYTES: u64 = 256 * 1024 * 1024;

impl Spool {
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
