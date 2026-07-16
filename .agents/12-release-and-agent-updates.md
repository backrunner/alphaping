# AlphaPing Release And Agent Updates

## 1. Trust roots

GitHub Releases is an artifact transport, not the update trust root. A release build embeds the public root metadata through `ALPHAPING_UPDATE_ROOT_JSON`. Builds without that value keep monitoring enabled but reject automatic and remotely requested updates with `release_root_unconfigured`.

Generate a new root ceremony outside the repository:

```bash
node scripts/release/generate-root.mjs \
  --private-dir /offline/alphaping-release-keys \
  --public-root /work/alphaping-root.json
```

The generator refuses to place private keys inside the repository. Root uses 2-of-3 keys, targets uses 2-of-2 keys, and timestamp/snapshot use separate online keys. Move root and targets private keys to separate offline custody before the first public release. Never place private PEM, signing environment files, or generated signatures in Git.

Root public metadata is immutable input to an Agent release build. Root rotation must be signed by both the currently trusted root threshold and the new root threshold before changing this build input. A production release is blocked until the project owner completes this ceremony and records the public root.

## 2. Metadata chain

`scripts/release/build-metadata.mjs` reads six platform artifacts and emits:

- `alphaping-tuf-timestamp.json`, valid for 24 hours;
- `alphaping-tuf-snapshot.json`, valid for 7 days;
- `alphaping-tuf-targets.json`, valid for 30 days;
- `agent-release-manifest.json` for first-install bootstrap through the control-plane origin.

Every signed object uses deterministic, recursively sorted JSON. The Agent verifies role threshold signatures, type, expiry, monotonic metadata versions, chained length/SHA-256, target platform/architecture/channel, rollout selection, artifact length, artifact SHA-256, and the candidate's own `--version` output. `If-None-Match` is used for metadata after the first successful check in a running Agent.

The release command requires an explicit monotonic metadata version:

```bash
node scripts/release/build-metadata.mjs \
  --root /work/alphaping-root.json \
  --private-dir /online/alphaping-release-keys \
  --artifacts /work/release-artifacts \
  --output /work/signed-release \
  --version 0.2.0 \
  --metadata-version 2
```

Targets signing requires both targets keys. Timestamp and snapshot keys can be provided only to the online release job after the targets envelope has been approved.

## 3. First install

The authenticated control-plane origin serves `/install.sh` and `/install.ps1`. The generated command also passes that origin as `--manifest-origin`. `/agent-release/{target}` reads `AGENT_RELEASE_MANIFEST_JSON`, validates every field, and returns the exact version, length, SHA-256, and fixed `alkinum/alphaping` versioned URL.

The installer downloads from GitHub but accepts the binary only when it matches the manifest supplied over the control-plane TLS origin and reports the same embedded version. The template manifest deliberately has zero length/hash and fails closed. Deployment automation must replace it with `agent-release-manifest.json` from the signed release job.

Linux installs under `/opt/alphaping/bin`, uses a hardened systemd unit, and grants write access only to the binary/state directories required for self-update. macOS installs under `/Library/Application Support/AlphaPing` with a system LaunchDaemon. Windows registers a real SCM service via the Agent `service` subcommand, restricts the data-directory ACL to LocalSystem/Administrators, and wraps the complete config with DPAPI LocalMachine. A legacy plaintext Windows config is rewritten through DPAPI on the first successful load.

## 4. Runtime update flow

- Automatic checks run every six hours plus 0-30 minutes of jitter and never block the 10-second sampler.
- Stable and explicitly pinned versions are supported. Automatic rollout selection is deterministic per Agent/version.
- A panel command may bypass rollout only. It cannot change the release origin, signature roles, hashes, expiry, platform, or command schema.
- Commands arrive inside the authenticated server-to-client protobuf envelope and are persisted before the report ACK is removed locally.
- Command IDs remain in SQLite until their result receives a durable server ACK, so replayed delivery cannot repeat a side effect.
- Unix writes beside the current executable, runs candidate self-test, atomically preserves/replaces the binary, fsyncs the directory, and runs self-test again. Any failure restores the previous binary.
- Windows copies a fixed updater helper, lets the SCM service stop cleanly, replaces the executable, validates it, rolls back on failure, and starts the service again.
- Installed version is reported in the next encrypted report. Command result fields are bounded status codes and never include stdout, arbitrary files, environment variables, or stack traces.

## 5. Control-plane cost

Every report already updates one `agents` row for `last_seen_at`; version reporting is folded into that same write. Command delivery adds one indexed CONTROL_DB read per report and no steady-state write. At 100 Agents and one report per minute this is about 4.32 million reads/month, far below the Workers Paid D1 allowance. Writes occur only when an operator creates a command, a command is delivered, or its result is committed.
