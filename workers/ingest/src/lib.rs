use alphaping_protocol::v1::{MachineReport, MetricSample};
use thiserror::Error;

pub const MAX_REPORT_SAMPLES: usize = 6;
pub const MAX_SAFE_SEQUENCE: u64 = 9_007_199_254_740_991;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("protocol version is unsupported")]
    ProtocolVersion,
    #[error("transport sequence is outside D1's exact integer range")]
    SequenceRange,
    #[error("report identity does not match the authenticated envelope")]
    ReportIdentity,
    #[error("report resource scope does not match the enrolled agent")]
    ResourceScope,
    #[error("report sample count is invalid")]
    SampleCount,
    #[error("report time is invalid")]
    ReportTime,
}

pub fn validate_report(
    report: &MachineReport,
    authenticated_report_id: &[u8],
    machine_pk: u64,
    workspace_pk: u64,
    now_ms: i64,
) -> Result<(), ValidationError> {
    if report.report_id != authenticated_report_id {
        return Err(ValidationError::ReportIdentity);
    }
    if report.machine_pk != machine_pk || report.workspace_pk != workspace_pk {
        return Err(ValidationError::ResourceScope);
    }
    if report.samples.is_empty() || report.samples.len() > MAX_REPORT_SAMPLES {
        return Err(ValidationError::SampleCount);
    }
    if report.nominal_minute_ms.rem_euclid(60_000) != 0
        || report.nominal_minute_ms > now_ms.saturating_add(120_000)
    {
        return Err(ValidationError::ReportTime);
    }
    if report.samples.iter().any(|sample| {
        sample.observed_at_ms < report.nominal_minute_ms
            || sample.observed_at_ms >= report.nominal_minute_ms.saturating_add(60_000)
    }) {
        return Err(ValidationError::ReportTime);
    }
    Ok(())
}

#[derive(Clone, Debug, Default)]
pub struct MachineRollup {
    pub sample_count: u64,
    pub cpu_total_permille: u64,
    pub cpu_max_permille: u32,
    pub memory_total_bytes: u64,
    pub storage_max_bytes: u64,
    pub network_rx_bytes: u64,
    pub network_tx_bytes: u64,
}

impl MachineRollup {
    pub fn add_sample(&mut self, sample: &MetricSample) {
        self.sample_count += 1;
        self.cpu_total_permille += u64::from(sample.cpu_permille);
        self.cpu_max_permille = self.cpu_max_permille.max(sample.cpu_permille);
        self.memory_total_bytes = self
            .memory_total_bytes
            .saturating_add(sample.memory_used_bytes);
        self.storage_max_bytes = self.storage_max_bytes.max(sample.storage_used_bytes);
        self.network_rx_bytes = self
            .network_rx_bytes
            .saturating_add(sample.network_rx_bytes_per_second.saturating_mul(10));
        self.network_tx_bytes = self
            .network_tx_bytes
            .saturating_add(sample.network_tx_bytes_per_second.saturating_mul(10));
    }

    pub fn add_report(&mut self, report: &MachineReport) {
        for sample in &report.samples {
            self.add_sample(sample);
        }
    }

    pub fn cpu_average_permille(&self) -> u64 {
        self.cpu_total_permille / self.sample_count.max(1)
    }

    pub fn memory_average_bytes(&self) -> u64 {
        self.memory_total_bytes / self.sample_count.max(1)
    }
}

#[cfg(target_arch = "wasm32")]
mod worker_entry;

#[cfg(test)]
mod tests {
    use alphaping_protocol::v1::{MachineReport, MetricSample};

    use super::{ValidationError, validate_report};

    #[test]
    fn report_scope_and_time_are_authenticated() {
        let report = MachineReport {
            report_id: vec![1; 16],
            machine_pk: 7,
            workspace_pk: 2,
            nominal_minute_ms: 120_000,
            samples: vec![MetricSample {
                observed_at_ms: 125_000,
                ..MetricSample::default()
            }],
            schema_version: 1,
        };
        assert_eq!(validate_report(&report, &[1; 16], 7, 2, 180_000), Ok(()));
        assert_eq!(
            validate_report(&report, &[2; 16], 7, 2, 180_000),
            Err(ValidationError::ReportIdentity)
        );
    }
}
