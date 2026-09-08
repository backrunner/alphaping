---
title: Install an Agent
description: Connect Linux, macOS or Windows machines using the one-time installation command from your control plane.
order: 2
---

## Supported platforms

| System                    | Architectures              | Service manager   |
| ------------------------- | -------------------------- | ----------------- |
| Linux                     | x86_64, ARM64; static musl | systemd or OpenRC |
| macOS 11+                 | Intel, Apple silicon       | launchd           |
| Windows 10 / Server 2016+ | x64, ARM64                 | Windows Service   |

Installation requires administrator or root privileges. Windows requires PowerShell 5.1 or 7 and a compatible .NET Framework. 32-bit platforms are not supported. Linux containers without an init system and WSL do not automatically receive a host service installation.

## Create a machine and token

1. Choose **Add machine** in the control plane and enter its name, tags and sampling configuration.
2. Create an enrollment token and select Shell or PowerShell.
3. Verify the target machine and command, then copy the complete generated installation command.
4. Run it in an administrator terminal on the target machine and wait for the first successful report.

Tokens expire after 15 minutes by default and can only be used successfully once. Generate a new token if the previous one expired or was revoked. Installation commands contain credentials; handle terminal history accordingly.

## What installation verifies

The generated command downloads the installer and verifies its SHA-256. The installer checks the operating system, architecture, privileges and any existing installation. It then downloads the Agent, verifies its length, hash and version, enrolls the machine, runs a self-test and starts the system service.

The initial trust anchor is the control plane's HTTPS manifest. Later automatic updates use signed metadata. Deployers must complete [release signing configuration](https://github.com/BackRunner/alphaping/blob/main/.agents/12-release-and-agent-updates.md) first; ordinary CI artifacts are not a production update source.

## Confirm that it worked

After the first successful report, the machine page shows resource metrics, the Agent version and the last report time. Before that, it shows a waiting state. Missing metrics are not presented as fabricated zero values.

If installation fails, inspect the recovery location reported by the installer and the system service status. Do not delete the identity or SQLite spool to force a reinstall: identity, keys and transport sequence numbers must remain consistent.

## Containers and permissions

The Agent can detect Docker, Colima runtimes and Apple container. An Agent running as a system service does not automatically have access to the signed-in user's container sockets. Connection problems appear as connection or permission errors; see [Machines and containers](/docs/guides/machines).

For detailed platform limits, service recovery and local storage compatibility, see the [installation and recovery specification](https://github.com/BackRunner/alphaping/blob/main/.agents/14-agent-installation.md).
