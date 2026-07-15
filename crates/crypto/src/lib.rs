use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, Payload},
};
use hkdf::Hkdf;
use sha2::Sha256;
use thiserror::Error;

const CLIENT_INFO: &[u8] = b"alphaping/v1/client-to-server";
const SERVER_INFO: &[u8] = b"alphaping/v1/server-to-client";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DirectionalKeys {
    pub client_to_server: [u8; 32],
    pub server_to_client: [u8; 32],
}

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("key material has an invalid length")]
    InvalidKey,
    #[error("authenticated encryption failed")]
    Authentication,
}

impl DirectionalKeys {
    pub fn derive(
        root_key: &[u8; 32],
        agent_id: &[u8],
        key_epoch: u32,
    ) -> Result<Self, CryptoError> {
        let mut salt = Vec::with_capacity(agent_id.len() + 4);
        salt.extend_from_slice(agent_id);
        salt.extend_from_slice(&key_epoch.to_be_bytes());
        let hkdf = Hkdf::<Sha256>::new(Some(&salt), root_key);
        let mut client_to_server = [0_u8; 32];
        let mut server_to_client = [0_u8; 32];
        hkdf.expand(CLIENT_INFO, &mut client_to_server)
            .map_err(|_| CryptoError::InvalidKey)?;
        hkdf.expand(SERVER_INFO, &mut server_to_client)
            .map_err(|_| CryptoError::InvalidKey)?;
        Ok(Self {
            client_to_server,
            server_to_client,
        })
    }
}

pub fn nonce(prefix: [u8; 4], sequence: u64) -> [u8; 12] {
    let mut nonce = [0_u8; 12];
    nonce[..4].copy_from_slice(&prefix);
    nonce[4..].copy_from_slice(&sequence.to_be_bytes());
    nonce
}

pub fn seal(
    key: &[u8; 32],
    nonce_prefix: [u8; 4],
    sequence: u64,
    aad: &[u8],
    plaintext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CryptoError::InvalidKey)?;
    cipher
        .encrypt(
            Nonce::from_slice(&nonce(nonce_prefix, sequence)),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| CryptoError::Authentication)
}

pub fn open(
    key: &[u8; 32],
    nonce_prefix: [u8; 4],
    sequence: u64,
    aad: &[u8],
    ciphertext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CryptoError::InvalidKey)?;
    cipher
        .decrypt(
            Nonce::from_slice(&nonce(nonce_prefix, sequence)),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| CryptoError::Authentication)
}

pub fn wrap_key(
    wrapping_key: &[u8; 32],
    wrapping_nonce: [u8; 12],
    key_to_wrap: &[u8; 32],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(wrapping_key).map_err(|_| CryptoError::InvalidKey)?;
    cipher
        .encrypt(
            Nonce::from_slice(&wrapping_nonce),
            Payload {
                msg: key_to_wrap,
                aad,
            },
        )
        .map_err(|_| CryptoError::Authentication)
}

pub fn unwrap_key(
    wrapping_key: &[u8; 32],
    wrapping_nonce: [u8; 12],
    wrapped_key: &[u8],
    aad: &[u8],
) -> Result<[u8; 32], CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(wrapping_key).map_err(|_| CryptoError::InvalidKey)?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&wrapping_nonce),
            Payload {
                msg: wrapped_key,
                aad,
            },
        )
        .map_err(|_| CryptoError::Authentication)?;
    plaintext.try_into().map_err(|_| CryptoError::InvalidKey)
}

#[cfg(test)]
mod tests {
    use super::{DirectionalKeys, nonce, open, seal};

    #[test]
    fn directional_keys_are_distinct_and_stable() {
        let keys = DirectionalKeys::derive(&[7_u8; 32], b"agent-1", 3).expect("HKDF should work");
        assert_ne!(keys.client_to_server, keys.server_to_client);
        assert_eq!(
            hex::encode(keys.client_to_server),
            "065febfd69b8dd9fe94a69150ac9bf5c55418b356b0bdc943af7184a8895c063"
        );
    }

    #[test]
    fn envelope_authenticates_aad_and_sequence() {
        let key = [9_u8; 32];
        let ciphertext =
            seal(&key, [1, 2, 3, 4], 8, b"header", b"payload").expect("encryption should work");
        assert_eq!(
            open(&key, [1, 2, 3, 4], 8, b"header", &ciphertext).expect("decryption should work"),
            b"payload"
        );
        assert!(open(&key, [1, 2, 3, 4], 9, b"header", &ciphertext).is_err());
        assert_eq!(nonce([1, 2, 3, 4], 8), [1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 8]);
    }
}
