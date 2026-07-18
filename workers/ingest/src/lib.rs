use alphaping_protocol::{
    PROTOCOL_VERSION, encode_message,
    v1::{EnrollmentRequest, MachineReport, MetricSample},
};
use ed25519_dalek::{Signature, VerifyingKey};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use thiserror::Error;

#[cfg(any(target_arch = "wasm32", test))]
#[path = "check_results/model.rs"]
mod check_result_model;
#[cfg(any(target_arch = "wasm32", test))]
mod live_session;

pub const MAX_REPORT_SAMPLES: usize = 6;
pub const MAX_CONTAINER_COUNT: usize = 64;
pub const MAX_CONTAINER_PORTS: usize = 8;
pub const MAX_RUNTIME_COUNT: usize = 16;
pub const MAX_PROBE_RESULTS: usize = 512;
pub const MAX_COMMAND_RESULTS: usize = 16;
pub const MAX_SAFE_SEQUENCE: u64 = 9_007_199_254_740_991;
pub const CPU_DEGRADED_PERMILLE: u32 = 800;
pub const CPU_DOWN_PERMILLE: u32 = 950;
pub const CAPACITY_DEGRADED_PERMILLE: u64 = 850;
pub const CAPACITY_DOWN_PERMILLE: u64 = 950;

pub fn is_protobuf_content_type(value: Option<&str>) -> bool {
    value.is_some_and(|value| value.eq_ignore_ascii_case("application/x-protobuf"))
}

pub fn client_ip_rate_key(value: Option<&str>) -> String {
    let value = value
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() || matches!(byte, b'.' | b':'))
        })
        .unwrap_or("unknown");
    format!("ip:{value}")
}

pub fn within_clock_skew(now_ms: i64, sent_at_ms: i64, maximum_skew_ms: u64) -> bool {
    now_ms.abs_diff(sent_at_ms) <= maximum_skew_ms
}

fn bounded_system_text(value: &str, maximum: usize) -> bool {
    value.len() <= maximum && value.chars().all(|character| !character.is_control())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MachineHealthState {
    Healthy,
    Degraded,
    Down,
    Maintenance,
}

impl MachineHealthState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::Degraded => "degraded",
            Self::Down => "down",
            Self::Maintenance => "maintenance",
        }
    }
}

fn usage_permille(used: u64, total: u64) -> u64 {
    if total == 0 {
        return 0;
    }
    used.saturating_mul(1_000) / total
}

pub fn machine_health_state(sample: &MetricSample, maintenance: bool) -> MachineHealthState {
    if maintenance {
        return MachineHealthState::Maintenance;
    }
    let memory = usage_permille(sample.memory_used_bytes, sample.memory_total_bytes);
    let storage = usage_permille(sample.storage_used_bytes, sample.storage_total_bytes);
    if sample.cpu_permille >= CPU_DOWN_PERMILLE
        || memory >= CAPACITY_DOWN_PERMILLE
        || storage >= CAPACITY_DOWN_PERMILLE
    {
        MachineHealthState::Down
    } else if sample.cpu_permille >= CPU_DEGRADED_PERMILLE
        || memory >= CAPACITY_DEGRADED_PERMILLE
        || storage >= CAPACITY_DEGRADED_PERMILLE
    {
        MachineHealthState::Degraded
    } else {
        MachineHealthState::Healthy
    }
}

fn looks_like_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum EnrollmentValidationError {
    #[error("enrollment fields are invalid")]
    Fields,
    #[error("enrollment identity proof is invalid")]
    Signature,
}

pub fn enrollment_token_digest(
    pepper: &[u8; 32],
    token: &[u8],
) -> Result<[u8; 32], hmac::digest::InvalidLength> {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(pepper)?;
    mac.update(token);
    Ok(mac.finalize().into_bytes().into())
}

pub fn validate_enrollment_request(
    enrollment: &EnrollmentRequest,
) -> Result<(), EnrollmentValidationError> {
    let token_is_base64url = enrollment.token.len() == 43
        && enrollment
            .token
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'-' || *byte == b'_');
    let machine_claim_is_uuid = enrollment.machine_claim_id.len() == 36
        && enrollment
            .machine_claim_id
            .bytes()
            .enumerate()
            .all(|(index, byte)| match index {
                8 | 13 | 18 | 23 => byte == b'-',
                _ => byte.is_ascii_hexdigit(),
            });
    if enrollment.protocol_version != PROTOCOL_VERSION
        || enrollment.supported_protocol_versions.len() > 8
        || !enrollment
            .supported_protocol_versions
            .contains(&PROTOCOL_VERSION)
        || !enrollment.pq_hybrid
        || !token_is_base64url
        || !machine_claim_is_uuid
        || enrollment.identity_public_key.len() != 32
        || enrollment.request_nonce.len() != 32
        || enrollment.platform.is_empty()
        || enrollment.platform.len() > 32
        || enrollment.arch.is_empty()
        || enrollment.arch.len() > 32
        || enrollment.agent_version.is_empty()
        || enrollment.agent_version.len() > 32
        || !bounded_system_text(&enrollment.hostname, 253)
        || !bounded_system_text(&enrollment.os_name, 64)
        || !bounded_system_text(&enrollment.os_version, 128)
        || !bounded_system_text(&enrollment.kernel_version, 128)
        || enrollment.signature.len() != 64
    {
        return Err(EnrollmentValidationError::Fields);
    }

    let public_key_bytes: [u8; 32] = enrollment
        .identity_public_key
        .as_slice()
        .try_into()
        .map_err(|_| EnrollmentValidationError::Fields)?;
    let public_key = VerifyingKey::from_bytes(&public_key_bytes)
        .map_err(|_| EnrollmentValidationError::Fields)?;
    let signature = Signature::from_slice(&enrollment.signature)
        .map_err(|_| EnrollmentValidationError::Fields)?;
    let mut canonical = enrollment.clone();
    canonical.signature.clear();
    public_key
        .verify_strict(&encode_message(&canonical), &signature)
        .map_err(|_| EnrollmentValidationError::Signature)
}

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
    authenticated_agent_id: &str,
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
            || sample.cpu_permille > 1_000
            || (sample.memory_total_bytes > 0
                && sample.memory_used_bytes > sample.memory_total_bytes)
            || (sample.storage_total_bytes > 0
                && sample.storage_used_bytes > sample.storage_total_bytes)
            || sample
                .uptime_seconds
                .is_some_and(|uptime| uptime > MAX_SAFE_SEQUENCE)
    }) {
        return Err(ValidationError::ReportTime);
    }
    if let Some(inventory) = &report.container_inventory
        && (inventory.observed_at_ms < report.nominal_minute_ms
            || inventory.observed_at_ms >= report.nominal_minute_ms.saturating_add(60_000)
            || inventory.catalog_digest.len() != 32
            || inventory.runtimes.len() > MAX_RUNTIME_COUNT
            || inventory.catalog.len() > MAX_CONTAINER_COUNT
            || (!inventory.catalog_included && !inventory.catalog.is_empty())
            || inventory.metrics.len() > MAX_CONTAINER_COUNT
            || inventory.catalog.iter().any(|entry| {
                entry.container_key.len() != 16
                    || entry.runtime_instance.len() > 64
                    || entry.runtime_container_id.len() > 128
                    || entry.name.len() > 128
                    || entry.image.len() > 512
            })
            || inventory.metrics.iter().any(|metric| {
                metric.container_key.len() != 16 || metric.ports.len() > MAX_CONTAINER_PORTS
            }))
    {
        return Err(ValidationError::ReportTime);
    }
    if report.probe_results.len() > MAX_PROBE_RESULTS {
        return Err(ValidationError::SampleCount);
    }
    let mut execution_ids = std::collections::HashSet::with_capacity(report.probe_results.len());
    if report.probe_results.iter().any(|result| {
        result.execution_id.len() != 32
            || !execution_ids.insert(result.execution_id.as_slice())
            || result.check_id.len() != 36
            || result.check_pk == 0
            || result.service_pk == 0
            || result.workspace_pk != workspace_pk
            || result.executor_agent_id != authenticated_agent_id
            || result.config_revision == 0
            || result.config_revision > report.applied_config_revision
            || result.nominal_slot_ms.rem_euclid(1_000) != 0
            || result.nominal_slot_ms > now_ms.saturating_add(120_000)
            || result.observed_at_ms < result.nominal_slot_ms
            || result.observed_at_ms > result.nominal_slot_ms.saturating_add(60_000)
            || !(1..=3).contains(&result.state)
            || result.failure_code.len() > 64
            || result.failure_summary.len() > 160
    }) {
        return Err(ValidationError::ReportTime);
    }
    if report.agent_version.len() > 32
        || !report
            .agent_version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
        || report.command_results.len() > MAX_COMMAND_RESULTS
    {
        return Err(ValidationError::ReportTime);
    }
    let mut command_ids = std::collections::HashSet::with_capacity(report.command_results.len());
    if report.command_results.iter().any(|result| {
        !looks_like_uuid(&result.command_id)
            || !command_ids.insert(result.command_id.as_str())
            || !(1..=2).contains(&result.status)
            || result.completed_at_ms > now_ms.saturating_add(120_000)
            || result.result_code.is_empty()
            || result.result_code.len() > 64
            || result.installed_version.len() > 64
            || !result
                .installed_version
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+'))
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
mod agent_commands;
#[cfg(target_arch = "wasm32")]
mod agent_config;
#[cfg(target_arch = "wasm32")]
mod check_results;
#[cfg(target_arch = "wasm32")]
mod worker_entry;

#[cfg(test)]
mod tests {
    use alphaping_protocol::{
        PROTOCOL_VERSION, encode_message,
        v1::{EnrollmentRequest, MachineReport, MetricSample},
    };
    use ed25519_dalek::{Signer, SigningKey};

    use super::{
        EnrollmentValidationError, MachineHealthState, ValidationError, client_ip_rate_key,
        enrollment_token_digest, is_protobuf_content_type, machine_health_state,
        validate_enrollment_request, validate_report, within_clock_skew,
    };

    #[test]
    fn agent_endpoints_require_the_exact_protobuf_media_type() {
        assert!(is_protobuf_content_type(Some("application/x-protobuf")));
        assert!(is_protobuf_content_type(Some("APPLICATION/X-PROTOBUF")));
        assert!(!is_protobuf_content_type(None));
        assert!(!is_protobuf_content_type(Some("application/octet-stream")));
        assert!(!is_protobuf_content_type(Some(
            "application/x-protobuf; charset=utf-8"
        )));
    }

    #[test]
    fn client_ip_rate_keys_are_bounded_and_canonical() {
        assert_eq!(client_ip_rate_key(Some("203.0.113.8")), "ip:203.0.113.8");
        assert_eq!(client_ip_rate_key(Some("2001:db8::1")), "ip:2001:db8::1");
        assert_eq!(client_ip_rate_key(None), "ip:unknown");
        assert_eq!(client_ip_rate_key(Some("203.0.113.8:forged")), "ip:unknown");
        assert_eq!(client_ip_rate_key(Some(&"1".repeat(65))), "ip:unknown");
    }

    #[test]
    fn clock_skew_validation_cannot_overflow() {
        assert!(within_clock_skew(1_000, 301_000, 300_000));
        assert!(within_clock_skew(1_000, -299_000, 300_000));
        assert!(!within_clock_skew(1_000, 301_001, 300_000));
        assert!(!within_clock_skew(0, i64::MIN, 300_000));
        assert!(!within_clock_skew(i64::MAX, i64::MIN, 300_000));
    }

    #[test]
    fn enrollment_requires_a_signed_machine_bound_proof() {
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        let mut request = EnrollmentRequest {
            token: b"abcdefghijklmnopqrstuvwxyzABCDEFGH012345678".to_vec(),
            identity_public_key: signing_key.verifying_key().to_bytes().to_vec(),
            platform: "linux".to_owned(),
            arch: "x86_64".to_owned(),
            agent_version: "0.1.0".to_owned(),
            protocol_version: PROTOCOL_VERSION,
            machine_claim_id: "018f5f7e-7d28-7e12-a521-23456789abcd".to_owned(),
            request_nonce: vec![4; 32],
            supported_protocol_versions: vec![PROTOCOL_VERSION],
            pq_hybrid: true,
            signature: Vec::new(),
            hostname: "edge-01.example.test".to_owned(),
            os_name: "Linux".to_owned(),
            os_version: "6.8".to_owned(),
            kernel_version: "6.8.0-test".to_owned(),
        };
        request.signature = signing_key
            .sign(&encode_message(&request))
            .to_bytes()
            .to_vec();
        assert_eq!(validate_enrollment_request(&request), Ok(()));

        let mut invalid_system_info = request.clone();
        invalid_system_info.hostname = "edge-01\nforged".to_owned();
        invalid_system_info.signature.clear();
        invalid_system_info.signature = signing_key
            .sign(&encode_message(&invalid_system_info))
            .to_bytes()
            .to_vec();
        assert_eq!(
            validate_enrollment_request(&invalid_system_info),
            Err(EnrollmentValidationError::Fields)
        );

        request.machine_claim_id = "018f5f7e-7d28-7e12-a521-000000000000".to_owned();
        assert_eq!(
            validate_enrollment_request(&request),
            Err(EnrollmentValidationError::Signature)
        );
    }

    #[test]
    fn enrollment_token_digest_is_peppered() {
        let token = b"abcdefghijklmnopqrstuvwxyzABCDEFGH012345678";
        assert_ne!(
            enrollment_token_digest(&[1; 32], token).expect("valid key"),
            enrollment_token_digest(&[2; 32], token).expect("valid key")
        );
    }

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
            container_inventory: None,
            probe_results: Vec::new(),
            applied_config_revision: 0,
            command_results: Vec::new(),
            agent_version: "0.1.0".to_owned(),
        };
        assert_eq!(
            validate_report(&report, &[1; 16], 7, 2, "agent-1", 180_000),
            Ok(())
        );
        assert_eq!(
            validate_report(&report, &[2; 16], 7, 2, "agent-1", 180_000),
            Err(ValidationError::ReportIdentity)
        );
    }

    #[test]
    fn machine_thresholds_apply_down_before_degraded_and_maintenance_first() {
        let sample = MetricSample {
            cpu_permille: 799,
            memory_used_bytes: 849,
            memory_total_bytes: 1_000,
            storage_used_bytes: 849,
            storage_total_bytes: 1_000,
            ..MetricSample::default()
        };
        assert_eq!(
            machine_health_state(&sample, false),
            MachineHealthState::Healthy
        );
        assert_eq!(
            machine_health_state(
                &MetricSample {
                    cpu_permille: 800,
                    ..sample
                },
                false
            ),
            MachineHealthState::Degraded
        );
        assert_eq!(
            machine_health_state(
                &MetricSample {
                    memory_used_bytes: 950,
                    ..sample
                },
                false
            ),
            MachineHealthState::Down
        );
        assert_eq!(
            machine_health_state(&sample, true),
            MachineHealthState::Maintenance
        );
    }
}
