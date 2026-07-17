use std::{
    collections::HashSet,
    sync::OnceLock,
    time::{Duration, Instant},
};

use alphaping_protocol::v1::{HttpProbeRequest, ProbeState};
use reqwest::{
    Client, Method,
    header::{HeaderMap, HeaderName, HeaderValue},
};

use super::{ProbeOutcome, assertions, elapsed_ms, parse_url, threshold_outcome, tls};

const REDIRECT_SENSITIVE_HEADERS: &[&str] = &[
    "authorization",
    "cookie",
    "proxy-authorization",
    "x-api-key",
];

pub async fn execute(request: &HttpProbeRequest, timeout: Duration) -> ProbeOutcome {
    let client = match client(request.tls_verify.unwrap_or(true)) {
        Ok(client) => client,
        Err(_) => return ProbeOutcome::failed("invalid_config"),
    };
    let method = match Method::from_bytes(request.method.as_bytes()) {
        Ok(method) => method,
        Err(_) => return ProbeOutcome::failed("invalid_config"),
    };
    let mut target = match parse_url(&request.url) {
        Ok(target) => target,
        Err(_) => return ProbeOutcome::failed("invalid_config"),
    };
    let mut headers = match request_headers(request) {
        Ok(headers) => headers,
        Err(_) => return ProbeOutcome::failed("invalid_config"),
    };
    let sensitive = request
        .headers
        .iter()
        .filter(|header| header.sensitive)
        .map(|header| header.name.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let started = Instant::now();
    for redirect in 0..=request.max_redirects {
        let remaining = timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            return ProbeOutcome::failed("timeout");
        }
        let mut builder = client
            .request(method.clone(), target.clone())
            .headers(headers.clone())
            .timeout(remaining);
        if method != Method::GET && method != Method::HEAD && !request.body.is_empty() {
            builder = builder.body(request.body.clone());
        }
        let mut response = match builder.send().await {
            Ok(response) => response,
            Err(error) => {
                return ProbeOutcome::failed(if error.is_timeout() {
                    "timeout"
                } else {
                    "network"
                });
            }
        };
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok());
            let Some(location) = location else {
                return ProbeOutcome::failed("redirect_location");
            };
            if redirect == request.max_redirects {
                return ProbeOutcome::failed("redirect_limit");
            }
            let next = match target.join(location) {
                Ok(next) if next.scheme() == "http" || next.scheme() == "https" => next,
                _ => return ProbeOutcome::failed("redirect_target"),
            };
            if target.origin() != next.origin() {
                let remove = headers
                    .keys()
                    .filter(|name| {
                        let normalized = name.as_str().to_ascii_lowercase();
                        REDIRECT_SENSITIVE_HEADERS.contains(&normalized.as_str())
                            || sensitive.contains(&normalized)
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                for name in remove {
                    headers.remove(name);
                }
            }
            target = next;
            continue;
        }
        let latency_ms = elapsed_ms(started);
        if !request
            .expected_status
            .contains(&u32::from(response.status().as_u16()))
        {
            return ProbeOutcome {
                state: ProbeState::Down,
                latency_ms: Some(latency_ms),
                failure_code: "unexpected_status".to_owned(),
                failure_summary: format!("status:{}", response.status().as_u16()),
            };
        }
        let response_headers = response.headers().clone();
        let needs_body = request
            .assertions
            .iter()
            .any(|assertion| assertion.source == "body" || assertion.source == "jsonpath");
        let body = if needs_body {
            match read_bounded(&mut response, request.max_response_bytes as usize).await {
                Ok(body) => body,
                Err(code) => return ProbeOutcome::failed(code),
            }
        } else {
            Vec::new()
        };
        match assertions::evaluate(&request.assertions, &response_headers, &body) {
            Ok(Some(failure)) => {
                return ProbeOutcome {
                    state: failure.state,
                    latency_ms: Some(latency_ms),
                    failure_code: failure.code,
                    failure_summary: failure.summary,
                };
            }
            Ok(None) => {
                return threshold_outcome(
                    latency_ms,
                    request.degraded_after_ms,
                    request.down_after_ms,
                );
            }
            Err(()) => return ProbeOutcome::failed("invalid_config"),
        }
    }
    ProbeOutcome::failed("redirect_limit")
}

fn client(verify: bool) -> Result<&'static Client, ()> {
    static VERIFIED: OnceLock<Client> = OnceLock::new();
    static INSECURE: OnceLock<Client> = OnceLock::new();
    let slot = if verify { &VERIFIED } else { &INSECURE };
    if let Some(client) = slot.get() {
        return Ok(client);
    }
    let tls = tls::client_config(verify)?;
    let client = Client::builder()
        .use_preconfigured_tls(tls)
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| ())?;
    Ok(slot.get_or_init(|| client))
}

fn request_headers(request: &HttpProbeRequest) -> Result<HeaderMap, ()> {
    let mut headers = HeaderMap::new();
    for header in &request.headers {
        let name = HeaderName::from_bytes(header.name.as_bytes()).map_err(|_| ())?;
        let value = HeaderValue::from_str(&header.value).map_err(|_| ())?;
        headers.insert(name, value);
    }
    Ok(headers)
}

async fn read_bounded(
    response: &mut reqwest::Response,
    maximum: usize,
) -> Result<Vec<u8>, &'static str> {
    if response
        .content_length()
        .is_some_and(|length| length > maximum as u64)
    {
        return Err("response_too_large");
    }
    let mut body = Vec::with_capacity(maximum.min(8_192));
    while let Some(chunk) = response.chunk().await.map_err(|_| "network")? {
        if body.len().saturating_add(chunk.len()) > maximum {
            return Err("response_too_large");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}
