---
title: Getting started
description: Prepare your environment, deploy an instance and connect your first machine.
order: 1
---

## Before you begin

You need a Cloudflare account with the required Worker and D1 resources, plus a supported machine if you plan to install an Agent.

Deployment currently involves the command line, Wrangler configuration and secret management. Validate the process in an evaluation environment before setting up a production instance.

## Setup order

1. [Deploy the control plane](/docs/start/deployment), apply database migrations and complete initial setup.
2. [Install an Agent](/docs/start/agent) and wait for its first successful report.
3. [Add service checks](/docs/guides/services), choosing an executor and failure confirmation count.
4. [Configure public status pages](/docs/guides/status-pages) and decide which resources visitors may see.

## Monitoring services only

For HTTP or TCP checks from Cloudflare, you can deploy the control plane and create a service without connecting a machine first. ICMP checks require an Agent executor.
