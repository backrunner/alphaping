# Contributing to AlphaPing

## Before You Start

Open an issue for substantial product, protocol, schema, or architecture changes
before implementation. Security reports must use the private process in
[SECURITY.md](SECURITY.md).

By submitting a contribution, you agree that it is licensed under Apache-2.0
and that you have the right to contribute it.

## Development Standards

- Preserve the service boundaries and cost rules documented under `.agents/`.
- Keep D1 queries workspace-scoped and bounded by resource and time.
- Never weaken Agent acknowledgement, spool, nonce, signature, or update checks.
- Do not commit secrets, real Wrangler IDs, private fixtures, local databases,
  build output, or generated release keys.
- Add tests proportional to the behavior and update protocol, migration, cost,
  or UI documentation when contracts change.
- Avoid unbounded queues, network attempts without timeouts or capped backoff,
  and `any` in TypeScript. Durable Agent deliveries still retry indefinitely.

Run the checks listed in [README.md](README.md) before opening a pull request.
Cloudflare deploy commands in pull requests must use `--dry-run`; contributors
must not deploy to project production resources.

## Commits

Use the project format:

```text
type(scope): description
```

Examples include `feat(agent): persist retry state`, `fix(web): enforce machine
scope`, and `docs(cost): update D1 write ledger`. Keep commits focused and call
out migrations or protobuf compatibility changes explicitly.

## Pull Requests

Describe the user-visible behavior, security and cost impact, tests performed,
migration/deploy order, and rollback plan. Include screenshots for UI changes
and measured payload/CPU/storage data for hot-path changes.
