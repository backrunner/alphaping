use std::time::Duration;

pub const MAX_BACKOFF_SECONDS: u64 = 300;

pub fn equal_jitter_delay(attempt: u32, unit_interval: f64) -> Duration {
    let exponent = attempt.min(31);
    let ceiling = 1_u64
        .checked_shl(exponent)
        .unwrap_or(u64::MAX)
        .min(MAX_BACKOFF_SECONDS);
    let bounded_unit = unit_interval.clamp(0.0, 1.0);
    let half = ceiling as f64 / 2.0;
    Duration::from_secs_f64(half + half * bounded_unit)
}

#[cfg(test)]
mod tests {
    use super::{MAX_BACKOFF_SECONDS, equal_jitter_delay};

    #[test]
    fn retry_delay_never_exceeds_five_minutes() {
        assert_eq!(equal_jitter_delay(0, 1.0).as_secs(), 1);
        assert_eq!(equal_jitter_delay(20, 1.0).as_secs(), MAX_BACKOFF_SECONDS);
        assert_eq!(
            equal_jitter_delay(20, 0.0).as_secs(),
            MAX_BACKOFF_SECONDS / 2
        );
    }
}
