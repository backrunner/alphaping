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

## Install the Agent

Create a machine in the control plane, generate its short-lived enrollment token,
then copy the Shell or PowerShell command. It downloads and verifies the installer
before enrollment and service startup. Linux supports systemd and OpenRC, macOS
uses launchd, and Windows uses a native Windows Service. Existing installations
are preserved; upgrades use the signed Agent updater.

See the [platform matrix and recovery guide](.agents/14-agent-installation.md)
for requirements, bootstrap trust, service locations, and native-test coverage.

## Customize your public page

Open **Admin → Appearance** to set a site title, introduction, color palette,
default light/dark mode, and comfortable or compact layout. Five palettes are
included: Iris, Ocean, Mint, Sunset, and Rose. Changes apply to published status
pages and resource details, including custom-domain entry points.

Visitors can use **Appearance** to personalize their view. Their preferences
stay in the browser and can be reset to the site defaults. Publishing and resource
permissions remain controlled by **Data & visibility**.

Existing deployments must apply CONTROL_DB migration
`0024_dashboard_appearance.sql` before deploying the updated Web Worker.
See the [latest UI review and screenshots](docs/reviews/2026-09-08-glass-logo.md).
Validation results and remaining platform coverage are recorded in the
[final verification report](docs/reviews/2026-09-08-final-verification.md).

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

- Node.js 22.12 or newer
- pnpm 12.3.4
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

### Domain routing

Cloudflare custom domains can expose the control plane and public status surfaces
on separate hostnames. Route each hostname to the web Worker, then set
`DOMAIN_ROUTES_JSON` in the real web Wrangler configuration. Public machine and
service routes use their public slugs, never internal resource IDs.

```toml
[vars]
DOMAIN_ROUTES_JSON = '''
{
  "admin.example.com": { "kind": "admin", "workspace": "operations" },
  "status.example.com": { "kind": "status", "workspace": "operations" },
  "edge.example.com": {
    "kind": "machine",
    "workspace": "operations",
    "resource": "public-machine-slug"
  },
  "api.example.com": {
    "kind": "service",
    "workspace": "operations",
    "resource": "public-service-slug"
  }
}
'''
```

The `status`, `machine`, and `service` hostnames render their Guest page directly
at `/`. Guest hostnames reject login and management paths. An `admin` hostname
routes `/` to its configured workspace and retains the normal authenticated
control-plane paths.

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
