---
name: alphaping-plan-change
description: Plan and scope AlphaPing product or engineering changes against the repository requirements, service boundaries, data model, security protocol, Cloudflare cost model, UI system, and roadmap. Use before adding a feature, changing architecture or schema, altering public permissions, or modifying cross-service contracts in the AlphaPing repository.
---

# Plan AlphaPing Changes

Use the project baseline as the source of truth before proposing or implementing a cross-cutting change.

## Read the Relevant Baseline

Always read:

- [Requirements](../../01-requirements.md)
- [Architecture](../../02-architecture.md)
- [Module design](../../03-module-design.md)
- [Engineering standards](../../08-engineering-standards.md)

Read conditionally:

- Schema, storage, RBAC, retention: [Data model](../../04-data-model.md)
- Agent, protobuf, enrollment, crypto, updater: [Protocol security](../../05-agent-protocol-security.md)
- Ingest rate, storage, checks, Workers: [Cloudflare cost](../../06-cloudflare-storage-cost.md)
- Page, component, interaction, chart: [UI system](../../07-ui-design-system.md)
- Milestone or sequencing: [Roadmap](../../09-roadmap.md)
- Platform fact or current limit: [Research](../../10-research.md), then re-check the official source if numeric or time-sensitive

## Workflow

1. Inspect the current repository and working tree. Preserve unrelated user changes.
2. State the user outcome and the smallest behavior surface that satisfies it.
3. Identify affected deployables, owned tables, contracts, public projections, permissions, secrets, and Cloudflare resources.
4. Check whether the change crosses a documented service/table ownership boundary. Use a contract, queue, service binding, or shared domain command instead of copied SQL.
5. Identify migration and compatibility requirements for D1, protobuf, Agent versions, public APIs, and rolling deploys.
6. Quantify request, Queue, D1 row, R2 operation/storage, and Agent resource effects when the change touches a hot path.
7. Define authorization behavior for admin, member `view`/`manage`, and guest. Include deny precedence and inherited container permissions where relevant.
8. Define loading, empty, error, stale, permission-denied, accessibility, and responsive states for UI changes.
9. List focused tests, observability, rollout, rollback, and documentation updates.
10. Update baseline documents before code when the decision changes product behavior, ownership, schema, protocol, security, cost, or design tokens.

## Guardrails

- Keep SvelteKit deployable only to Cloudflare Workers.
- Keep Rust ingest responsible for Agent authentication/decryption and Queue handoff, not dashboard/history work.
- Keep raw telemetry out of per-sample D1 rows and per-report R2 objects.
- Keep Cloudflare ICMP out of the design; assign ICMP to an Agent executor.
- Keep guest responses on explicit public projections and hide sensitive fields by default.
- Keep commands allowlisted; never add arbitrary shell execution or arbitrary update URLs.
- Keep the PQ claim precise: hybrid key agreement, not complete PQ authentication.
- Avoid adding a new service, table, package, or abstraction without a concrete ownership or complexity benefit.

## Plan Output

Produce a compact implementation plan containing:

- Outcome and non-goals
- Files/modules and owners
- Data/contract changes
- Security/RBAC/public effects
- Cost and performance effects
- Migration/deploy/rollback order
- Tests and acceptance criteria
- Baseline documents to update
