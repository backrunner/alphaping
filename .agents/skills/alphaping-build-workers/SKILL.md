---
name: alphaping-build-workers
description: Build and review AlphaPing Cloudflare Workers, D1 telemetry blocks, Hibernation WebSocket live hubs, service-check scheduling, retention jobs, bindings, Wrangler templates, and multi-worker deployment orchestration. Use for changes under workers, Cloudflare configs, deployment scripts, or hot-path storage and cost logic.
---

# Build AlphaPing Workers

Implement independently deployable, cost-aware Workers with explicit data ownership and idempotent background processing.

## Read First

- [Architecture](../../02-architecture.md)
- [Module design](../../03-module-design.md)
- [Data model](../../04-data-model.md)
- [Protocol security](../../05-agent-protocol-security.md)
- [Cloudflare cost](../../06-cloudflare-storage-cost.md)
- [Engineering standards](../../08-engineering-standards.md)
- [Research](../../10-research.md)

Retrieve current official Cloudflare docs, runtime types, and Wrangler schema before using platform APIs, limits, pricing, or new config fields.

## Workflow

1. Inspect deployable ownership, existing Wrangler templates, package scripts, bindings, migrations, and working-tree changes.
2. Keep each Worker entrypoint thin and place domain behavior in owned modules/shared contracts.
3. Configure only required bindings/triggers. Prefer bindings and service bindings over REST/public HTTP.
4. Use generated Env types for TypeScript Workers and locked workers-rs APIs for Rust Workers.
5. Bound request body, decompression ratio, response body, batch size, concurrency, timeout, retries, and CPU/wall time.
6. Make Cron handlers idempotent with deterministic slots/IDs, conditional claims, and resumable cursors.
7. Stream large/unknown bodies. Await, return, void, or `waitUntil` every promise appropriately.
8. Add structured logs without tokens, keys, plaintext payloads, cookies, full URLs, or secrets.
9. Calculate hot-path cost changes for Workers requests/CPU, D1 rows/indexes/storage, DO requests/duration/storage, and R2 artifacts.
10. Validate types, tests, build, local cron/DO/WebSocket behavior, config parsing, deploy dry-run, diff, and cost model.

## Service Ownership

- Ingest Rust Worker: enroll, key lookup, replay/time check, decrypt/decode/limit, transactional D1 block/latest/rollup write, encrypted durable ACK/control response.
- Live TypeScript Worker/DO: validate short-lived tickets, Hibernation WebSockets, on-demand 10-second snapshots, RBAC topic projection, no authoritative storage.
- Check scheduler/executor: minute Cron, stable interval/phase, `last_claimed_slot`, direct bounded HTTP/TCP execution, Agent assignment.
- Check executor: centralized HTTP/TCP only, SSRF defense, bounded assertions/results.
- Retention Worker: policy, bounded D1 block/rollup cleanup, artifact expiry, cursors, soft-delete finalization.

Do not let one service write another service's table without a shared domain command or explicit contract.

## Storage and Cost Rules

- Store five durable reports/results in fixed slots of one five-minute `WITHOUT ROWID` D1 block; never write one D1 row per raw sample.
- Keep R2 out of online telemetry; use it only for explicit export/backup artifacts.
- Use D1 latest and 5-minute/1-hour rollups for routine UI reads; decode block slots only for bounded raw queries.
- Avoid secondary indexes on hot block/latest/replay/rollup tables; query allowed resource PKs and bounded time ranges.
- Do not write Live Hub snapshots to D1 or DO storage. Attachments hold only bounded connection/session metadata and stay below 16,384 bytes.
- Use Hibernation WebSockets without `setInterval`; Agent live frames run only while viewers subscribe and use 10-second cadence.
- Do not use Analytics Engine for tenant data requiring custom retention.
- Add 30/100/200/1000 machine plus check model deltas for hot-path changes.

## Cloudflare Check Rules

- Support HTTP and outbound TCP.
- Do not claim Worker ICMP support or stable geographic probe location.
- Keep centralized minimum interval at 60 seconds for the V1 Cron scheduler.
- Re-resolve and reclassify every redirect target to prevent SSRF.
- Respect the per-invocation simultaneous connection limit with a lower internal concurrency bound.

## Configuration Rules

- Commit `wrangler.<name>.template.toml`; ignore real configs.
- Use production names `alphaping-<name>-production`.
- Disable `workers_dev` and preview URLs for private background Workers.
- Store secrets through Wrangler/Secrets Store, never template vars.
- Keep deploy orchestration discoverable with `--list`, `--worker`, `--all`, `--env`, and `--dry-run`.
- Reject placeholders and unsafe production names before deploy.

## Verification

- Test duplicate report slots and duplicate Cron runs.
- Test partial D1 failures and cursor recovery.
- Test Live Hub hibernation/reconstruction, expired tickets, topic isolation, viewer demand TTL, disconnect fallback, and no-storage/no-ACK semantics.
- Test bad protobuf, replay, payload limits, SSRF, timeouts, and retry exhaustion.
- Run Worker typecheck/build and Rust fmt/clippy/test for Rust deployables.
- Run local scheduled/DO/WebSocket smoke tests and Wrangler dry-run without production mutation.
