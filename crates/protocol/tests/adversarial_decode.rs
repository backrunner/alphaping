use std::panic::{AssertUnwindSafe, catch_unwind};

use alphaping_protocol::{
    MAX_DECOMPRESSED_BYTES, MAX_ENVELOPE_BYTES, ProtocolError, compress_message, decode_message,
    decompress_message, encode_message,
    v1::{EncryptedEnvelope, EnvelopeHeader, MachineReport, MetricSample},
};
use miniz_oxide::deflate::compress_to_vec_zlib;

struct FuzzStream(u64);

impl FuzzStream {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next(&mut self) -> u64 {
        let mut value = self.0;
        value ^= value >> 12;
        value ^= value << 25;
        value ^= value >> 27;
        self.0 = value;
        value.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn bounded(&mut self, upper_exclusive: usize) -> usize {
        usize::try_from(self.next() % upper_exclusive as u64).expect("bounded fuzz value")
    }

    fn bytes(&mut self, length: usize) -> Vec<u8> {
        (0..length).map(|_| self.next() as u8).collect()
    }
}

fn append_varint(bytes: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        bytes.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
    bytes.push(value as u8);
}

#[test]
fn bounded_adversarial_inputs_never_panic() {
    let mut fuzz = FuzzStream::new(0xa17f_91c5_d3e2_680b);
    let boundary_lengths = [
        0,
        1,
        2,
        63,
        64,
        127,
        128,
        255,
        256,
        1_024,
        MAX_ENVELOPE_BYTES - 1,
        MAX_ENVELOPE_BYTES,
    ];

    for case in 0..2_048 {
        let length = if case < boundary_lengths.len() {
            boundary_lengths[case]
        } else {
            fuzz.bounded(MAX_ENVELOPE_BYTES + 1)
        };
        let bytes = fuzz.bytes(length);
        let result = catch_unwind(AssertUnwindSafe(|| {
            let _ = decode_message::<EncryptedEnvelope>(&bytes);
            let _ = decode_message::<MachineReport>(&bytes);
            let _ = decompress_message::<MachineReport>(&bytes);
        }));
        assert!(result.is_ok(), "parser panicked for fuzz case {case}");
    }
}

#[test]
fn generated_messages_round_trip_across_bounded_values() {
    let mut fuzz = FuzzStream::new(0x64de_b9a1_70c3_2f85);

    for case in 0..1_024_u64 {
        let report_id_length = fuzz.bounded(33);
        let report_id = fuzz.bytes(report_id_length);
        let agent_version_length = fuzz.bounded(513);
        let agent_version_bytes = fuzz.bytes(agent_version_length);
        let report = MachineReport {
            report_id,
            machine_pk: fuzz.next(),
            workspace_pk: fuzz.next(),
            nominal_minute_ms: fuzz.next() as i64,
            samples: (0..fuzz.bounded(17))
                .map(|_| MetricSample {
                    observed_at_ms: fuzz.next() as i64,
                    cpu_permille: fuzz.next() as u32,
                    memory_used_bytes: fuzz.next(),
                    memory_total_bytes: fuzz.next(),
                    storage_used_bytes: fuzz.next(),
                    storage_total_bytes: fuzz.next(),
                    network_rx_bytes_per_second: fuzz.next(),
                    network_tx_bytes_per_second: fuzz.next(),
                    network_rx_bytes_total: fuzz.next(),
                    network_tx_bytes_total: fuzz.next(),
                    load_1m_milli: case.is_multiple_of(2).then(|| fuzz.next() as u32),
                    uptime_seconds: case.is_multiple_of(3).then(|| fuzz.next()),
                })
                .collect(),
            schema_version: fuzz.next() as u32,
            agent_version: String::from_utf8(agent_version_bytes)
                .unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned()),
            ..MachineReport::default()
        };
        let encoded = encode_message(&report);
        let decoded: MachineReport = decode_message(&encoded).expect("generated protobuf");
        assert_eq!(decoded, report, "protobuf round trip case {case}");

        let compressed = compress_message(&report).expect("generated compressed protobuf");
        assert!(compressed.len() <= MAX_ENVELOPE_BYTES);
        let decompressed: MachineReport =
            decompress_message(&compressed).expect("generated decompressed protobuf");
        assert_eq!(decompressed, report, "compressed round trip case {case}");
    }
}

#[test]
fn protobuf_unknown_fields_are_ignored() {
    let envelope = EncryptedEnvelope {
        header: Some(EnvelopeHeader {
            protocol_version: 1,
            agent_id: vec![7; 16],
            key_epoch: 4,
            sequence: 99,
            sent_at_ms: 1_752_580_800_000,
            report_id: vec![9; 16],
        }),
        ciphertext: vec![3; 64],
    };
    let mut encoded = encode_message(&envelope);
    append_varint(&mut encoded, (1_000 << 3) | 2);
    append_varint(&mut encoded, 4);
    encoded.extend_from_slice(&[0xde, 0xad, 0xbe, 0xef]);

    let decoded: EncryptedEnvelope = decode_message(&encoded).expect("forward-compatible envelope");
    assert_eq!(decoded, envelope);
}

#[test]
fn protobuf_and_decompression_limits_fail_closed() {
    let oversized_protobuf = vec![0; MAX_DECOMPRESSED_BYTES + 1];
    assert!(matches!(
        decode_message::<MachineReport>(&oversized_protobuf),
        Err(ProtocolError::TooLarge)
    ));

    let oversized_envelope = vec![0; MAX_ENVELOPE_BYTES + 1];
    assert!(matches!(
        decompress_message::<MachineReport>(&oversized_envelope),
        Err(ProtocolError::TooLarge)
    ));

    let expanded = vec![0; MAX_DECOMPRESSED_BYTES + 1];
    let compressed_bomb = compress_to_vec_zlib(&expanded, 6);
    assert!(compressed_bomb.len() < MAX_ENVELOPE_BYTES);
    assert!(matches!(
        decompress_message::<MachineReport>(&compressed_bomb),
        Err(ProtocolError::Decompress(_))
    ));
}
