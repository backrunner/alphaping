use std::time::Duration;

use alphaping_protocol::v1::LiveSessionCredential;
use anyhow::{Context, Result, bail};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde::Deserialize;
use tokio::{
    sync::{mpsc, watch},
    time::{Instant, MissedTickBehavior, interval_at, sleep, timeout},
};
use tokio_tungstenite::{
    Connector, connect_async_tls_with_config,
    tungstenite::{
        client::IntoClientRequest,
        http::{HeaderValue, header::SEC_WEBSOCKET_PROTOCOL},
        protocol::{Message, WebSocketConfig},
    },
};
use tracing::warn;

use super::{LiveDemand, OutboundFrame, frame::validate_credential};
use crate::{backoff::equal_jitter_delay, uploader::pq_tls_config};

const MAX_SERVER_MESSAGE_BYTES: usize = 2 * 1024;
const DEMAND_MAX_FUTURE_MS: i64 = 60_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DemandMessage {
    #[serde(rename = "type")]
    kind: String,
    topic: String,
    session_id: String,
    active: bool,
    expires_at: i64,
}

async fn wait_for_credential(
    receiver: &mut watch::Receiver<Option<LiveSessionCredential>>,
) -> Option<LiveSessionCredential> {
    loop {
        if let Some(credential) = receiver.borrow_and_update().clone()
            && credential.expires_at_ms > unix_time_ms()
        {
            return Some(credential);
        }
        if receiver.changed().await.is_err() {
            return None;
        }
    }
}

pub(super) async fn run_live_client(
    machine_pk: u64,
    mut credential_rx: watch::Receiver<Option<LiveSessionCredential>>,
    demand_tx: watch::Sender<LiveDemand>,
    mut outbound_rx: mpsc::Receiver<OutboundFrame>,
) {
    let mut attempt = 0_u32;
    while let Some(credential) = wait_for_credential(&mut credential_rx).await {
        demand_tx.send_replace(LiveDemand::default());
        if let Err(error) = run_live_session(
            machine_pk,
            &credential,
            &mut credential_rx,
            &demand_tx,
            &mut outbound_rx,
        )
        .await
        {
            warn!(error = %error, "live WebSocket session ended");
        }
        demand_tx.send_replace(LiveDemand::default());

        let credential_changed = credential_rx
            .borrow()
            .as_ref()
            .is_some_and(|current| current != &credential);
        if credential_changed {
            attempt = 0;
            continue;
        }
        let random = rand::rng().random_range(0.0..=1.0);
        let delay = equal_jitter_delay(attempt, random);
        attempt = attempt.saturating_add(1);
        tokio::select! {
            _ = sleep(delay) => {}
            changed = credential_rx.changed() => {
                if changed.is_err() {
                    return;
                }
            }
        }
    }
}

async fn run_live_session(
    machine_pk: u64,
    credential: &LiveSessionCredential,
    credential_rx: &mut watch::Receiver<Option<LiveSessionCredential>>,
    demand_tx: &watch::Sender<LiveDemand>,
    outbound_rx: &mut mpsc::Receiver<OutboundFrame>,
) -> Result<()> {
    validate_credential(credential, unix_time_ms())?;
    let mut request = credential.endpoint.as_str().into_client_request()?;
    request.headers_mut().insert(
        SEC_WEBSOCKET_PROTOCOL,
        HeaderValue::from_str(&format!(
            "alphaping.v1, alphaping.ticket.{}",
            credential.ticket
        ))?,
    );
    let websocket_config = WebSocketConfig::default()
        .read_buffer_size(4 * 1024)
        .write_buffer_size(4 * 1024)
        .max_write_buffer_size(32 * 1024)
        .max_message_size(Some(MAX_SERVER_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_SERVER_MESSAGE_BYTES));
    let (socket, response) = timeout(
        Duration::from_secs(8),
        connect_async_tls_with_config(
            request,
            Some(websocket_config),
            false,
            Some(Connector::Rustls(pq_tls_config()?)),
        ),
    )
    .await
    .context("live WebSocket connection timed out")??;
    if response
        .headers()
        .get(SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
        != Some("alphaping.v1")
    {
        bail!("live WebSocket protocol was not negotiated");
    }

    let (mut writer, mut reader) = socket.split();
    let mut demand_expires_at = 0_i64;
    let mut ping_tick = interval_at(
        Instant::now() + Duration::from_secs(60),
        Duration::from_secs(60),
    );
    ping_tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let session_id_text = URL_SAFE_NO_PAD.encode(&credential.session_id);
    let topic = format!("machine:{machine_pk}");
    loop {
        let expires_in = credential.expires_at_ms.saturating_sub(unix_time_ms());
        if expires_in <= 0 {
            return Ok(());
        }
        tokio::select! {
            changed = credential_rx.changed() => {
                changed.context("live credential channel closed")?;
                let changed_session = credential_rx
                    .borrow_and_update()
                    .as_ref()
                    .is_none_or(|next| next != credential);
                if changed_session {
                    return Ok(());
                }
            }
            incoming = reader.next() => {
                match incoming.context("live WebSocket disconnected")?? {
                    Message::Text(text) => {
                        let now = unix_time_ms();
                        let demand: DemandMessage = serde_json::from_str(text.as_str())?;
                        if demand.kind != "demand"
                            || demand.topic != topic
                            || demand.session_id != session_id_text
                            || demand.expires_at < now
                            || demand.expires_at > now.saturating_add(DEMAND_MAX_FUTURE_MS)
                        {
                            bail!("live demand message is invalid");
                        }
                        demand_expires_at = if demand.active { demand.expires_at } else { 0 };
                        demand_tx.send_replace(LiveDemand {
                            session_id: credential.session_id.clone(),
                            expires_at_ms: demand_expires_at,
                        });
                    }
                    Message::Ping(payload) => writer.send(Message::Pong(payload)).await?,
                    Message::Pong(_) => {}
                    Message::Close(_) => return Ok(()),
                    Message::Binary(_) | Message::Frame(_) => {
                        bail!("live server sent an unsupported message");
                    }
                }
            }
            outbound = outbound_rx.recv() => {
                let frame = outbound.context("live outbound channel closed")?;
                if frame.session_id == credential.session_id && demand_expires_at > unix_time_ms() {
                    writer.send(Message::binary(frame.bytes)).await?;
                }
            }
            _ = ping_tick.tick() => {
                writer.send(Message::Ping(Vec::new().into())).await?;
            }
            _ = sleep(Duration::from_millis(u64::try_from(expires_in).unwrap_or(1))) => {
                return Ok(());
            }
        }
    }
}

fn unix_time_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}
