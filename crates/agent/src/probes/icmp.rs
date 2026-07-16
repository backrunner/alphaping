use std::time::{Duration, Instant};

use alphaping_protocol::v1::IcmpProbeRequest;
use surge_ping::ping;
use tokio::net::lookup_host;

use super::{ProbeOutcome, elapsed_ms, threshold_outcome};

pub async fn execute(request: &IcmpProbeRequest, timeout: Duration) -> ProbeOutcome {
    let started = Instant::now();
    let address = match tokio::time::timeout(timeout, lookup_host((&*request.hostname, 0))).await {
        Ok(Ok(mut addresses)) => match addresses.next() {
            Some(address) => address.ip(),
            None => return ProbeOutcome::failed("dns"),
        },
        Ok(Err(_)) => return ProbeOutcome::failed("dns"),
        Err(_) => return ProbeOutcome::failed("timeout"),
    };
    match tokio::time::timeout(
        timeout.saturating_sub(started.elapsed()),
        ping(address, &[0; 32]),
    )
    .await
    {
        Ok(Ok((_packet, latency))) => threshold_outcome(
            u32::try_from(latency.as_millis()).unwrap_or(u32::MAX),
            request.degraded_after_ms,
            request.down_after_ms,
        ),
        Ok(Err(_)) => ProbeOutcome::failed("icmp"),
        Err(_) => {
            let mut outcome = ProbeOutcome::failed("timeout");
            outcome.latency_ms = Some(elapsed_ms(started));
            outcome
        }
    }
}
