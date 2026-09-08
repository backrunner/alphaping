---
title: Deploy the control plane
description: Prepare Cloudflare resources, configure each Worker and securely create your first workspace.
order: 1
---

## Prerequisites

| Tool or resource | Requirement                                                                          |
| ---------------- | ------------------------------------------------------------------------------------ |
| Node.js          | 22.12 or newer; repository CI uses Node.js 24                                        |
| pnpm             | 12.3.4, matching the root packageManager field                                       |
| Rust             | 1.96, including the wasm32-unknown-unknown target                                    |
| Cloudflare       | Workers, two D1 databases and a WebSocket Durable Object; R2 for exports and backups |

The control plane uses Cloudflare-native deployment. Each Worker has its own configuration and connects to resources through bindings.

## Get the code

```bash
git clone https://github.com/BackRunner/alphaping.git
cd alphaping
pnpm install --frozen-lockfile
```

The repository includes configuration templates. Real deployment configurations and local secrets are ignored by Git.

## Configure resources and credentials

In `apps/web` and `workers/*`, copy each `wrangler.<name>.template.toml` to `wrangler.<name>.toml`. Replace the template resource IDs, domains and bindings. Production Worker names follow `alphaping-<name>-production`.

- `CONTROL_DB`: accounts, workspaces, resource configuration and permissions.
- `TELEMETRY_DB`: telemetry blocks, latest state, aggregates and state events.
- `LIVE_HUBS`: workspace-isolated live WebSocket hubs.
- `EXPORT_BUCKET`: explicit exports and backup artifacts.

Use each service's `.dev.vars.example` to identify its variables, and Wrangler secret to set production secrets. Initial setup requires a high-entropy setup token; the first visitor must not automatically become an administrator.

For the exact service bindings and security configuration, follow the repository's [architecture specification](https://github.com/BackRunner/alphaping/blob/main/.agents/02-architecture.md) and [protocol security configuration](https://github.com/BackRunner/alphaping/blob/main/.agents/05-agent-protocol-security.md).

> The documentation application, `apps/docs`, is a separate public site. It does not need your monitoring databases. When deploying a monitoring instance, you can select only the control-plane Workers you need.

## Validate and migrate databases

Validate the local environment, dependencies and migration chain first:

```bash
pnpm db:validate
pnpm build
pnpm workers:list
pnpm workers:deploy --all --env production --dry-run
```

`--dry-run` checks builds and deployment configuration. It does not create remote resources or apply database migrations. Configure migration directories for both D1 databases, then apply each migration chain in order in your own environment. Back up existing installations before upgrades; do not deploy new code while skipping required migrations.

Migration files live in `packages/db/migrations`. Consult the [backup and recovery guide](https://github.com/BackRunner/alphaping/blob/main/.agents/13-d1-backup-and-recovery.md) for the backup, migration and recovery process.

## Deploy and initialize

Deploy each service using your real Wrangler configuration. The deployment script can target individual services, for example:

```bash
pnpm workers:deploy --worker web --env production
```

This command performs a real deployment of the Web Worker. Prepare its dependencies, resources and migrations before running it. Deploy other Workers by the names shown in `pnpm workers:list`.

Open `/setup` on the control plane. Validate the environment and setup token, create an administrator, workspace and default dashboard, then choose retention and public-access settings. Public registration closes after initialization; administrators invite subsequent members.

## Next steps

Configure [signed production Agent releases](https://github.com/BackRunner/alphaping/blob/main/.agents/12-release-and-agent-updates.md), then [install an Agent](/docs/start/agent). You can also start by [adding Cloudflare service checks](/docs/guides/services).
