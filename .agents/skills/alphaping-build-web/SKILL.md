---
name: alphaping-build-web
description: Build and review AlphaPing's SvelteKit control plane, compact monitoring dashboard, status pages, setup flow, Better Auth integration, Drizzle D1 access, shadcn-svelte and Bits UI components, and resource-level RBAC. Use for changes under apps/web or shared web UI/authz/database packages.
---

# Build AlphaPing Web

Implement a dense, accessible operations console that runs only on Cloudflare Workers.

## Read First

- [Requirements](../../01-requirements.md)
- [Architecture](../../02-architecture.md)
- [Data model](../../04-data-model.md)
- [UI system](../../07-ui-design-system.md)
- [Engineering standards](../../08-engineering-standards.md)

Read [Cloudflare cost](../../06-cloudflare-storage-cost.md) for polling, history, public cache, or write-path changes. Read [Research](../../10-research.md) and current official docs before relying on adapter, Better Auth, Drizzle, Wrangler, or D1 details.

## Workflow

1. Inspect existing routes, components, package versions, generated Env types, schema, and user changes.
2. Put server-only auth, repository, validation, and policy logic under server modules. Keep routes thin.
3. Use `@sveltejs/adapter-cloudflare`, Workers Static Assets, platform bindings, and generated binding types.
4. Mount Better Auth through its SvelteKit handler, populate `event.locals`, and use the documented cookie plugin for server actions.
5. Apply workspace scope and server-side authorization inside each service/repository path. Do not use hidden UI as enforcement.
6. Produce guest output through explicit public projection functions. Never serialize internal machine/service entities directly.
7. Use shadcn-svelte owned source with Bits UI primitives and the AlphaPing tokens. Keep Lucide Svelte as the single icon family.
8. Implement all states: loading, empty, error, stale, denied, disabled, active, and responsive.
9. Add focused unit/integration tests and Playwright flows/screenshots proportional to the behavior.
10. Run formatting, lint, typecheck, tests, build, accessibility, and relevant visual checks.

## Product UI Rules

- Use `DESIGN_VARIANCE 3`, `MOTION_INTENSITY 2`, `VISUAL_DENSITY 9`.
- Keep page sections unframed. Use cards only for repeated resources such as machines.
- Never nest cards. Group metrics with grid tracks, spacing, and sparse dividers.
- Use 6 px card/input radius, fixed 28/32 px controls, and full pills only for semantic statuses/tags.
- Use Geist Sans/Mono, tabular numerals, stable dimensions, and no viewport-scaled fonts.
- Keep charts collapsed by default and do not fetch history before expansion.
- Use status text/icon/shape in addition to color.
- Keep navigation dynamic: hide Machines or Services when the workspace has none configured.
- Keep Containers under Machine detail, never as a top-level module.
- Avoid decorative gradients, glows, glass, oversized headings, marketing copy, continuous motion, and generic card grids.

## RBAC Rules

- Admin: workspace-wide.
- Member: resource `view`/`manage`; `manage` implies `view`.
- Guest: only explicit dashboard/resource public policies and projection profiles.
- Explicit deny wins. Containers inherit machine permissions unless overridden.
- Return non-enumerating errors when access is denied.
- Test direct API access for every UI permission test.

## Data Rules

- Use repositories from `packages/db`; do not write SQL in Svelte routes/components.
- Require workspace ID and bounded time ranges in list/history queries.
- Read dashboard counts from summary/latest tables, not full-table aggregation.
- Use cursor pagination and URL-backed filters.
- Treat secrets as write-only replacement fields and never return old values.

## Verification

- Test desktop, laptop, tablet, and mobile in light/dark modes.
- Test default, loading, empty, error, stale, and denied states.
- Verify keyboard navigation, focus return, labels, contrast, and non-color status cues.
- Verify dynamic values do not shift cards, buttons, tabs, or metric tracks.
- Verify public responses omit IPs, Agent IDs, headers, payloads, secrets, and internal diagnostics.
