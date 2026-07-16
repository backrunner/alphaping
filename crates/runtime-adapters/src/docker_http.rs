use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    time::Duration,
};

use serde::Deserialize;

use crate::docker::DockerError;

const RESPONSE_LIMIT: usize = 2 * 1024 * 1024;

#[derive(Clone, Debug)]
pub(crate) enum DockerTransport {
    #[cfg(unix)]
    Unix(PathBuf),
    Tcp(SocketAddr),
}

pub(crate) fn parse_host(value: &str) -> Option<DockerTransport> {
    #[cfg(unix)]
    if let Some(path) = value.strip_prefix("unix://") {
        let path = PathBuf::from(path);
        if path.is_absolute() {
            return Some(DockerTransport::Unix(path));
        }
    }
    let target = value.strip_prefix("tcp://")?;
    let address = target.parse::<SocketAddr>().ok()?;
    address
        .ip()
        .is_loopback()
        .then_some(DockerTransport::Tcp(address))
}

pub(crate) fn transport_key(transport: &DockerTransport) -> String {
    match transport {
        #[cfg(unix)]
        DockerTransport::Unix(path) => format!("unix:{}", path.display()),
        DockerTransport::Tcp(address) => format!("tcp:{address}"),
    }
}

pub(crate) fn request_json<T: for<'de> Deserialize<'de>>(
    transport: &DockerTransport,
    path: &str,
) -> Result<T, DockerError> {
    let body = request(transport, path)?;
    serde_json::from_slice(&body).map_err(|_| DockerError::Incompatible)
}

fn request(transport: &DockerTransport, path: &str) -> Result<Vec<u8>, DockerError> {
    if !path.starts_with('/') || path.bytes().any(|byte| byte == b'\r' || byte == b'\n') {
        return Err(DockerError::Incompatible);
    }
    let mut stream = DockerStream::connect(transport)?;
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: localhost\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).map_err(classify_io)?;
    let mut response = Vec::new();
    stream
        .take((RESPONSE_LIMIT + 1) as u64)
        .read_to_end(&mut response)
        .map_err(classify_io)?;
    if response.len() > RESPONSE_LIMIT {
        return Err(DockerError::Incompatible);
    }
    parse_http_response(&response)
}

enum DockerStream {
    #[cfg(unix)]
    Unix(std::os::unix::net::UnixStream),
    Tcp(TcpStream),
}

impl DockerStream {
    fn connect(transport: &DockerTransport) -> Result<Self, DockerError> {
        let timeout = Some(Duration::from_secs(2));
        match transport {
            #[cfg(unix)]
            DockerTransport::Unix(path) => {
                let stream = std::os::unix::net::UnixStream::connect(path).map_err(classify_io)?;
                stream
                    .set_read_timeout(timeout)
                    .map_err(|_| DockerError::Io)?;
                stream
                    .set_write_timeout(timeout)
                    .map_err(|_| DockerError::Io)?;
                Ok(Self::Unix(stream))
            }
            DockerTransport::Tcp(address) => {
                let stream = TcpStream::connect_timeout(address, Duration::from_secs(2))
                    .map_err(classify_io)?;
                stream
                    .set_read_timeout(timeout)
                    .map_err(|_| DockerError::Io)?;
                stream
                    .set_write_timeout(timeout)
                    .map_err(|_| DockerError::Io)?;
                Ok(Self::Tcp(stream))
            }
        }
    }
}

impl Read for DockerStream {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        match self {
            #[cfg(unix)]
            Self::Unix(stream) => stream.read(buffer),
            Self::Tcp(stream) => stream.read(buffer),
        }
    }
}

impl Write for DockerStream {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        match self {
            #[cfg(unix)]
            Self::Unix(stream) => stream.write(buffer),
            Self::Tcp(stream) => stream.write(buffer),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            #[cfg(unix)]
            Self::Unix(stream) => stream.flush(),
            Self::Tcp(stream) => stream.flush(),
        }
    }
}

fn classify_io(error: std::io::Error) -> DockerError {
    match error.kind() {
        std::io::ErrorKind::PermissionDenied => DockerError::PermissionDenied,
        std::io::ErrorKind::NotFound
        | std::io::ErrorKind::ConnectionRefused
        | std::io::ErrorKind::ConnectionReset
        | std::io::ErrorKind::TimedOut => DockerError::Unavailable,
        _ => DockerError::Io,
    }
}

fn parse_http_response(response: &[u8]) -> Result<Vec<u8>, DockerError> {
    let separator = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or(DockerError::Incompatible)?;
    let headers = &response[..separator];
    let body = &response[separator + 4..];
    let first_line_end = headers
        .windows(2)
        .position(|window| window == b"\r\n")
        .unwrap_or(headers.len());
    let status = std::str::from_utf8(&headers[..first_line_end])
        .ok()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or(DockerError::Incompatible)?;
    if status == 401 || status == 403 {
        return Err(DockerError::PermissionDenied);
    }
    if !(200..300).contains(&status) {
        return Err(DockerError::Unavailable);
    }
    let chunked = headers
        .split(|byte| *byte == b'\n')
        .any(|line| line.eq_ignore_ascii_case(b"transfer-encoding: chunked\r"));
    if chunked {
        decode_chunked(body)
    } else {
        Ok(body.to_vec())
    }
}

fn decode_chunked(mut input: &[u8]) -> Result<Vec<u8>, DockerError> {
    let mut output = Vec::new();
    loop {
        let line_end = input
            .windows(2)
            .position(|window| window == b"\r\n")
            .ok_or(DockerError::Incompatible)?;
        let size_text =
            std::str::from_utf8(&input[..line_end]).map_err(|_| DockerError::Incompatible)?;
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or_default(), 16)
            .map_err(|_| DockerError::Incompatible)?;
        input = &input[line_end + 2..];
        if size == 0 {
            return Ok(output);
        }
        if input.len() < size + 2 || output.len().saturating_add(size) > RESPONSE_LIMIT {
            return Err(DockerError::Incompatible);
        }
        output.extend_from_slice(&input[..size]);
        if &input[size..size + 2] != b"\r\n" {
            return Err(DockerError::Incompatible);
        }
        input = &input[size + 2..];
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_chunked, parse_http_response};

    #[test]
    fn parses_content_length_and_chunked_responses() {
        assert_eq!(
            parse_http_response(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}")
                .expect("content response"),
            b"{}"
        );
        assert_eq!(
            decode_chunked(b"2\r\n{}\r\n0\r\n\r\n").expect("chunked response"),
            b"{}"
        );
    }
}
