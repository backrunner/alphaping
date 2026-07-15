import { hashPassword } from "better-auth/crypto";
import { error } from "@sveltejs/kit";

interface SetupInput {
  token: string;
  name: string;
  email: string;
  password: string;
  workspaceName: string;
  workspaceSlug: string;
  rawDays: number;
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function validSetupToken(submitted: string, expected: string): Promise<boolean> {
  if (submitted.length < 20 || expected.length < 20) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(submitted)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
}

export async function initializeInstallation(
  db: D1Database,
  expectedToken: string,
  input: SetupInput,
): Promise<{ workspaceSlug: string }> {
  if (!(await validSetupToken(input.token, expectedToken))) throw error(403, "Invalid setup token");
  if (input.password.length < 12) throw error(400, "Password must contain at least 12 characters");
  if (!/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(input.workspaceSlug)) {
    throw error(400, "Workspace slug is invalid");
  }
  if (!Number.isInteger(input.rawDays) || input.rawDays < 1 || input.rawDays > 90) {
    throw error(400, "Raw retention must be between 1 and 90 days");
  }
  const existing = await db
    .prepare("SELECT 1 AS installed FROM installations WHERE state = 'complete' LIMIT 1")
    .first<{ installed: number }>();
  if (existing) throw error(409, "AlphaPing is already initialized");

  const now = Date.now();
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const dashboardId = crypto.randomUUID();
  const installationId = crypto.randomUUID();
  const passwordHash = await hashPassword(input.password);
  await db.batch([
    db
      .prepare(
        `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .bind(userId, input.name, input.email.toLowerCase(), now, now),
    db
      .prepare(
        `INSERT INTO account
          (id, account_id, provider_id, user_id, password, created_at, updated_at)
         VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), userId, userId, passwordHash, now, now),
    db
      .prepare(
        `INSERT INTO workspaces
          (id, telemetry_pk, slug, name, default_dashboard_id, created_at, updated_at)
         VALUES (?, 1, ?, ?, ?, ?, ?)`,
      )
      .bind(workspaceId, input.workspaceSlug, input.workspaceName, dashboardId, now, now),
    db
      .prepare(
        `INSERT INTO memberships
          (workspace_id, user_id, role, status, created_at, updated_at)
         VALUES (?, ?, 'admin', 'active', ?, ?)`,
      )
      .bind(workspaceId, userId, now, now),
    db
      .prepare(
        `INSERT INTO dashboards
          (id, workspace_id, slug, name, description, visibility, created_by, created_at, updated_at)
         VALUES (?, ?, 'overview', 'Overview', '', 'private', ?, ?, ?)`,
      )
      .bind(dashboardId, workspaceId, userId, now, now),
    db
      .prepare(
        `INSERT INTO retention_policies
          (workspace_id, raw_days, rollup_5m_days, rollup_1h_days, event_days, updated_at)
         VALUES (?, ?, 30, 365, 365, ?)`,
      )
      .bind(workspaceId, input.rawDays, now),
    db
      .prepare(
        `INSERT INTO installations (id, state, schema_version, created_at, completed_at)
         VALUES (?, 'complete', 1, ?, ?)`,
      )
      .bind(installationId, now, now),
  ]);
  return { workspaceSlug: input.workspaceSlug };
}
