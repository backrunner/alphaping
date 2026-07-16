use serde::Deserialize;
use worker::{D1Database, D1PreparedStatement};

use super::{number, optional_unsigned, text, unsigned};
use crate::check_result_model::{ResultBatch, ResultState, StoredBatch};

#[derive(Debug, Deserialize)]
struct BlockRow {
    result_0: Option<Vec<u8>>,
    result_1: Option<Vec<u8>>,
    result_2: Option<Vec<u8>>,
    result_3: Option<Vec<u8>>,
}

#[derive(Debug, Deserialize)]
struct StoredRollupRow {
    total_count: f64,
    healthy_count: f64,
    degraded_count: f64,
    down_count: f64,
    latency_avg_ms: Option<f64>,
    latency_max_ms: Option<f64>,
}

#[derive(Clone, Debug, Default)]
struct Rollup {
    total: u64,
    healthy: u64,
    degraded: u64,
    down: u64,
    latency_total: u64,
    latency_count: u64,
    latency_max: Option<u32>,
}

impl Rollup {
    fn add(&mut self, state: ResultState, latency_ms: Option<u32>) {
        self.total += 1;
        match state {
            ResultState::Healthy => self.healthy += 1,
            ResultState::Degraded => self.degraded += 1,
            ResultState::Down => self.down += 1,
            ResultState::Unknown => {}
        }
        if let Some(latency) = latency_ms {
            self.latency_total = self.latency_total.saturating_add(u64::from(latency));
            self.latency_count += 1;
            self.latency_max = Some(self.latency_max.unwrap_or(0).max(latency));
        }
    }

    fn add_stored(&mut self, stored: StoredRollupRow) {
        let total = stored.total_count as u64;
        self.total = self.total.saturating_add(total);
        self.healthy = self.healthy.saturating_add(stored.healthy_count as u64);
        self.degraded = self.degraded.saturating_add(stored.degraded_count as u64);
        self.down = self.down.saturating_add(stored.down_count as u64);
        if let Some(average) = stored.latency_avg_ms {
            self.latency_total = self
                .latency_total
                .saturating_add((average as u64).saturating_mul(total));
            self.latency_count = self.latency_count.saturating_add(total);
        }
        if let Some(maximum) = stored.latency_max_ms {
            self.latency_max = Some(self.latency_max.unwrap_or(0).max(maximum as u32));
        }
    }

    fn average(&self) -> Option<u32> {
        (self.latency_count > 0)
            .then(|| u32::try_from(self.latency_total / self.latency_count).unwrap_or(u32::MAX))
    }
}

pub async fn closed_rollup_statements(
    db: &D1Database,
    batch: &ResultBatch,
) -> Result<Vec<D1PreparedStatement>, worker::Error> {
    if minute_slot(batch.nominal_minute) != 4 {
        return Ok(Vec::new());
    }
    let bucket = block_start(batch.nominal_minute);
    let block = db
        .prepare(
            "SELECT result_0, result_1, result_2, result_3
             FROM check_result_blocks_5m WHERE check_pk = ? AND block_start = ?",
        )
        .bind(&[unsigned(batch.config.check_pk), number(bucket)])?
        .first::<BlockRow>(None)
        .await?;
    let mut five = Rollup::default();
    if let Some(block) = block {
        for payload in [
            block.result_0,
            block.result_1,
            block.result_2,
            block.result_3,
        ]
        .into_iter()
        .flatten()
        {
            if let Ok(stored) = serde_json::from_slice::<StoredBatch>(&payload) {
                five.add(stored.state, stored.latency_ms);
            }
        }
    }
    five.add(batch.state, batch.latency_ms);
    let mut statements = vec![rollup_statement(
        db,
        "check_rollups_5m",
        batch,
        bucket,
        &five,
    )?];
    statements.push(status_bucket_statement(db, batch, bucket, &five)?);
    let minute_in_hour = batch.nominal_minute.rem_euclid(3_600_000) / 60_000;
    if minute_in_hour == 59 {
        statements.push(hourly_rollup_statement(db, batch, bucket, &five).await?);
    }
    Ok(statements)
}

async fn hourly_rollup_statement(
    db: &D1Database,
    batch: &ResultBatch,
    bucket: i64,
    five: &Rollup,
) -> Result<D1PreparedStatement, worker::Error> {
    let hour_start = batch.nominal_minute.div_euclid(3_600_000) * 3_600_000;
    let previous = db
        .prepare(
            "SELECT total_count, healthy_count, degraded_count, down_count,
                    latency_avg_ms, latency_max_ms
             FROM check_rollups_5m
             WHERE check_pk = ? AND bucket_start >= ? AND bucket_start < ?
             ORDER BY bucket_start",
        )
        .bind(&[
            unsigned(batch.config.check_pk),
            number(hour_start),
            number(bucket),
        ])?
        .all()
        .await?
        .results::<StoredRollupRow>()?;
    let mut hour = Rollup::default();
    for stored in previous {
        hour.add_stored(stored);
    }
    hour.total = hour.total.saturating_add(five.total);
    hour.healthy = hour.healthy.saturating_add(five.healthy);
    hour.degraded = hour.degraded.saturating_add(five.degraded);
    hour.down = hour.down.saturating_add(five.down);
    hour.latency_total = hour.latency_total.saturating_add(five.latency_total);
    hour.latency_count = hour.latency_count.saturating_add(five.latency_count);
    hour.latency_max = match (hour.latency_max, five.latency_max) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (left, right) => left.or(right),
    };
    rollup_statement(db, "check_rollups_1h", batch, hour_start, &hour)
}

fn rollup_statement(
    db: &D1Database,
    table: &str,
    batch: &ResultBatch,
    bucket: i64,
    rollup: &Rollup,
) -> Result<D1PreparedStatement, worker::Error> {
    let query = format!(
        "INSERT INTO {table}
          (check_pk, workspace_pk, bucket_start, total_count, healthy_count,
           degraded_count, down_count, latency_avg_ms, latency_max_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(check_pk, bucket_start) DO UPDATE SET
           total_count = excluded.total_count, healthy_count = excluded.healthy_count,
           degraded_count = excluded.degraded_count, down_count = excluded.down_count,
           latency_avg_ms = excluded.latency_avg_ms, latency_max_ms = excluded.latency_max_ms"
    );
    db.prepare(query).bind(&[
        unsigned(batch.config.check_pk),
        unsigned(batch.config.workspace_pk),
        number(bucket),
        unsigned(rollup.total),
        unsigned(rollup.healthy),
        unsigned(rollup.degraded),
        unsigned(rollup.down),
        optional_unsigned(rollup.average()),
        optional_unsigned(rollup.latency_max),
    ])
}

fn status_bucket_statement(
    db: &D1Database,
    batch: &ResultBatch,
    bucket: i64,
    rollup: &Rollup,
) -> Result<D1PreparedStatement, worker::Error> {
    let state = if batch
        .config
        .maintenance_until
        .is_some_and(|until| until > batch.nominal_minute)
    {
        "maintenance"
    } else if rollup.down > 0 {
        "down"
    } else if rollup.degraded > 0 {
        "degraded"
    } else if rollup.healthy > 0 {
        "healthy"
    } else {
        "unknown"
    };
    let availability = if rollup.total == 0 {
        0
    } else {
        rollup.healthy.saturating_mul(1_000) / rollup.total
    };
    db.prepare(
        "INSERT INTO status_buckets
          (resource_type, resource_pk, workspace_pk, bucket_start, bucket_seconds,
           state, availability_permille, latency_avg_ms, latency_max_ms, summary_code)
         VALUES (2, ?, ?, ?, 300, ?, ?, ?, ?, ?)
         ON CONFLICT(resource_type, resource_pk, bucket_seconds, bucket_start) DO UPDATE SET
           state = CASE
             WHEN status_buckets.state = 'maintenance' OR excluded.state = 'maintenance' THEN 'maintenance'
             WHEN status_buckets.state = 'down' OR excluded.state = 'down' THEN 'down'
             WHEN status_buckets.state = 'degraded' OR excluded.state = 'degraded' THEN 'degraded'
             WHEN status_buckets.state = 'healthy' OR excluded.state = 'healthy' THEN 'healthy'
             ELSE 'unknown' END,
           availability_permille = MIN(status_buckets.availability_permille, excluded.availability_permille),
           latency_avg_ms = CASE
             WHEN status_buckets.latency_avg_ms IS NULL THEN excluded.latency_avg_ms
             WHEN excluded.latency_avg_ms IS NULL THEN status_buckets.latency_avg_ms
             ELSE MAX(status_buckets.latency_avg_ms, excluded.latency_avg_ms) END,
           latency_max_ms = CASE
             WHEN status_buckets.latency_max_ms IS NULL THEN excluded.latency_max_ms
             WHEN excluded.latency_max_ms IS NULL THEN status_buckets.latency_max_ms
             ELSE MAX(status_buckets.latency_max_ms, excluded.latency_max_ms) END,
           summary_code = excluded.summary_code",
    )
    .bind(&[
        unsigned(batch.config.service_pk),
        unsigned(batch.config.workspace_pk),
        number(bucket),
        text(state),
        unsigned(availability),
        optional_unsigned(rollup.average()),
        optional_unsigned(rollup.latency_max),
        text(service_reason(state)),
    ])
}

fn service_reason(state: &str) -> &'static str {
    match state {
        "maintenance" => "maintenance_window",
        "down" => "check_down",
        "degraded" => "check_degraded",
        "healthy" => "check_healthy",
        _ => "check_unknown",
    }
}

fn minute_slot(nominal_minute: i64) -> usize {
    nominal_minute.div_euclid(60_000).rem_euclid(5) as usize
}

fn block_start(nominal_minute: i64) -> i64 {
    nominal_minute.div_euclid(300_000) * 300_000
}
