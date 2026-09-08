---
title: Troubleshooting
description: Start with the last successful state and distinguish installation, reporting, live connection and executor failures.
order: 2
---

## A machine is waiting for its first report

Check whether the system service started, whether the enrollment token expired, and whether the control plane and Ingest HTTPS endpoints are reachable. Review the installer's self-test output and recovery location.

If enrollment already completed, do not repeatedly regenerate tokens or delete the identity. Preserve enrollment state and investigate the service or network first.

## Live connection lost, machine still online

These are separate observations. A network change, proxy or sleeping browser can interrupt the WebSocket. Machine online state depends on the latest durable report.

Check the last successful update time and confirm that the page has fallen back to durable data. Then inspect the Live Worker and browser connection.

## A service check fails

1. Verify the check type and executor. Cloudflare does not support ICMP.
2. Test reachability from the actual execution location. Local access does not imply access from Cloudflare.
3. Review the expected status code, timeout, TLS, redirects and response assertions.
4. Check the consecutive failure count to distinguish an individual failure from a confirmed outage.

Cloudflare checks restrict target addresses and response sizes. The checker is not an arbitrary private-network request proxy.

## Container monitoring shows a permission error

Verify that the Agent service account can access the runtime socket. A system daemon does not automatically inherit the signed-in user's HOME, Docker or Colima environment.

A permission error does not mean there are no containers. Fix runtime access and verify the connection; changing public visibility will not solve it.

## The installer refuses to overwrite an existing installation

This protects the existing identity, configuration and spool. Use the signed updater for upgrades and follow the installer's recovery instructions after failures. Do not delete SQLite files to bypass the protection.

Consult the [Agent installation and recovery specification](https://github.com/BackRunner/alphaping/blob/main/.agents/14-agent-installation.md).

## Report a problem

In [GitHub Issues](https://github.com/BackRunner/alphaping/issues), include the version, platform, reproduction steps and observed error. Remove tokens, cookies, private keys and sensitive target addresses before attaching logs.

Report vulnerabilities through [private security reporting](https://github.com/BackRunner/alphaping/security/advisories/new).
