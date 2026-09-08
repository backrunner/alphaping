---
name: alphaping-release-check
description: Validate AlphaPing changes and releases for formatting, types, tests, migrations, protobuf compatibility, Cloudflare cost, secrets, licenses, public-data leakage, Agent artifacts, signed updates, commit format, deployment safety, and Apache-2.0 open-source readiness. Use before merging, tagging, deploying, or publishing the repository.
---

# Check AlphaPing Releases

Treat release validation as evidence gathering. Do not deploy, tag, publish, rewrite history, or alter production without an explicit user request.

## Read First

- [Requirements acceptance criteria](../../01-requirements.md)
- [Protocol security](../../05-agent-protocol-security.md)
- [Cloudflare cost](../../06-cloudflare-storage-cost.md)
- [Engineering standards](../../08-engineering-standards.md)
- [Roadmap exit conditions](../../09-roadmap.md)

Read relevant architecture/data/UI documents for the changed files.

## Workflow

1. Inspect branch, status, diff, recent commits, changed files, and untracked files. Preserve unrelated user changes.
2. Classify the validation scope: web, schema, protocol, Worker hot path, Agent, UI, installer, or release artifact.
3. Run the smallest complete check set for the scope, then the root verification set before a release.
4. Inspect generated files, migrations, protobuf compatibility, Wrangler templates, package/crate metadata, and release manifests.
5. Scan tracked/untracked content and history range for secrets, Cloudflare IDs, production domains, customer data, signing material, and sensitive screenshots.
6. Verify public projections and fixtures do not leak IPs, headers, payloads, Agent IDs, container secrets, or internal diagnostics.
7. Review dependency licenses, notices, SBOM, vendored assets, fonts, icons, and Apache-2.0 metadata.
8. Re-run 30/100/200/1000 machine plus check cost models for Workers, D1, Live DO, and artifacts, then compare with the baseline.
9. Verify rollout, backup, migration ordering, deploy dry-run, compatibility matrix, smoke tests, and rollback.
10. Report failures first with commands/files and leave the repository in a non-destructive state.

## Required Checks

Run when available:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
cargo fmt --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
pnpm workers:list
pnpm workers:deploy --all --env production --dry-run
git diff --check
```

Also run deterministic protobuf generation/breaking checks, D1 migration validation, secret scan, dependency/license audit, and visual/accessibility checks when configured.

## Open-source Gate

- Confirm `LICENSE` contains Apache License 2.0 and metadata uses `Apache-2.0`.
- Confirm `NOTICE`, `README`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, and `SECURITY` exist for public release.
- Confirm target repository references `BackRunner/alphaping`.
- Confirm real Wrangler configs and `.dev.vars` are ignored while templates/examples remain tracked.
- Confirm no private seeders, local databases, build output, coverage, update keys, signing keys, or release credentials are tracked.
- Confirm third-party license/notice obligations and distributable asset licenses.

## Commit Gate

- Require `type(scope): description`.
- Require stable AlphaPing scopes and informative descriptions.
- Reject mixed unrelated changes, WIP/misc messages, silent breaking changes, or missing migration/contract updates.
- Confirm local authorship for project work is `BackRunner <dev@backrunner.top>` unless the user explicitly directs otherwise.

## Agent Release Gate

- Build every supported OS/arch artifact reproducibly where practical.
- Generate SBOM, SHA-256, signed TUF-style metadata, version/platform manifest, and checksums.
- Verify updater against the published metadata in an isolated test.
- Verify previous supported Agent versions can update and report across the compatibility window.
- Verify corrupt/signature-failed/health-failed updates do not replace the last-known-good binary.

## Worker Release Gate

- Parse every Wrangler template and reject placeholders for real deploy.
- Confirm background Workers are private and secrets are not vars.
- Confirm binding/table ownership, idempotency, batch bounds, timeouts, logs, and observability.
- Confirm Live Hub uses Hibernation WebSockets, workspace/shard routing, bounded attachments, short-lived tickets, no snapshot storage, and D1 fallback.
- Run per-worker dry-run and verify intended production names.
- Back up D1 before destructive/contract migrations and record restore steps.

## Report

List blocking failures first, then passed checks, skipped checks with reasons, residual risks, migration/deploy order, rollback, and the exact commits/artifacts validated.
