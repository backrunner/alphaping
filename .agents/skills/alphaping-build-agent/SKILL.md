---
name: alphaping-build-agent
description: Build and review AlphaPing's low-resource Rust Agent, protobuf transport, post-quantum TLS configuration, AEAD envelopes, local spool, ICMP/TCP/HTTP probes, container runtime adapters, service installers, and signed automatic updater. Use for changes under crates/agent, protocol, crypto, runtime adapters, installers, or Agent release tooling.
---

# Build AlphaPing Agent

Implement a conservative system service that reports metrics securely, survives network failure, and cannot become a remote shell.

## Read First

- [Requirements](../../01-requirements.md)
- [Module design](../../03-module-design.md)
- [Data model](../../04-data-model.md)
- [Protocol security](../../05-agent-protocol-security.md)
- [Cloudflare cost](../../06-cloudflare-storage-cost.md)
- [Engineering standards](../../08-engineering-standards.md)
- [Research](../../10-research.md)
- [Telemetry storage and retry](../../11-telemetry-storage-and-retry.md)

Re-check locked rustls/workers-rs/prost/crypto APIs and platform support before relying on version-specific behavior.

## Workflow

1. Inspect the Cargo workspace, locked crates, protocol source, supported targets, service files, and current user changes.
2. Keep canonical messages in `.proto`; generate prost code deterministically and preserve backward compatibility.
3. Use TLS 1.3 `X25519MLKEM768` by default with explicit, visible downgrade configuration only.
4. Use the documented HKDF directional keys, AES-256-GCM nonce prefix plus persistent 64-bit sequence, replay semantics, and key epochs. Do not design new crypto.
5. Separate sampler, probe scheduler, uploader, spool, config, runtime adapters, and updater with bounded channels and cancellation.
6. Use last-known-good configuration and atomically apply validated revisions.
7. Persist samples and deliveries in SQLite WAL until authenticated D1 transaction acknowledgement. Retry transient delivery failures without an attempt limit and cap equal-jitter backoff at 300 seconds.
8. Implement only allowlisted commands and idempotently remember command results.
9. Verify update metadata, length, hash, signature, version, platform, health, and rollback independently of GitHub transport.
10. Measure CPU, RSS, binary size, report bytes, reconnect behavior, and power-impacting wakeups.

## Resource Targets

- Idle RSS target below 30 MiB.
- Stable average CPU target below 0.5% of one core.
- Default local sample every 10 seconds and report every 60 seconds with jitter.
- Maintain the Live Hub WebSocket, but send 10-second live snapshots only while an authenticated viewer demand TTL is active.
- Tokio current-thread runtime by default; add threads only with a measured need.
- Every queue, buffer, retry, concurrency pool, and on-disk spool must be bounded.
- Every network operation must have timeout, backoff, jitter, and cancellation.
- Use a 512 MiB default SQLite cap plus a 256 MiB/5% free-disk reserve. Compact unattempted low-priority samples before eviction.

## Protocol Rules

- Keep envelope headers as authenticated AAD.
- Compress before encrypting and validate decompression limits.
- Keep each durable HTTP envelope within 64 KiB; split offline backlog.
- Derive/use a separate short-lived live session key. Live frames never delete spool data or reset durable delivery backoff.
- Persist sequence before use so crashes cannot reuse a nonce.
- Keep delivery payload/report ID stable across retries while allocating a fresh persisted transport sequence for each attempt.
- Stop and rotate/re-enroll if persistent sequence state is lost or rolls back.
- Never log enrollment tokens, root secrets, plaintext reports, control payloads, or private identity keys.
- Keep the external claim limited to PQ hybrid key agreement, not complete PQ authentication.

## Probe Rules

- Agent executors may implement ICMP, TCP, and HTTP.
- Apply strict timeout, payload, redirect, response body, regex, and assertion bounds.
- Treat private-network probes as privileged workspace behavior.
- Record structured failure codes instead of large raw response bodies.
- Include executor Agent ID and config revision in every result.

## Container Rules

- Docker: use Engine API version negotiation and read-only endpoints.
- Colima: discover profile/runtime; do not assume every profile is Docker.
- Apple container: require supported macOS/Apple silicon and version-detect the evolving API/CLI.
- Return separate states for absent, stopped, permission denied, incompatible, and error.
- Never collect environment variables, secrets, logs, or mounted file contents by default.

## Installer and Updater Rules

- Support systemd, launchd, and Windows Service in V1; add OpenRC as a defined follow-up.
- Keep binary, config, identity, spool, and log locations separate with least permissions.
- Verify signed release metadata before installation or replacement.
- Use atomic replacement/version pointers, fsync, health check, and automatic rollback.
- Let forced update bypass the timer only; never bypass trust, target, or version policy.
- Never execute a server-provided arbitrary command or download URL.

## Verification

- Run fmt, clippy with warnings denied, unit/integration tests, and protocol golden vectors.
- Fuzz envelope/protobuf/config parsers and assertion boundaries.
- Test 24h+ network loss, restart, 300-second backoff cap, network-change wakeup, ack loss, spool compaction/full, clock skew, replay, key rotation, config failure, and duplicate commands.
- Test signed update success, corrupt artifact, expired metadata, rollback attack, failed health check, and rollback.
- Test supported runtime adapters in real environments or documented fixtures; do not mark untested detection as complete.
