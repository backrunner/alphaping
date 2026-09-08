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
    let mut method = match Method::from_bytes(request.method.as_bytes()) {
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
    let mut send_body = method != Method::GET && method != Method::HEAD && !request.body.is_empty();
    for redirect in 0..=request.max_redirects {
        let remaining = timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            return ProbeOutcome::failed("timeout");
        }
        let mut builder = client
            .request(method.clone(), target.clone())
            .headers(headers.clone())
            .timeout(remaining);
        if send_body {
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
        if matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
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
                Ok(next)
                    if (next.scheme() == "http" || next.scheme() == "https")
                        && next.username().is_empty()
                        && next.password().is_none() =>
                {
                    next
                }
                _ => return ProbeOutcome::failed("redirect_target"),
            };
            if target.scheme() == "https" && next.scheme() != "https" {
                return ProbeOutcome::failed("redirect_downgrade");
            }
            if (matches!(response.status().as_u16(), 301 | 302) && method == Method::POST)
                || (response.status().as_u16() == 303 && method != Method::HEAD)
            {
                method = Method::GET;
                send_body = false;
                for name in [
                    "content-type",
                    "content-length",
                    "content-encoding",
                    "content-language",
                    "content-location",
                ] {
                    headers.remove(name);
                }
            }
            if send_body && target.origin() != next.origin() {
                return ProbeOutcome::failed("redirect_body_blocked");
            }
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
        let latency_ms = elapsed_ms(started);
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

#[cfg(test)]
mod tests {
    use super::*;
    use alphaping_protocol::v1::ProbeHeader;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        task::JoinHandle,
    };

    async fn server(responses: Vec<String>) -> (String, JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let mut requests = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                loop {
                    let mut buffer = [0; 1024];
                    let count = stream.read(&mut buffer).await.unwrap();
                    assert!(count > 0, "request ended before body");
                    bytes.extend_from_slice(&buffer[..count]);
                    if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]);
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + length {
                            break;
                        }
                    }
                    assert!(bytes.len() < 16_384);
                }
                requests.push(String::from_utf8(bytes).unwrap());
                stream.write_all(response.as_bytes()).await.unwrap();
            }
            requests
        });
        (origin, task)
    }

    fn response(status: u16, location: &str) -> String {
        format!(
            "HTTP/1.1 {status} Test\r\nContent-Length: 0\r\nConnection: close\r\nLocation: {location}\r\n\r\n"
        )
    }

    fn request(url: String) -> HttpProbeRequest {
        HttpProbeRequest {
            url,
            method: "POST".to_owned(),
            body: b"private payload".to_vec(),
            max_redirects: 3,
            max_response_bytes: 1024,
            expected_status: vec![200],
            headers: vec![ProbeHeader {
                name: "content-type".to_owned(),
                value: "text/plain".to_owned(),
                sensitive: false,
            }],
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn post_redirects_drop_the_body_and_content_headers() {
        for status in [301, 302, 303] {
            let (origin, task) = server(vec![response(status, "/ready"), response(200, "")]).await;
            let outcome = execute(&request(origin), Duration::from_secs(3)).await;
            assert_eq!(outcome.state, ProbeState::Healthy, "{outcome:?}");
            let requests = task.await.unwrap();
            assert!(requests[0].ends_with("private payload"));
            assert!(requests[1].starts_with("GET /ready HTTP/1.1\r\n"));
            assert!(!requests[1].to_ascii_lowercase().contains("content-type:"));
            assert!(!requests[1].contains("private payload"));
        }
    }

    #[tokio::test]
    async fn cross_origin_redirects_do_not_replay_private_bodies() {
        let destination = TcpListener::bind("127.0.0.1:0").await.unwrap();
        for status in [307, 308] {
            let (origin, task) = server(vec![response(
                status,
                &format!("http://{}/collect", destination.local_addr().unwrap()),
            )])
            .await;
            let outcome = execute(&request(origin), Duration::from_secs(3)).await;
            assert_eq!(outcome.failure_code, "redirect_body_blocked");
            assert_eq!(task.await.unwrap().len(), 1);
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(50), destination.accept())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn explicitly_expected_not_modified_is_successful() {
        let (origin, task) = server(vec![response(304, "")]).await;
        let mut request = request(origin);
        request.method = "GET".to_owned();
        request.expected_status = vec![304];
        let outcome = execute(&request, Duration::from_secs(3)).await;
        assert_eq!(outcome.state, ProbeState::Healthy, "{outcome:?}");
        task.await.unwrap();
    }
}
