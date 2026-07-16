use alphaping_protocol::v1::{ProbeAssertion, ProbeState};
use jsonpath_rust::JsonPath;
use regex::Regex;
use reqwest::header::HeaderMap;
use serde_json::Value;

pub struct AssertionFailure {
    pub state: ProbeState,
    pub code: String,
    pub summary: String,
}

pub fn evaluate(
    assertions: &[ProbeAssertion],
    headers: &HeaderMap,
    body: &[u8],
) -> Result<Option<AssertionFailure>, ()> {
    let text = std::str::from_utf8(body).unwrap_or_default();
    let mut json = None;
    let mut failure = None;
    for (index, assertion) in assertions.iter().enumerate() {
        let expected: Value = serde_json::from_slice(&assertion.expected_json).map_err(|_| ())?;
        let values = match assertion.source.as_str() {
            "header" => headers
                .get(&assertion.selector)
                .and_then(|value| value.to_str().ok())
                .map(|value| vec![Value::String(value.to_owned())])
                .unwrap_or_default(),
            "body" => vec![Value::String(text.to_owned())],
            "jsonpath" => {
                let document = match json.as_ref() {
                    Some(document) => document,
                    None => {
                        json = Some(serde_json::from_slice::<Value>(body).map_err(|_| ())?);
                        json.as_ref().ok_or(())?
                    }
                };
                document
                    .query(&assertion.selector)
                    .map_err(|_| ())?
                    .into_iter()
                    .cloned()
                    .collect()
            }
            _ => return Err(()),
        };
        if assertion_matches(&values, &assertion.operator, &expected)? {
            continue;
        }
        let state = match assertion.severity.as_str() {
            "degraded" => ProbeState::Degraded,
            "down" => ProbeState::Down,
            _ => return Err(()),
        };
        let candidate = AssertionFailure {
            state,
            code: format!("assertion_{}_failed", assertion.source),
            summary: format!("assertion:{index}"),
        };
        if failure
            .as_ref()
            .is_none_or(|current: &AssertionFailure| state as i32 > current.state as i32)
        {
            failure = Some(candidate);
        }
    }
    Ok(failure)
}

fn assertion_matches(values: &[Value], operator: &str, expected: &Value) -> Result<bool, ()> {
    if operator == "exists" {
        return Ok(!values.is_empty());
    }
    Ok(values.iter().any(|value| match operator {
        "equals" => value == expected || string_value(value) == string_value(expected),
        "contains" => match (value, expected) {
            (Value::String(value), Value::String(expected)) => value.contains(expected),
            (Value::Array(values), expected) => values.contains(expected),
            _ => false,
        },
        "matches" => match (string_value(value), expected.as_str()) {
            (Some(value), Some(pattern)) => {
                Regex::new(pattern).is_ok_and(|regex| regex.is_match(value))
            }
            _ => false,
        },
        "type" => expected
            .as_str()
            .is_some_and(|expected| value_type(value) == expected),
        "greater_than" => numeric(value)
            .zip(numeric(expected))
            .is_some_and(|(left, right)| left > right),
        "less_than" => numeric(value)
            .zip(numeric(expected))
            .is_some_and(|(left, right)| left < right),
        _ => false,
    }))
}

fn string_value(value: &Value) -> Option<&str> {
    value.as_str()
}

fn numeric(value: &Value) -> Option<f64> {
    value.as_f64()
}

fn value_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

#[cfg(test)]
mod tests {
    use alphaping_protocol::v1::ProbeAssertion;
    use reqwest::header::{HeaderMap, HeaderValue};

    use super::evaluate;

    #[test]
    fn evaluates_header_and_jsonpath_assertions() {
        let mut headers = HeaderMap::new();
        headers.insert("x-ready", HeaderValue::from_static("yes"));
        let assertions = vec![
            ProbeAssertion {
                source: "header".to_owned(),
                operator: "equals".to_owned(),
                selector: "x-ready".to_owned(),
                expected_json: br#""yes""#.to_vec(),
                severity: "down".to_owned(),
            },
            ProbeAssertion {
                source: "jsonpath".to_owned(),
                operator: "equals".to_owned(),
                selector: "$.data.ready".to_owned(),
                expected_json: b"true".to_vec(),
                severity: "down".to_owned(),
            },
        ];
        assert!(
            evaluate(&assertions, &headers, br#"{"data":{"ready":true}}"#)
                .expect("valid assertions")
                .is_none()
        );
    }
}
