import { error } from "@sveltejs/kit";

import {
  prepareAuditStatement,
  requireWorkspaceAdmin,
  requireWorkspaceResource,
  type WorkspaceResourceType,
} from "./workspace-admin.js";

export type DashboardVisibility = "private" | "authenticated" | "public";
export type ProjectionProfile = "summary" | "detailed";

interface DashboardRow {
  id: string;
  visibility: DashboardVisibility;
}

interface PublicResourceRow {
  resource_type: WorkspaceResourceType;
  resource_id: string;
  name: string;
  effect: "allow" | "deny" | null;
  projection_profile: ProjectionProfile | null;
}

interface RetentionRow {
  raw_days: number;
  rollup_5m_days: number;
  rollup_1h_days: number;
  event_days: number;
  audit_log_days: number;
  expired_announcement_grace_days: number;
  soft_delete_grace_days: number;
}

export interface RetentionSettings {
  rawDays: number;
  rollup5mDays: number;
  rollup1hDays: number;
  eventDays: number;
  auditLogDays: number;
  expiredAnnouncementGraceDays: number;
  softDeleteGraceDays: number;
}

export interface PublicResourceSetting {
  id: string;
  type: WorkspaceResourceType;
  name: string;
  effect: "allow" | "deny";
  projectionProfile: ProjectionProfile;
}

export interface WorkspaceSettingsPanel {
  dashboardVisibility: DashboardVisibility;
  resources: readonly PublicResourceSetting[];
  retention: RetentionSettings;
  estimatedStorageGb: number;
}

export function estimateTelemetryStorageGb(input: {
  machineCount: number;
  checkCount: number;
  retention: Pick<RetentionSettings, "rawDays" | "rollup5mDays" | "rollup1hDays">;
}): number {
  const rawBytesPerDay = input.machineCount * 1_440 * 2_048 + input.checkCount * 1_440 * 512;
  const rollup5mBytesPerDay = (input.machineCount + input.checkCount) * 288 * 320;
  const rollup1hBytesPerDay = (input.machineCount + input.checkCount) * 24 * 320;
  return (
    (rawBytesPerDay * input.retention.rawDays +
      rollup5mBytesPerDay * input.retention.rollup5mDays +
      rollup1hBytesPerDay * input.retention.rollup1hDays) /
    1_000_000_000
  );
}

export async function loadWorkspaceSettingsPanel(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
): Promise<WorkspaceSettingsPanel> {
  const access = await requireWorkspaceAdmin(db, workspaceSlug, userId);
  const [dashboard, resources, retention, counts] = await Promise.all([
    db
      .prepare(
        `SELECT d.id, d.visibility FROM dashboards d
         WHERE d.id = ? AND d.workspace_id = ? AND d.deleted_at IS NULL`,
      )
      .bind(access.defaultDashboardId, access.workspaceId)
      .first<DashboardRow>(),
    db
      .prepare(
        `SELECT r.resource_type, r.resource_id, r.name, p.effect, p.projection_profile
         FROM (
           SELECT 'machine' AS resource_type, id AS resource_id, name FROM machines
           WHERE workspace_id = ? AND deleted_at IS NULL
           UNION ALL
           SELECT 'service' AS resource_type, id AS resource_id, name FROM services
           WHERE workspace_id = ? AND deleted_at IS NULL
           UNION ALL
           SELECT 'container' AS resource_type, id AS resource_id, name FROM containers
           WHERE workspace_id = ? AND deleted_at IS NULL
         ) r
         LEFT JOIN resource_public_policies p
           ON p.workspace_id = ? AND p.resource_type = r.resource_type AND p.resource_id = r.resource_id
         ORDER BY r.resource_type, r.name LIMIT 300`,
      )
      .bind(access.workspaceId, access.workspaceId, access.workspaceId, access.workspaceId)
      .all<PublicResourceRow>(),
    db
      .prepare(
        `SELECT raw_days, rollup_5m_days, rollup_1h_days, event_days, audit_log_days,
                expired_announcement_grace_days, soft_delete_grace_days
         FROM retention_policies WHERE workspace_id = ?`,
      )
      .bind(access.workspaceId)
      .first<RetentionRow>(),
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM machines WHERE workspace_id = ? AND deleted_at IS NULL) AS machines,
           (SELECT COUNT(*) FROM check_configs WHERE workspace_id = ? AND enabled = 1) AS checks`,
      )
      .bind(access.workspaceId, access.workspaceId)
      .first<{ machines: number; checks: number }>(),
  ]);
  if (!dashboard || !retention || !counts) throw error(500, "Workspace settings are incomplete");
  const retentionSettings: RetentionSettings = {
    rawDays: retention.raw_days,
    rollup5mDays: retention.rollup_5m_days,
    rollup1hDays: retention.rollup_1h_days,
    eventDays: retention.event_days,
    auditLogDays: retention.audit_log_days,
    expiredAnnouncementGraceDays: retention.expired_announcement_grace_days,
    softDeleteGraceDays: retention.soft_delete_grace_days,
  };
  return {
    dashboardVisibility: dashboard.visibility,
    resources: resources.results.map((resource) => ({
      id: resource.resource_id,
      type: resource.resource_type,
      name: resource.name,
      effect: resource.effect ?? "deny",
      projectionProfile: resource.projection_profile ?? "summary",
    })),
    retention: retentionSettings,
    estimatedStorageGb: estimateTelemetryStorageGb({
      machineCount: counts.machines,
      checkCount: counts.checks,
      retention: retentionSettings,
    }),
  };
}

export async function updateDashboardVisibility(
  db: D1Database,
  workspaceSlug: string,
  actorUserId: string,
  visibility: DashboardVisibility,
): Promise<void> {
  if (!(["private", "authenticated", "public"] as const).includes(visibility)) {
    throw error(400, "Dashboard visibility is invalid");
  }
  const access = await requireWorkspaceAdmin(db, workspaceSlug, actorUserId);
  const current = await db
    .prepare(
      `SELECT visibility FROM dashboards WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(access.defaultDashboardId, access.workspaceId)
    .first<{ visibility: DashboardVisibility }>();
  if (!current) throw error(404, "Dashboard not found");
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE dashboards SET visibility = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
      )
      .bind(visibility, now, access.defaultDashboardId, access.workspaceId),
    await prepareAuditStatement(db, {
      workspaceId: access.workspaceId,
      actorUserId,
      action: "dashboard.visibility.update",
      resourceType: "dashboard",
      resourceId: access.defaultDashboardId,
      before: current,
      after: { visibility },
      now,
    }),
  ]);
}

export async function updateResourcePublicPolicy(
  db: D1Database,
  workspaceSlug: string,
  actorUserId: string,
  input: {
    resourceType: WorkspaceResourceType;
    resourceId: string;
    effect: "allow" | "deny";
    projectionProfile: ProjectionProfile;
  },
): Promise<void> {
  if (!(["machine", "service", "container"] as const).includes(input.resourceType)) {
    throw error(400, "Resource type is invalid");
  }
  if (!(["allow", "deny"] as const).includes(input.effect)) {
    throw error(400, "Public access setting is invalid");
  }
  if (!(["summary", "detailed"] as const).includes(input.projectionProfile)) {
    throw error(400, "Projection profile is invalid");
  }
  const access = await requireWorkspaceAdmin(db, workspaceSlug, actorUserId);
  await requireWorkspaceResource(db, access.workspaceId, input.resourceType, input.resourceId);
  const current = await db
    .prepare(
      `SELECT effect, projection_profile FROM resource_public_policies
       WHERE workspace_id = ? AND resource_type = ? AND resource_id = ?`,
    )
    .bind(access.workspaceId, input.resourceType, input.resourceId)
    .first<{ effect: "allow" | "deny"; projection_profile: ProjectionProfile }>();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO resource_public_policies
          (workspace_id, resource_type, resource_id, effect, projection_profile, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, resource_type, resource_id) DO UPDATE SET
           effect = excluded.effect, projection_profile = excluded.projection_profile,
           updated_at = excluded.updated_at`,
      )
      .bind(
        access.workspaceId,
        input.resourceType,
        input.resourceId,
        input.effect,
        input.projectionProfile,
        now,
      ),
  ];
  if (input.resourceType !== "container") {
    statements.push(
      db
        .prepare(
          `INSERT INTO dashboard_resources
            (dashboard_id, resource_type, resource_id, sort_order, public_override)
           VALUES (?, ?, ?, 0, ?)
           ON CONFLICT(dashboard_id, resource_type, resource_id) DO UPDATE SET
             public_override = excluded.public_override`,
        )
        .bind(
          access.defaultDashboardId,
          input.resourceType,
          input.resourceId,
          input.effect === "allow" ? "allow" : "deny",
        ),
    );
  }
  statements.push(
    await prepareAuditStatement(db, {
      workspaceId: access.workspaceId,
      actorUserId,
      action: "resource_public_policy.update",
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      before: current,
      after: { effect: input.effect, projectionProfile: input.projectionProfile },
      now,
    }),
  );
  await db.batch(statements);
}

function validateRetention(input: RetentionSettings): void {
  const ranges: readonly [number, number, number, string][] = [
    [input.rawDays, 1, 90, "Raw retention"],
    [input.rollup5mDays, 7, 365, "Five-minute retention"],
    [input.rollup1hDays, 30, 3_650, "Hourly retention"],
    [input.eventDays, 30, 3_650, "Event retention"],
    [input.auditLogDays, 30, 3_650, "Audit retention"],
    [input.expiredAnnouncementGraceDays, 1, 90, "Announcement grace"],
    [input.softDeleteGraceDays, 1, 90, "Soft-delete grace"],
  ];
  for (const [value, minimum, maximum, label] of ranges) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw error(400, `${label} must be between ${minimum} and ${maximum} days`);
    }
  }
}

export async function updateRetentionSettings(
  db: D1Database,
  workspaceSlug: string,
  actorUserId: string,
  retention: RetentionSettings,
): Promise<void> {
  validateRetention(retention);
  const access = await requireWorkspaceAdmin(db, workspaceSlug, actorUserId);
  const current = await db
    .prepare(
      `SELECT raw_days, rollup_5m_days, rollup_1h_days, event_days, audit_log_days,
              expired_announcement_grace_days, soft_delete_grace_days
       FROM retention_policies WHERE workspace_id = ?`,
    )
    .bind(access.workspaceId)
    .first<RetentionRow>();
  if (!current) throw error(404, "Retention policy not found");
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE retention_policies SET
           raw_days = ?, rollup_5m_days = ?, rollup_1h_days = ?, event_days = ?,
           audit_log_days = ?, expired_announcement_grace_days = ?,
           soft_delete_grace_days = ?, updated_at = ?
         WHERE workspace_id = ?`,
      )
      .bind(
        retention.rawDays,
        retention.rollup5mDays,
        retention.rollup1hDays,
        retention.eventDays,
        retention.auditLogDays,
        retention.expiredAnnouncementGraceDays,
        retention.softDeleteGraceDays,
        now,
        access.workspaceId,
      ),
    await prepareAuditStatement(db, {
      workspaceId: access.workspaceId,
      actorUserId,
      action: "retention_policy.update",
      resourceType: "workspace",
      resourceId: access.workspaceId,
      before: current,
      after: retention,
      now,
    }),
  ]);
}
