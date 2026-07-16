import { error } from "@sveltejs/kit";

import { loadMonitoringAccess, requireAdmin, type MonitoringAccess } from "./monitoring-access.js";

export type WorkspaceResourceType = "machine" | "service" | "container";

export async function requireWorkspaceAdmin(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
): Promise<MonitoringAccess> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireAdmin(access);
  return access;
}

function normalizedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizedJson(nested)]),
    );
  }
  return value;
}

export async function auditDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(normalizedJson(value)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function prepareAuditStatement(
  db: D1Database,
  input: {
    workspaceId: string;
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    before: unknown;
    after: unknown;
    now: number;
  },
): Promise<D1PreparedStatement> {
  const [beforeDigest, afterDigest] = await Promise.all([
    input.before === null ? null : auditDigest(input.before),
    input.after === null ? null : auditDigest(input.after),
  ]);
  return db
    .prepare(
      `INSERT INTO audit_logs
        (id, workspace_id, actor_user_id, action, resource_type, resource_id,
         before_digest, after_digest, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.workspaceId,
      input.actorUserId,
      input.action,
      input.resourceType,
      input.resourceId,
      beforeDigest,
      afterDigest,
      input.now,
    );
}

export async function requireWorkspaceResource(
  db: D1Database,
  workspaceId: string,
  resourceType: WorkspaceResourceType,
  resourceId: string,
): Promise<void> {
  const table =
    resourceType === "machine"
      ? "machines"
      : resourceType === "service"
        ? "services"
        : "containers";
  const resource = await db
    .prepare(
      `SELECT 1 AS present FROM ${table} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(resourceId, workspaceId)
    .first<{ present: number }>();
  if (!resource) throw error(404, "Resource not found");
}

export function maskEmail(email: string): string {
  const separator = email.lastIndexOf("@");
  if (separator <= 0) return "***";
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(2, Math.min(6, local.length - visible.length)))}@${domain}`;
}

export function safeLocalPath(value: string | null, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  return value;
}
