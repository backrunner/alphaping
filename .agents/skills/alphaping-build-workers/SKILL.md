---
name: alphaping-build-workers
description: Build and review AlphaPing Cloudflare Workers, bindings, Queues, D1/R2 telemetry processing, service-check scheduling, retention jobs, Wrangler templates, and multi-worker deployment orchestration. Use for changes under workers, Cloudflare configs, deployment scripts, or hot-path storage and cost logic.
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
6. Make Queue/Cron handlers idempotent with deterministic IDs, claims/leases, and resumable cursors.
7. Stream large/unknown bodies. Await, return, void, or `waitUntil` every promise appropriately.
8. Add structured logs without tokens, keys, plaintext payloads, cookies, full URLs, or secrets.
9. Calculate hot-path cost changes for Workers requests/CPU, Queue operations, D1 rows/indexes, and R2 Class A/B/storage.
10. Validate types, tests, build, local queue/cron behavior, config parsing, deploy dry-run, diff, and cost model.

## Service Ownership

- Ingest Rust Worker: enroll, key lookup, replay/time check, decrypt/decode/limit, Queue publish, encrypted control response.
- Telemetry Rust Worker: Queue consume, idempotency, latest/rollup/event, R2 block/manifest.
- Check scheduler: minute Cron, due query, lease, next nominal run, dispatch/Agent assignment.
- Check executor: centralized HTTP/TCP only, SSRF defense, bounded assertions/results.
- Retention Worker: policy, bounded D1/R2 cleanup, cursors, soft-delete finalization.

Do not let one service write another service's table without a shared domain command or explicit contract.

## Storage and Cost Rules

- Never write one D1 row per raw sample indefinitely.
- Never write one R2 object per report.
- Keep Queue messages within 64 KB where practical; each normal message is typically three billed operations.
- Aggregate raw reports into 256 KiB to 4 MiB immutable R2 objects and complete manifests after successful puts.
- Use D1 latest/summary/5-minute rollups for routine UI reads.
- Query/clean R2 through manifests, not bucket-wide list scans.
- Do not use Analytics Engine for tenant data requiring custom retention.
- Add 100/1000/10000 Agent model deltas for hot-path changes.

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

- Test duplicate Queue messages and duplicate Cron runs.
- Test partial R2/D1 failures and cursor recovery.
- Test bad protobuf, replay, payload limits, SSRF, timeouts, and retry exhaustion.
- Run Worker typecheck/build and Rust fmt/clippy/test for Rust deployables.
- Run local scheduled/queue smoke tests and Wrangler dry-run without production mutation.
