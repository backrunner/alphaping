---
title: Technical reference
description: Understand the boundaries between the control plane and Agent, and diagnose deployment and runtime issues.
order: 3
---

## Architecture and troubleshooting

- [System architecture](/docs/reference/architecture): durable reports, live snapshots, storage and security boundaries.
- [Troubleshooting](/docs/reference/troubleshooting): missing reports, interrupted live connections, service checks and installation problems.

## Repository specifications

Detailed maintainer documents remain in the repository:

- [Protocol and security](https://github.com/BackRunner/alphaping/blob/main/.agents/05-agent-protocol-security.md)
- [Cloudflare cost model](https://github.com/BackRunner/alphaping/blob/main/.agents/06-cloudflare-storage-cost.md)
- [Signed releases and automatic updates](https://github.com/BackRunner/alphaping/blob/main/.agents/12-release-and-agent-updates.md)
- [D1 backup and recovery](https://github.com/BackRunner/alphaping/blob/main/.agents/13-d1-backup-and-recovery.md)

These specifications evolve with the implementation and are currently written in Chinese. For exact environment variables, release commands or recovery procedures, use the relevant specification and configuration templates from the same revision.
