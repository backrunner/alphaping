---
title: System architecture
description: The Cloudflare control plane and Rust Agent work together, with distinct paths for durable data and live observation.
order: 1
---

## Deployment units

| Unit          | Main responsibility                                                                        |
| ------------- | ------------------------------------------------------------------------------------------ |
| Web           | SvelteKit interface, authentication, permissions, configuration and history queries        |
| Ingest        | Agent enrollment, authentication, decryption, durable telemetry transactions and ACKs      |
| Live          | Workspace-isolated Hibernation WebSocket hubs                                              |
| Checks        | Scheduled HTTP / TCP checks and state processing                                           |
| Notifications | Consume state events and deliver notifications asynchronously                              |
| Retention     | Batched cleanup, retention and compaction                                                  |
| Docs          | Independent product landing and public documentation, with no monitoring database bindings |

## Durable reports

The Agent stores unacknowledged reports locally and uploads authenticated, encrypted protobuf envelopes. Ingest returns a durable ACK after the D1 transaction succeeds; only then can the Agent remove the corresponding pending data.

Ten-second samples are organized into fixed slots in five-minute D1 blocks. Routine pages query latest-state and aggregate tables, reading bounded raw data only when needed.

## Live snapshots

While a visible page is subscribed, Live Hub forwards ten-second snapshots. Live frames do not write to D1 or Durable Object storage, acknowledge the Agent spool, or trigger alerts or command side effects.

The live path is for observation. Durable reports remain authoritative for history and machine state. When live delivery is interrupted, the page indicates this and falls back to durable data.

## Storage boundaries

`CONTROL_DB` stores configuration, authentication and permissions. `TELEMETRY_DB` stores telemetry blocks, state and aggregates. R2 stores explicit exports and backups, not the primary online telemetry stream.

Retention is configurable. Fleet size, check count, public traffic and retention periods affect cost; consult the [cost model](https://github.com/BackRunner/alphaping/blob/main/.agents/06-cloudflare-storage-cost.md).

## Security boundaries

Transport uses TLS 1.3 hybrid `X25519MLKEM768` key agreement plus authenticated application-level encrypted envelopes. Hybrid post-quantum key agreement does not imply fully post-quantum authentication.

Agent commands and update sources are constrained by allowlists and signed metadata. Arbitrary shell execution is not provided. Public pages receive explicit data projections.
