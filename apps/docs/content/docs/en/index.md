---
title: Meet AlphaPing
description: Monitor your machines and services, and share a clear view of their status.
order: 0
---

AlphaPing is built for individuals, teams and small organizations. The control plane runs in your own Cloudflare account, with a lightweight Rust Agent on each machine you want to monitor.

## What you can do

- **Monitor machines**: inspect CPU, memory, disks, networking and uptime, with history charts loaded on demand.
- **Check services**: run HTTP and TCP checks from Cloudflare, or HTTP, TCP and ICMP probes from an Agent.
- **Watch containers**: view container status and resource metrics under their host machine.
- **Share status**: publish selected machines and services, incidents and announcements.
- **Control access**: assign view and manage permissions by workspace and resource.

> AlphaPing is in early development. The control plane currently requires manual configuration and deployment. Production Agent releases require signing and an update root. CI artifacts are evaluation builds, not configured production releases.

## Where to start

| Your goal                  | Read next                                           |
| -------------------------- | --------------------------------------------------- |
| Host your own instance     | [Deploy the control plane](/docs/start/deployment)  |
| Connect a machine          | [Install an Agent](/docs/start/agent)               |
| Monitor a website or port  | [Service checks](/docs/guides/services)             |
| Share status with visitors | [Public status pages](/docs/guides/status-pages)    |
| Understand the data flow   | [System architecture](/docs/reference/architecture) |

## Two parts working together

The **Cloudflare control plane** handles workspaces, permissions, history queries, check scheduling and public pages. A SvelteKit Web Worker provides the interface, while separate Workers handle ingestion, live connections, checks, notifications and cleanup.

The **Rust Agent** collects machine metrics, runs probes, reads container runtimes and stores reports locally until they are acknowledged. Enrollment credentials establish machine identity; an IP address is only an asset attribute.

## Open source and contributions

AlphaPing is licensed under Apache-2.0. You can self-host it, inspect and modify the code, and redistribute it under the license terms. See [About AlphaPing](/about) for development and contribution information.
