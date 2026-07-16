use alphaping_protocol::v1::LiveSessionCredential;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use thiserror::Error;

const AGENT_SESSION_SLOT_MS: i64 = 10 * 60_000;
const AGENT_SESSION_LIFETIME_MS: i64 = 15 * 60_000;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum LiveSessionError {
    #[error("live ticket secret is too short")]
    Secret,
    #[error("live origin is invalid")]
    Origin,
    #[error("live session signing failed")]
    Signing,
    #[error("live ticket encoding failed")]
    Encoding,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentTicketClaims<'a> {
    version: u8,
    workspace_id: &'a str,
    subject_id: &'a str,
    role: &'static str,
    topics: [String; 1],
    projection: &'static str,
    issued_at: i64,
    not_before: i64,
    expires_at: i64,
    session_id: String,
    nonce_prefix: String,
}

fn keyed_digest(
    secret: &[u8],
    label: &[u8],
    parts: &[&[u8]],
) -> Result<[u8; 32], LiveSessionError> {
    let mut mac =
        <Hmac<Sha256> as Mac>::new_from_slice(secret).map_err(|_| LiveSessionError::Signing)?;
    mac.update(label);
    for part in parts {
        mac.update(&[0]);
        mac.update(part);
    }
    Ok(mac.finalize().into_bytes().into())
}

pub fn issue_live_session(
    secret: &str,
    origin: &str,
    workspace_id: &str,
    agent_id: &str,
    machine_pk: u64,
    now_ms: i64,
) -> Result<LiveSessionCredential, LiveSessionError> {
    if secret.as_bytes().len() < 32 {
        return Err(LiveSessionError::Secret);
    }
    if origin.len() > 256
        || !origin.starts_with("wss://")
        || origin.bytes().any(|byte| byte.is_ascii_whitespace())
    {
        return Err(LiveSessionError::Origin);
    }
    let origin = origin.trim_end_matches('/');
    if origin.len() <= "wss://".len() || origin["wss://".len()..].contains('/') {
        return Err(LiveSessionError::Origin);
    }

    let slot = now_ms.div_euclid(AGENT_SESSION_SLOT_MS) * AGENT_SESSION_SLOT_MS;
    let slot_bytes = slot.to_be_bytes();
    let machine_bytes = machine_pk.to_be_bytes();
    let session_digest = keyed_digest(
        secret.as_bytes(),
        b"alphaping/v1/live-session",
        &[
            workspace_id.as_bytes(),
            agent_id.as_bytes(),
            &machine_bytes,
            &slot_bytes,
        ],
    )?;
    let session_id = &session_digest[..16];
    let session_key = keyed_digest(secret.as_bytes(), b"alphaping/v1/live-key", &[session_id])?;
    let nonce_digest = keyed_digest(secret.as_bytes(), b"alphaping/v1/live-nonce", &[session_id])?;
    let nonce_prefix = &nonce_digest[..4];
    let expires_at = slot.saturating_add(AGENT_SESSION_LIFETIME_MS);
    let claims = AgentTicketClaims {
        version: 1,
        workspace_id,
        subject_id: agent_id,
        role: "agent",
        topics: [format!("machine:{machine_pk}")],
        projection: "internal",
        issued_at: slot,
        not_before: slot,
        expires_at,
        session_id: URL_SAFE_NO_PAD.encode(session_id),
        nonce_prefix: URL_SAFE_NO_PAD.encode(nonce_prefix),
    };
    let payload = serde_json::to_vec(&claims).map_err(|_| LiveSessionError::Encoding)?;
    let payload_part = URL_SAFE_NO_PAD.encode(payload);
    let signature = keyed_digest(
        secret.as_bytes(),
        b"alphaping/v1/live-ticket",
        &[payload_part.as_bytes()],
    )?;
    let ticket = format!("{payload_part}.{}", URL_SAFE_NO_PAD.encode(signature));

    Ok(LiveSessionCredential {
        endpoint: format!("{origin}/v1/live/{workspace_id}"),
        ticket,
        session_id: session_id.to_vec(),
        session_key: session_key.to_vec(),
        nonce_prefix: nonce_prefix.to_vec(),
        expires_at_ms: expires_at,
    })
}

#[cfg(test)]
mod tests {
    use super::{LiveSessionError, issue_live_session};

    const SECRET: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn session_is_stable_within_a_ten_minute_slot() {
        let first = issue_live_session(
            SECRET,
            "wss://live.example.test",
            "workspace-1",
            "agent-1",
            7,
            610_000,
        )
        .expect("live session");
        let second = issue_live_session(
            SECRET,
            "wss://live.example.test",
            "workspace-1",
            "agent-1",
            7,
            1_190_000,
        )
        .expect("live session");
        assert_eq!(first, second);
        assert_eq!(first.expires_at_ms, 1_500_000);
    }

    #[test]
    fn session_rotates_without_reusing_the_live_key() {
        let first = issue_live_session(
            SECRET,
            "wss://live.example.test",
            "workspace-1",
            "agent-1",
            7,
            1_190_000,
        )
        .expect("first live session");
        let next = issue_live_session(
            SECRET,
            "wss://live.example.test",
            "workspace-1",
            "agent-1",
            7,
            1_200_000,
        )
        .expect("next live session");
        assert_ne!(first.session_id, next.session_id);
        assert_ne!(first.session_key, next.session_key);
        assert_ne!(first.nonce_prefix, next.nonce_prefix);
    }

    #[test]
    fn only_wss_origins_and_high_entropy_secrets_are_accepted() {
        assert_eq!(
            issue_live_session("short", "wss://live.example.test", "w", "a", 1, 0),
            Err(LiveSessionError::Secret)
        );
        assert_eq!(
            issue_live_session(SECRET, "https://live.example.test", "w", "a", 1, 0),
            Err(LiveSessionError::Origin)
        );
    }
}
