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
    use std::panic::{AssertUnwindSafe, catch_unwind};

    use alphaping_protocol::v1::ProbeAssertion;
    use reqwest::header::{HeaderMap, HeaderValue};

    use super::{AssertionFailure, evaluate};

    struct FuzzStream(u64);

    impl FuzzStream {
        fn new(seed: u64) -> Self {
            Self(seed)
        }

        fn next(&mut self) -> u64 {
            let mut value = self.0;
            value ^= value >> 12;
            value ^= value << 25;
            value ^= value >> 27;
            self.0 = value;
            value.wrapping_mul(0x2545_f491_4f6c_dd1d)
        }

        fn bounded(&mut self, upper_exclusive: usize) -> usize {
            usize::try_from(self.next() % upper_exclusive as u64).expect("bounded fuzz value")
        }

        fn ascii(&mut self, maximum_length: usize) -> String {
            let length = self.bounded(maximum_length + 1);
            (0..length)
                .map(|_| char::from(32 + self.bounded(95) as u8))
                .collect()
        }

        fn bytes(&mut self, maximum_length: usize) -> Vec<u8> {
            let length = self.bounded(maximum_length + 1);
            (0..length).map(|_| self.next() as u8).collect()
        }
    }

    fn outcome(
        result: Result<Option<AssertionFailure>, ()>,
    ) -> Result<Option<(i32, String, String)>, ()> {
        result.map(|failure| {
            failure.map(|failure| (failure.state as i32, failure.code, failure.summary))
        })
    }

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

    #[test]
    fn bounded_adversarial_assertions_never_panic_and_are_deterministic() {
        const SOURCES: [&str; 4] = ["header", "body", "jsonpath", "unsupported"];
        const OPERATORS: [&str; 8] = [
            "exists",
            "equals",
            "contains",
            "matches",
            "type",
            "greater_than",
            "less_than",
            "unsupported",
        ];
        const SEVERITIES: [&str; 3] = ["degraded", "down", "unsupported"];

        let mut headers = HeaderMap::new();
        headers.insert("x-ready", HeaderValue::from_static("yes"));
        let mut fuzz = FuzzStream::new(0x0934_e7b1_5a82_dc6f);

        for case in 0..1_024_usize {
            let source = SOURCES[fuzz.bounded(SOURCES.len())].to_owned();
            let operator = OPERATORS[fuzz.bounded(OPERATORS.len())].to_owned();
            let selector = match source.as_str() {
                "header" if case.is_multiple_of(2) => "x-ready".to_owned(),
                "jsonpath" if case.is_multiple_of(2) => format!("$.{}", fuzz.ascii(510)),
                _ => fuzz.ascii(512),
            };
            let expected_json = match case % 5 {
                0 => serde_json::to_vec(&fuzz.ascii(256)).expect("JSON string"),
                1 => serde_json::to_vec(&(fuzz.next() as i64)).expect("JSON number"),
                2 => b"true".to_vec(),
                3 => b"null".to_vec(),
                _ => fuzz.bytes(2_048),
            };
            let severity = SEVERITIES[fuzz.bounded(SEVERITIES.len())].to_owned();
            let body = match case % 3 {
                0 => serde_json::to_vec(&serde_json::json!({
                    "value": fuzz.next() as i64,
                    "text": fuzz.ascii(128),
                }))
                .expect("JSON body"),
                1 => serde_json::to_vec(&fuzz.ascii(4_096)).expect("JSON string body"),
                _ => fuzz.bytes(4_096),
            };
            let assertion = ProbeAssertion {
                source,
                operator,
                selector,
                expected_json,
                severity,
            };

            let result = catch_unwind(AssertUnwindSafe(|| {
                let first = outcome(evaluate(std::slice::from_ref(&assertion), &headers, &body));
                let second = outcome(evaluate(&[assertion], &headers, &body));
                assert_eq!(first, second, "non-deterministic assertion case {case}");
            }));
            assert!(
                result.is_ok(),
                "assertion evaluator panicked for case {case}"
            );
        }
    }
}
