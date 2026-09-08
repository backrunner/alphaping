---
title: Machines and containers
description: Start with current metrics, then inspect history, probes and container state when you need more detail.
order: 1
---

## Read the machine list

Machine cards show identity, status, CPU, memory, the primary storage volume, upload and download rates, and cumulative traffic. Search and filters remain in the URL so you can refresh or share the same view.

| State       | Meaning                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- |
| Online      | A report arrived within the offline threshold and metrics remain below alert thresholds |
| Degraded    | The machine is online, but a resource or probe has reached a warning threshold          |
| Fault       | The machine can still communicate, but a critical threshold or key probe has failed     |
| Offline     | No durable report arrived within the offline threshold                                  |
| Maintenance | The machine is in a manual maintenance window                                           |
| Unknown     | No successful report yet, or insufficient data to determine state                       |

State is shown with text and icons. Machines that have never reported show a waiting state, with placeholders for missing metrics.

## Inspect details and history

Open a machine to inspect current metrics, configuration sync state and recent events. History charts start collapsed and load the selected time range only when expanded.

If the live connection drops, the page shows the last update time and falls back to durable data. **A lost live connection does not mean the machine is offline**: offline state depends on durable reports and the configured offline threshold.

## Monitor containers

Containers belong to a machine rather than a separate top-level module. When container monitoring is enabled, you can inspect the runtime, image, running and health state, restart count, and available resource and port summaries.

The Agent does not read container environment variables, secrets, mount contents or log bodies by default. An inaccessible runtime appears as a permission or connection error, not as an empty container list.

System services have a different environment from the signed-in user. With Colima or user-level Docker sockets, verify the Agent service account's actual access.

## Machine probes

Configure ICMP, TCP or HTTP tasks under the machine's probes. You can also choose another enrolled Agent as the executor. Configuration is distributed by revision; check both the desired revision and the revision applied by the Agent.

See [Service checks](/docs/guides/services) for guidance on choosing an execution location.
