use miniz_oxide::{
    deflate::compress_to_vec_zlib,
    inflate::{TINFLStatus, decompress_to_vec_zlib_with_limit},
};
use prost::Message;
use thiserror::Error;

pub mod v1 {
    include!(concat!(env!("OUT_DIR"), "/alphaping.v1.rs"));
}

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_ENVELOPE_BYTES: usize = 64 * 1024;
pub const MAX_DECOMPRESSED_BYTES: usize = 256 * 1024;

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("protobuf payload is invalid")]
    Decode(#[from] prost::DecodeError),
    #[error("compressed payload is invalid: {0:?}")]
    Decompress(TINFLStatus),
    #[error("payload exceeds the protocol size limit")]
    TooLarge,
}

pub fn encode_message<M: Message>(message: &M) -> Vec<u8> {
    message.encode_to_vec()
}

pub fn decode_message<M: Message + Default>(bytes: &[u8]) -> Result<M, ProtocolError> {
    if bytes.len() > MAX_DECOMPRESSED_BYTES {
        return Err(ProtocolError::TooLarge);
    }
    Ok(M::decode(bytes)?)
}

pub fn compress_message<M: Message>(message: &M) -> Result<Vec<u8>, ProtocolError> {
    let encoded = encode_message(message);
    if encoded.len() > MAX_DECOMPRESSED_BYTES {
        return Err(ProtocolError::TooLarge);
    }
    Ok(compress_to_vec_zlib(&encoded, 6))
}

pub fn decompress_message<M: Message + Default>(bytes: &[u8]) -> Result<M, ProtocolError> {
    if bytes.len() > MAX_ENVELOPE_BYTES {
        return Err(ProtocolError::TooLarge);
    }
    let decoded = decompress_to_vec_zlib_with_limit(bytes, MAX_DECOMPRESSED_BYTES)
        .map_err(|error| ProtocolError::Decompress(error.status))?;
    decode_message(&decoded)
}

#[cfg(test)]
mod tests {
    use super::{compress_message, decompress_message, v1::MetricSample};

    #[test]
    fn compressed_protobuf_round_trips() {
        let sample = MetricSample {
            observed_at_ms: 1_752_580_800_000,
            cpu_permille: 412,
            memory_used_bytes: 1_024,
            memory_total_bytes: 2_048,
            ..MetricSample::default()
        };
        let compressed = compress_message(&sample).expect("sample should compress");
        let decoded: MetricSample =
            decompress_message(&compressed).expect("sample should decompress");
        assert_eq!(decoded, sample);
    }
}
