use anyhow::Result;
use rusqlite::params;

use super::Spool;

const MIN_FREE_BYTES: u64 = 256 * 1024 * 1024;
const HOUR_MS: i64 = 3_600_000;
const DAY_MS: i64 = 24 * HOUR_MS;
const VACUUM_PAGE_BATCH: u32 = 256;
const COMPACTION_SCAN_BATCH: u32 = 6_000;

#[derive(Debug, Default, Eq, PartialEq)]
pub struct CapacityOutcome {
    pub compacted_samples: usize,
    pub dropped_samples: usize,
}

struct StorageUsage {
    live_bytes: u64,
    free_pages: u64,
}

impl Spool {
    pub fn enforce_capacity(&mut self, max_bytes: u64, now_ms: i64) -> Result<CapacityOutcome> {
        let storage = self.storage_usage()?;
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
        let ratio = storage.live_bytes as f64 / max_bytes.max(1) as f64;
        if ratio < 0.70 && free >= reserve {
            return Ok(CapacityOutcome::default());
        }

        let mut compacted = self.connection.execute(
            "DELETE FROM samples WHERE id IN (
               SELECT id FROM (
                 SELECT candidate.id,
                   ROW_NUMBER() OVER (
                     PARTITION BY candidate.observed_at / 60000
                     ORDER BY candidate.observed_at DESC
                   ) AS rank
                 FROM (
                   SELECT s.id, s.observed_at FROM samples s
                   LEFT JOIN delivery_samples ds ON ds.sample_id = s.id
                   WHERE ds.sample_id IS NULL AND s.observed_at < ?
                   ORDER BY s.sample_bucket LIMIT ?
                 ) candidate
               ) WHERE rank > 1 LIMIT 1000
             )",
            params![now_ms.saturating_sub(DAY_MS), COMPACTION_SCAN_BATCH],
        )?;
        if ratio >= 0.85 || free < reserve {
            compacted += self.connection.execute(
                "DELETE FROM samples WHERE id IN (
                   SELECT id FROM (
                     SELECT candidate.id,
                       ROW_NUMBER() OVER (
                         PARTITION BY candidate.observed_at / 300000
                         ORDER BY candidate.observed_at DESC
                       ) AS rank
                     FROM (
                       SELECT s.id, s.observed_at FROM samples s
                       LEFT JOIN delivery_samples ds ON ds.sample_id = s.id
                       WHERE ds.sample_id IS NULL AND s.observed_at < ?
                       ORDER BY s.sample_bucket LIMIT ?
                     ) candidate
                   ) WHERE rank > 1 LIMIT 1000
                 )",
                params![now_ms.saturating_sub(7 * DAY_MS), COMPACTION_SCAN_BATCH],
            )?;
        }
        if ratio >= 0.95 {
            compacted += self.connection.execute(
                "DELETE FROM samples WHERE id IN (
                   SELECT id FROM (
                     SELECT candidate.id,
                       ROW_NUMBER() OVER (
                         PARTITION BY candidate.observed_at / 300000
                         ORDER BY candidate.observed_at DESC
                       ) AS rank
                     FROM (
                       SELECT s.id, s.observed_at FROM samples s
                       LEFT JOIN delivery_samples ds ON ds.sample_id = s.id
                       WHERE ds.sample_id IS NULL
                       ORDER BY s.sample_bucket LIMIT ?
                     ) candidate
                   ) WHERE rank > 1 LIMIT 5000
                 )",
                [COMPACTION_SCAN_BATCH],
            )?;
        }

        if compacted > 0 || storage.free_pages > 0 || free < reserve {
            self.connection
                .execute_batch("PRAGMA wal_checkpoint(PASSIVE);")?;
            self.connection
                .execute_batch(&format!("PRAGMA incremental_vacuum({VACUUM_PAGE_BATCH});"))?;
        }

        let after_compaction = self.storage_usage()?;
        let free_after = parent
            .map(fs2::available_space)
            .transpose()?
            .unwrap_or(u64::MAX);
        let mut dropped = 0;
        if after_compaction.live_bytes >= max_bytes.max(1)
            || (free_after < reserve && after_compaction.free_pages == 0)
        {
            dropped = self.connection.execute(
                "DELETE FROM samples WHERE id IN (
                   SELECT s.id FROM samples s LEFT JOIN delivery_samples ds ON ds.sample_id = s.id
                   WHERE ds.sample_id IS NULL ORDER BY s.observed_at LIMIT 1000
                 )",
                [],
            )?;
        }
        if dropped > 0 {
            let hour = now_ms.div_euclid(HOUR_MS) * HOUR_MS;
            self.connection.execute(
                "INSERT INTO data_gaps (hour_start, dropped_samples, reason, updated_at)
                 VALUES (?, ?, 'spool_pressure', ?)
                 ON CONFLICT(hour_start) DO UPDATE SET
                   dropped_samples = data_gaps.dropped_samples + excluded.dropped_samples,
                   updated_at = excluded.updated_at",
                params![hour, dropped, now_ms],
            )?;
        }
        Ok(CapacityOutcome {
            compacted_samples: compacted,
            dropped_samples: dropped,
        })
    }

    fn storage_usage(&self) -> Result<StorageUsage> {
        let page_count: u64 = self
            .connection
            .query_row("PRAGMA page_count", [], |row| row.get(0))?;
        let page_size: u64 = self
            .connection
            .query_row("PRAGMA page_size", [], |row| row.get(0))?;
        let free_pages: u64 = self
            .connection
            .query_row("PRAGMA freelist_count", [], |row| row.get(0))?;
        Ok(StorageUsage {
            live_bytes: page_count
                .saturating_sub(free_pages)
                .saturating_mul(page_size),
            free_pages,
        })
    }
}
