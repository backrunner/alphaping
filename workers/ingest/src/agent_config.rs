use std::collections::{BTreeMap, BTreeSet};

use alphaping_crypto::open_with_nonce;
use alphaping_protocol::{
    MAX_ENVELOPE_BYTES, encode_message,
    v1::{
        AgentConfigSnapshot, HttpProbeRequest, IcmpProbeRequest, ProbeAssertion, ProbeHeader,
        ProbeKind, ProbeTask, TcpProbeRequest, probe_task,
    },
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::Value;
use worker::{D1Database, Env, wasm_bindgen::JsValue};

const MAX_TASKS: usize = 32;
const MAX_CONFIG_BYTES: usize = MAX_ENVELOPE_BYTES - 8 * 1024;
const SECRET_AAD_PREFIX: &str = "alphaping/check-secret/v1";

#[derive(Debug, Deserialize)]
struct ProbeConfigRow {
    id: String,
    telemetry_pk: f64,
    service_pk: f64,
    workspace_pk: f64,
    workspace_id: String,
    assignment_revision: f64,
    kind: String,
    interval_seconds: f64,
    phase_seconds: f64,
    timeout_ms: f64,
    request_json: String,
    secret_refs_json: String,
}

#[derive(Debug, Deserialize)]
struct SecretRow {
    id: String,
    wrapped_value: Vec<u8>,
    nonce: Vec<u8>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretReferences {
    #[serde(default)]
    headers: BTreeMap<String, String>,
    body: Option<String>,
    tcp_payload: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpConfig {
    url: String,
    method: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    body: Option<String>,
    expected_status: Vec<u32>,
    degraded_after_ms: Option<u32>,
    down_after_ms: Option<u32>,
    max_redirects: u32,
    max_response_bytes: u32,
    #[serde(default)]
    assertions: Vec<AssertionConfig>,
}

#[derive(Debug, Deserialize)]
struct AssertionConfig {
    source: String,
    operator: String,
    selector: Option<String>,
    expected: Value,
    severity: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TcpConfig {
    hostname: String,
    port: u32,
    secure_transport: String,
    payload_base64: Option<String>,
    response_prefix_base64: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IcmpConfig {
    hostname: String,
    degraded_after_ms: Option<u32>,
    down_after_ms: Option<u32>,
}

pub async fn build_config_snapshot(
    db: &D1Database,
    env: &Env,
    agent_id: &str,
    desired_revision: u64,
) -> worker::Result<AgentConfigSnapshot> {
    let rows = db
        .prepare(
            "SELECT c.id, c.telemetry_pk, s.telemetry_pk AS service_pk,
                    w.telemetry_pk AS workspace_pk, c.workspace_id,
                    c.assignment_revision, c.kind, c.interval_seconds, c.phase_seconds,
                    c.timeout_ms, c.request_json, c.secret_refs_json
             FROM check_configs c
             JOIN services s ON s.id = c.service_id AND s.deleted_at IS NULL
             JOIN workspaces w ON w.id = c.workspace_id AND w.deleted_at IS NULL
             WHERE c.executor_kind = 'agent' AND c.executor_agent_id = ? AND c.enabled = 1
             ORDER BY c.id LIMIT ?",
        )
        .bind(&[
            JsValue::from_str(agent_id),
            JsValue::from_f64((MAX_TASKS + 1) as f64),
        ])?
        .all()
        .await?
        .results::<ProbeConfigRow>()?;
    if rows.len() > MAX_TASKS {
        return Err(worker::Error::RustError(
            "agent_probe_task_limit".to_owned(),
        ));
    }
    let wrapping_key = secret_key(env)?;
    let mut tasks = Vec::with_capacity(rows.len());
    for row in rows {
        if row.assignment_revision as u64 > desired_revision {
            return Err(worker::Error::RustError(
                "future_probe_assignment".to_owned(),
            ));
        }
        let secrets = resolve_secrets(db, &row, &wrapping_key).await?;
        tasks.push(compile_task(row, secrets)?);
    }
    let mut snapshot = AgentConfigSnapshot {
        revision: desired_revision,
        probe_tasks: tasks,
        created_at_ms: worker::js_sys::Date::now() as i64,
        digest: Vec::new(),
    };
    snapshot.digest = blake3::hash(&encode_message(&snapshot)).as_bytes().to_vec();
    if encode_message(&snapshot).len() > MAX_CONFIG_BYTES {
        return Err(worker::Error::RustError(
            "agent_config_too_large".to_owned(),
        ));
    }
    Ok(snapshot)
}

fn secret_key(env: &Env) -> worker::Result<[u8; 32]> {
    hex::decode(env.secret("CHECK_SECRET_WRAPPING_KEY")?.to_string())
        .map_err(|_| worker::Error::RustError("invalid_check_secret_key".to_owned()))?
        .try_into()
        .map_err(|_| worker::Error::RustError("invalid_check_secret_key".to_owned()))
}

async fn resolve_secrets(
    db: &D1Database,
    row: &ProbeConfigRow,
    wrapping_key: &[u8; 32],
) -> worker::Result<BTreeMap<String, String>> {
    let references: SecretReferences = serde_json::from_str(&row.secret_refs_json)
        .map_err(|_| worker::Error::RustError("invalid_check_secret_refs".to_owned()))?;
    let ids = references
        .headers
        .values()
        .chain(references.body.iter())
        .chain(references.tcp_payload.iter())
        .cloned()
        .collect::<BTreeSet<_>>();
    if ids.is_empty() {
        return Ok(BTreeMap::new());
    }
    let placeholders = std::iter::repeat_n("?", ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let query = format!(
        "SELECT id, wrapped_value, nonce FROM check_secrets
         WHERE workspace_id = ? AND id IN ({placeholders})"
    );
    let mut bindings = Vec::with_capacity(ids.len() + 1);
    bindings.push(JsValue::from_str(&row.workspace_id));
    bindings.extend(ids.iter().map(|id| JsValue::from_str(id)));
    let stored = db
        .prepare(query)
        .bind(&bindings)?
        .all()
        .await?
        .results::<SecretRow>()?;
    if stored.len() != ids.len() {
        return Err(worker::Error::RustError("missing_check_secret".to_owned()));
    }
    let mut plaintext = BTreeMap::new();
    for secret in stored {
        let nonce: [u8; 12] = secret
            .nonce
            .try_into()
            .map_err(|_| worker::Error::RustError("invalid_check_secret".to_owned()))?;
        let aad = format!("{SECRET_AAD_PREFIX}:{}:{}", row.workspace_id, secret.id);
        let value = open_with_nonce(wrapping_key, nonce, aad.as_bytes(), &secret.wrapped_value)
            .map_err(|_| worker::Error::RustError("invalid_check_secret".to_owned()))?;
        let value = String::from_utf8(value)
            .map_err(|_| worker::Error::RustError("invalid_check_secret".to_owned()))?;
        plaintext.insert(secret.id, value);
    }
    let mut resolved = BTreeMap::new();
    for (name, id) in references.headers {
        resolved.insert(
            format!("header:{name}"),
            plaintext
                .get(&id)
                .ok_or_else(|| worker::Error::RustError("missing_check_secret".to_owned()))?
                .clone(),
        );
    }
    if let Some(id) = references.body {
        resolved.insert(
            "body".to_owned(),
            plaintext
                .get(&id)
                .ok_or_else(|| worker::Error::RustError("missing_check_secret".to_owned()))?
                .clone(),
        );
    }
    if let Some(id) = references.tcp_payload {
        resolved.insert(
            "tcpPayload".to_owned(),
            plaintext
                .get(&id)
                .ok_or_else(|| worker::Error::RustError("missing_check_secret".to_owned()))?
                .clone(),
        );
    }
    Ok(resolved)
}

fn compile_task(
    row: ProbeConfigRow,
    secrets: BTreeMap<String, String>,
) -> worker::Result<ProbeTask> {
    let request = match row.kind.as_str() {
        "http" => probe_task::Request::Http(compile_http(&row.request_json, secrets)?),
        "tcp" => probe_task::Request::Tcp(compile_tcp(&row.request_json, secrets)?),
        "icmp" => probe_task::Request::Icmp(compile_icmp(&row.request_json)?),
        _ => return Err(worker::Error::RustError("invalid_probe_kind".to_owned())),
    };
    Ok(ProbeTask {
        check_id: row.id,
        check_pk: row.telemetry_pk as u64,
        service_pk: row.service_pk as u64,
        workspace_pk: row.workspace_pk as u64,
        config_revision: row.assignment_revision as u64,
        kind: match row.kind.as_str() {
            "http" => ProbeKind::Http as i32,
            "tcp" => ProbeKind::Tcp as i32,
            "icmp" => ProbeKind::Icmp as i32,
            _ => ProbeKind::Unspecified as i32,
        },
        interval_seconds: row.interval_seconds as u32,
        phase_seconds: row.phase_seconds as u32,
        timeout_ms: row.timeout_ms as u32,
        request: Some(request),
    })
}

fn compile_http(json: &str, secrets: BTreeMap<String, String>) -> worker::Result<HttpProbeRequest> {
    let config: HttpConfig = serde_json::from_str(json)
        .map_err(|_| worker::Error::RustError("invalid_http_probe".to_owned()))?;
    let mut headers = config
        .headers
        .into_iter()
        .map(|(name, value)| ProbeHeader {
            name,
            value,
            sensitive: false,
        })
        .collect::<Vec<_>>();
    headers.extend(
        secrets
            .iter()
            .filter_map(|(name, value)| name.strip_prefix("header:").map(|name| (name, value)))
            .map(|(name, value)| ProbeHeader {
                name: name.to_owned(),
                value: value.clone(),
                sensitive: true,
            }),
    );
    let assertions = config
        .assertions
        .into_iter()
        .map(|assertion| {
            Ok(ProbeAssertion {
                source: assertion.source,
                operator: assertion.operator,
                selector: assertion.selector.unwrap_or_default(),
                expected_json: serde_json::to_vec(&assertion.expected)
                    .map_err(|_| worker::Error::RustError("invalid_probe_assertion".to_owned()))?,
                severity: assertion.severity,
            })
        })
        .collect::<worker::Result<Vec<_>>>()?;
    Ok(HttpProbeRequest {
        url: config.url,
        method: config.method,
        headers,
        body: secrets
            .get("body")
            .cloned()
            .or(config.body)
            .unwrap_or_default()
            .into_bytes(),
        expected_status: config.expected_status,
        degraded_after_ms: config.degraded_after_ms.unwrap_or(0),
        down_after_ms: config.down_after_ms.unwrap_or(0),
        max_redirects: config.max_redirects,
        max_response_bytes: config.max_response_bytes,
        assertions,
    })
}

fn compile_tcp(json: &str, secrets: BTreeMap<String, String>) -> worker::Result<TcpProbeRequest> {
    let config: TcpConfig = serde_json::from_str(json)
        .map_err(|_| worker::Error::RustError("invalid_tcp_probe".to_owned()))?;
    let decode = |value: Option<String>| -> worker::Result<Vec<u8>> {
        value.map_or_else(
            || Ok(Vec::new()),
            |value| {
                STANDARD
                    .decode(value)
                    .map_err(|_| worker::Error::RustError("invalid_tcp_payload".to_owned()))
            },
        )
    };
    Ok(TcpProbeRequest {
        hostname: config.hostname,
        port: config.port,
        use_tls: config.secure_transport == "on",
        payload: secrets
            .get("tcpPayload")
            .map(|value| value.as_bytes().to_vec())
            .unwrap_or(decode(config.payload_base64)?),
        response_prefix: decode(config.response_prefix_base64)?,
    })
}

fn compile_icmp(json: &str) -> worker::Result<IcmpProbeRequest> {
    let config: IcmpConfig = serde_json::from_str(json)
        .map_err(|_| worker::Error::RustError("invalid_icmp_probe".to_owned()))?;
    Ok(IcmpProbeRequest {
        hostname: config.hostname,
        degraded_after_ms: config.degraded_after_ms.unwrap_or(0),
        down_after_ms: config.down_after_ms.unwrap_or(0),
    })
}
