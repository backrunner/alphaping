---
title: Service checks
description: Check HTTP, TCP and ICMP from the right location, using confirmation windows to distinguish brief failures from persistent outages.
order: 2
---

## Choose a check type

A service can contain multiple checks. Its overall state accounts for critical checks, confirmation windows and maintenance state.

| Check        | Cloudflare executor | Agent executor | Common uses                           |
| ------------ | ------------------- | -------------- | ------------------------------------- |
| HTTP / HTTPS | Supported           | Supported      | Websites, APIs and health endpoints   |
| TCP Connect  | Supported           | Supported      | Databases, mail and other ports       |
| ICMP Ping    | Not supported       | Supported      | Host reachability and network latency |

Cloudflare does not provide native ICMP or guarantee a fixed probe location. To observe a service from a specific machine or private network, choose an Agent with the required network access.

## Configure an HTTP check

Create a service, add an HTTP check, then set the request method, URL, timeout and expected status code. Expand advanced settings as needed:

- Custom request headers and an optional body.
- Redirect policy and TLS verification.
- Response header assertions for presence, equality, containment or regular expressions.
- JSONPath selection with type, equality or numeric range assertions.
- Text response assertions for containment or regular expressions.

Sensitive headers are stored through secret references and are not returned in plaintext. Read only what the check needs; response bodies have size limits.

## Set intervals and confirmation windows

The default minimum interval is 5 seconds for Agent execution and 60 seconds for central Cloudflare execution.

Configure consecutive failure and recovery counts to avoid turning a brief network issue into a confirmed outage. A single failure is immediately confirmed only when the failure confirmation count is explicitly set to 1.

## Understand state changes

Check results can be healthy, degraded, down or unknown. Service state transitions create immutable events and can be associated with incidents. Resources in maintenance do not send ordinary failure notifications.

A separate Worker delivers notifications asynchronously. Channels include Resend, SMTP HTTPS relay, Discord, Telegram, Slack and Bark. SMTP is accessed through an HTTPS relay controlled by the deployer.

## Publish check results

Use [public status pages](/docs/guides/status-pages) to share service state and historical time buckets. Internal request headers, bodies and detailed errors should not appear in guest responses.
