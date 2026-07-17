# AlphaPing

AlphaPing is a self-hosted infrastructure monitoring platform for machines,
containers, and network services. Its control plane runs on Cloudflare Workers,
while a low-resource Rust Agent collects and durably reports host telemetry.

The project is in active early development. Review migrations and release notes
before operating it in production.

## Architecture

- SvelteKit control plane on Cloudflare Workers with Better Auth, Drizzle, and D1.
- Rust/Wasm ingest Worker for encrypted protobuf reports and Agent configuration.
- Hibernation WebSocket Durable Object for demand-gated 10-second live snapshots.
- Scheduled Workers for HTTP/TCP service checks and bounded retention cleanup.
- Rust Agent with SQLite WAL spool, infinite capped retry, container discovery,
  signed updates, and TLS 1.3 hybrid `X25519MLKEM768` key agreement.

Durable machine reports use one 60-second slot in a five-minute D1 block row.
Every 10-second sample remains queryable, while latest and rollup tables keep
routine dashboard reads inexpensive. R2 is reserved for explicit exports and
backups, not online telemetry.

The default 30-machine plus 30-check model fits the Cloudflare Workers Paid
included usage at an expected platform cost of 5 USD/month. The current cost
ledger is documented in [`.agents/06-cloudflare-storage-cost.md`](.agents/06-cloudflare-storage-cost.md).

## Repository

```text
apps/web             SvelteKit control plane and dashboard
workers/ingest       Rust Agent ingest Worker
workers/live         TypeScript live WebSocket Worker and Durable Object
workers/checks       Scheduled HTTP/TCP service checks
workers/retention    Scheduled D1 retention and command cleanup
crates/agent         Installed Rust Agent
packages             Shared authorization, contracts, and D1 repositories
proto                Canonical protobuf definitions
.agents              Product, architecture, security, cost, and engineering specs
```

## Development

Prerequisites:

- Node.js 22 or newer
- pnpm 11.10.0
- Rust 1.96 with the `wasm32-unknown-unknown` target
- A Cloudflare account for deployment

Install dependencies and run the complete local checks:

```bash
pnpm install
pnpm format:check
pnpm check
pnpm test
pnpm test:e2e
pnpm build
pnpm db:generate:check
cargo fmt --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
pnpm cost:check
```

Real Wrangler configurations and `.dev.vars` files are intentionally ignored.
Start from the committed `wrangler.*.template.toml` and `.dev.vars.example`
files, then provision D1 databases and secrets for your own environment. Never
commit database IDs, enrollment tokens, update signing keys, or Worker secrets.

D1 Paid Time Travel is the primary 30-day recovery mechanism. Explicit
long-term SQL backups and non-destructive local restore drills are available as
`pnpm db:backup` and `pnpm db:restore:verify`; follow
[`.agents/13-d1-backup-and-recovery.md`](.agents/13-d1-backup-and-recovery.md)
before using either command with production data.

The canonical repository is <https://github.com/alkinum/alphaping>.

## Documentation

Start with [`.agents/README.md`](.agents/README.md). The requirements,
architecture, protocol security, data model, cost model, UI system, roadmap, and
Agent retry behavior are maintained there as implementation constraints.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
Security vulnerabilities must follow [SECURITY.md](SECURITY.md), not a public
issue.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE),
[NOTICE](NOTICE), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
