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

async function nextSequence(db: D1Database, kind: "machine") {
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
