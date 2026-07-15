import { error } from "@sveltejs/kit";

interface MembershipRow {
  workspace_id: string;
  workspace_pk: number;
  role: "admin" | "member";
}

interface SequenceRow {
  value: number;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function decodeHexSecret(value: string): ArrayBuffer {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw error(500, "Enrollment pepper is invalid");
  const buffer = new ArrayBuffer(32);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return buffer;
}

async function tokenDigest(token: string, pepper: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    decodeHexSecret(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
}

async function requireAdmin(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
): Promise<MembershipRow> {
  const membership = await db
    .prepare(
      `SELECT w.id AS workspace_id, w.telemetry_pk AS workspace_pk, m.role
       FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
       WHERE w.slug = ? AND m.user_id = ? AND m.status = 'active' AND w.deleted_at IS NULL`,
    )
    .bind(workspaceSlug, userId)
    .first<MembershipRow>();
  if (!membership || membership.role !== "admin") throw error(404, "Workspace not found");
  return membership;
}

async function nextSequence(db: D1Database, kind: "machine" | "service" | "check") {
  const row = await db
    .prepare(
      `UPDATE telemetry_resource_sequences SET value = value + 1
       WHERE kind = ? RETURNING value`,
    )
    .bind(kind)
    .first<SequenceRow>();
  if (!row) throw error(500, "Resource sequence is unavailable");
  return row.value;
}

export async function createMachine(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  enrollmentPepper: string,
  input: { name: string; expectedHost: string; containersEnabled: boolean },
): Promise<{ token: string; machineId: string; expiresAt: number }> {
  const membership = await requireAdmin(db, workspaceSlug, userId);
  if (input.name.length < 2 || input.name.length > 80) throw error(400, "Machine name is invalid");
  if (input.expectedHost.length > 253) throw error(400, "Expected host is invalid");
  const telemetryPk = await nextSequence(db, "machine");
  const token = randomToken();
  const digest = await tokenDigest(token, enrollmentPepper);
  const now = Date.now();
  const expiresAt = now + 15 * 60_000;
  const machineId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO machines
          (id, telemetry_pk, workspace_id, name, expected_host, sampling_interval_seconds,
           report_interval_seconds, offline_after_seconds, container_monitoring_enabled,
           desired_config_revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 10, 60, 150, ?, 1, ?, ?)`,
      )
      .bind(
        machineId,
        telemetryPk,
        membership.workspace_id,
        input.name,
        input.expectedHost || null,
        input.containersEnabled ? 1 : 0,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO agent_enrollment_tokens
          (id, workspace_id, machine_id, token_digest, expires_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        membership.workspace_id,
        machineId,
        digest,
        expiresAt,
        userId,
        now,
      ),
  ]);
  return { token, machineId, expiresAt };
}

export async function createHttpService(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  input: { name: string; url: string; intervalSeconds: number; expectedStatus: number },
): Promise<{ serviceId: string }> {
  const membership = await requireAdmin(db, workspaceSlug, userId);
  if (input.name.length < 2 || input.name.length > 80) throw error(400, "Service name is invalid");
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw error(400, "Service URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw error(400, "Service URL must use HTTP or HTTPS");
  }
  if (
    !Number.isInteger(input.intervalSeconds) ||
    input.intervalSeconds < 60 ||
    input.intervalSeconds > 86_400
  ) {
    throw error(400, "Cloudflare check interval must be between 60 and 86400 seconds");
  }
  if (
    !Number.isInteger(input.expectedStatus) ||
    input.expectedStatus < 100 ||
    input.expectedStatus > 599
  ) {
    throw error(400, "Expected HTTP status is invalid");
  }
  const [servicePk, checkPk] = await Promise.all([
    nextSequence(db, "service"),
    nextSequence(db, "check"),
  ]);
  const serviceId = crypto.randomUUID();
  const checkId = crypto.randomUUID();
  const now = Date.now();
  const requestJson = JSON.stringify({
    url: url.toString(),
    method: "GET",
    headers: {},
    body: null,
    expectedStatus: [input.expectedStatus],
    degradedAfterMs: 1_500,
  });
  await db.batch([
    db
      .prepare(
        `INSERT INTO services
          (id, telemetry_pk, workspace_id, name, status_rule_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, '{}', ?, ?)`,
      )
      .bind(serviceId, servicePk, membership.workspace_id, input.name, now, now),
    db
      .prepare(
        `INSERT INTO check_configs
          (id, telemetry_pk, workspace_id, service_id, name, kind, executor_kind,
           enabled, interval_seconds, phase_seconds, timeout_ms, request_json,
           last_claimed_slot, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Availability', 'http', 'cloudflare', 1, ?, 0, 5000, ?, 0, ?, ?)`,
      )
      .bind(
        checkId,
        checkPk,
        membership.workspace_id,
        serviceId,
        input.intervalSeconds,
        requestJson,
        now,
        now,
      ),
  ]);
  return { serviceId };
}
