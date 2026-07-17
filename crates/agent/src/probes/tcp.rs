use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use alphaping_protocol::v1::TcpProbeRequest;
use rustls::pki_types::ServerName;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;

use super::{ProbeOutcome, elapsed_ms, require_nonempty, tls};

pub async fn execute(request: &TcpProbeRequest, timeout: Duration) -> ProbeOutcome {
    if require_nonempty(&request.hostname, "TCP hostname").is_err() {
        return ProbeOutcome::failed("invalid_config");
    }
    let started = Instant::now();
    let stream = match tokio::time::timeout(
        timeout,
        TcpStream::connect((&*request.hostname, request.port as u16)),
    )
    .await
    {
        Ok(Ok(stream)) => stream,
        Ok(Err(_)) => return ProbeOutcome::failed("network"),
        Err(_) => return ProbeOutcome::failed("timeout"),
    };
    let remaining = timeout.saturating_sub(started.elapsed());
    let result = if request.use_tls {
        let config = match tls::client_config(request.tls_verify.unwrap_or(true)) {
            Ok(config) => config,
            Err(_) => return ProbeOutcome::failed("tls"),
        };
        let server_name = match ServerName::try_from(
            request
                .server_name
                .clone()
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| request.hostname.clone()),
        ) {
            Ok(name) => name,
            Err(_) => return ProbeOutcome::failed("invalid_config"),
        };
        match tokio::time::timeout(
            remaining,
            TlsConnector::from(Arc::new(config)).connect(server_name, stream),
        )
        .await
        {
            Ok(Ok(mut stream)) => exchange(&mut stream, request).await,
            Ok(Err(_)) => Err("tls"),
            Err(_) => Err("timeout"),
        }
    } else {
        let mut stream = stream;
        match tokio::time::timeout(remaining, exchange(&mut stream, request)).await {
            Ok(result) => result,
            Err(_) => Err("timeout"),
        }
    };
    match result {
        Ok(()) => ProbeOutcome::healthy(elapsed_ms(started)),
        Err(code) => {
            let mut outcome = ProbeOutcome::failed(code);
            outcome.latency_ms = Some(elapsed_ms(started));
            outcome
        }
    }
}

async fn exchange<S>(stream: &mut S, request: &TcpProbeRequest) -> Result<(), &'static str>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    if !request.payload.is_empty() {
        stream
            .write_all(&request.payload)
            .await
            .map_err(|_| "network")?;
        stream.flush().await.map_err(|_| "network")?;
    }
    if !request.response_prefix.is_empty() {
        let mut received = vec![0; request.response_prefix.len()];
        stream
            .read_exact(&mut received)
            .await
            .map_err(|_| "network")?;
        if received != request.response_prefix {
            return Err("prefix_mismatch");
        }
    }
    Ok(())
}
