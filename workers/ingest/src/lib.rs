use alphaping_protocol::{
    PROTOCOL_VERSION, encode_message,
    v1::{EnrollmentRequest, MachineReport, MetricSample},
};
use ed25519_dalek::{Signature, VerifyingKey};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use thiserror::Error;

pub const MAX_REPORT_SAMPLES: usize = 6;
pub const MAX_SAFE_SEQUENCE: u64 = 9_007_199_254_740_991;

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
    use alphaping_protocol::{
        PROTOCOL_VERSION, encode_message,
        v1::{EnrollmentRequest, MachineReport, MetricSample},
    };
    use ed25519_dalek::{Signer, SigningKey};

    use super::{
        EnrollmentValidationError, ValidationError, enrollment_token_digest,
        validate_enrollment_request, validate_report,
    };

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
        };
        request.signature = signing_key
            .sign(&encode_message(&request))
            .to_bytes()
            .to_vec();
        assert_eq!(validate_enrollment_request(&request), Ok(()));

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
        };
        assert_eq!(validate_report(&report, &[1; 16], 7, 2, 180_000), Ok(()));
        assert_eq!(
            validate_report(&report, &[2; 16], 7, 2, 180_000),
            Err(ValidationError::ReportIdentity)
        );
    }
}
