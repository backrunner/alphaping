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
  defaultSamplingIntervalSeconds: number;
  dashboardVisibility: "private" | "authenticated" | "public";
}

const MAX_TEXT_SECRET_LENGTH = 512;

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function validSetupToken(submitted: string, expected: string): Promise<boolean> {
  if (
    submitted.length < 20 ||
    submitted.length > MAX_TEXT_SECRET_LENGTH ||
    expected.length < 20 ||
    expected.length > MAX_TEXT_SECRET_LENGTH
  ) {
    return false;
  }
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(submitted)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
}

function normalizeSetupInput(input: SetupInput): SetupInput {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const workspaceName = input.workspaceName.trim();
  const workspaceSlug = input.workspaceSlug.trim();
  if (name.length < 2 || name.length > 80) {
    throw error(400, "Administrator name must contain 2 to 80 characters");
  }
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw error(400, "A valid administrator email address is required");
  }
  if (input.password.length < 12 || input.password.length > 128) {
    throw error(400, "Password must contain 12 to 128 characters");
  }
  if (workspaceName.length < 2 || workspaceName.length > 80) {
    throw error(400, "Workspace name must contain 2 to 80 characters");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(workspaceSlug)) {
    throw error(400, "Workspace slug is invalid");
  }
  if (!Number.isInteger(input.rawDays) || input.rawDays < 1 || input.rawDays > 90) {
    throw error(400, "Raw retention must be between 1 and 90 days");
  }
  if (
    !Number.isInteger(input.defaultSamplingIntervalSeconds) ||
    input.defaultSamplingIntervalSeconds < 5 ||
    input.defaultSamplingIntervalSeconds > 300 ||
    60 % input.defaultSamplingIntervalSeconds !== 0
  ) {
    throw error(400, "Default sampling interval must divide the 60 second report period");
  }
  if (
    !("private authenticated public".split(" ") as string[]).includes(input.dashboardVisibility)
  ) {
    throw error(400, "Dashboard visibility is invalid");
  }
  return { ...input, name, email, workspaceName, workspaceSlug };
}

export async function initializeInstallation(
  db: D1Database,
  expectedToken: string,
  input: SetupInput,
): Promise<{ workspaceSlug: string }> {
  if (!(await validSetupToken(input.token, expectedToken))) throw error(403, "Invalid setup token");
  const normalized = normalizeSetupInput(input);
  const existing = await db
    .prepare("SELECT 1 AS installed FROM installations WHERE state = 'complete' LIMIT 1")
    .first<{ installed: number }>();
  if (existing) throw error(409, "AlphaPing is already initialized");

  const now = Date.now();
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const dashboardId = crypto.randomUUID();
  const installationId = crypto.randomUUID();
  const passwordHash = await hashPassword(normalized.password);
  try {
    await db.batch([
      db.prepare(
        `UPDATE telemetry_resource_sequences SET value = 1
         WHERE kind = 'workspace' AND value = 0`,
      ),
      db
        .prepare(
          `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
        )
        .bind(userId, normalized.name, normalized.email, now, now),
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
          (id, telemetry_pk, slug, name, default_dashboard_id,
           default_sampling_interval_seconds, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          workspaceId,
          1,
          normalized.workspaceSlug,
          normalized.workspaceName,
          dashboardId,
          normalized.defaultSamplingIntervalSeconds,
          now,
          now,
        ),
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
         VALUES (?, ?, 'overview', 'Overview', '', ?, ?, ?, ?)`,
        )
        .bind(dashboardId, workspaceId, normalized.dashboardVisibility, userId, now, now),
      db
        .prepare(
          `INSERT INTO retention_policies
          (workspace_id, raw_days, rollup_5m_days, rollup_1h_days, event_days, updated_at)
         VALUES (?, ?, 30, 365, 365, ?)`,
        )
        .bind(workspaceId, normalized.rawDays, now),
      db
        .prepare(
          `INSERT INTO installations (id, state, schema_version, created_at, completed_at)
         VALUES (?, 'complete', 1, ?, ?)`,
        )
        .bind(installationId, now, now),
    ]);
  } catch (cause) {
    const completed = await db
      .prepare("SELECT 1 AS installed FROM installations WHERE state = 'complete' LIMIT 1")
      .first<{ installed: number }>()
      .catch(() => null);
    if (completed) throw error(409, "AlphaPing is already initialized");
    throw cause;
  }
  return { workspaceSlug: normalized.workspaceSlug };
}
