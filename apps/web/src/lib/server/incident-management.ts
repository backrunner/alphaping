import { canAccessIncident, canAccessResource } from "@alphaping/authz";
import { error } from "@sveltejs/kit";

import {
  finalAdminCondition,
  finalResourceCapabilityCondition,
  loadMonitoringAccess,
  requireAdmin,
  type FinalAuthorizationCondition,
  type MonitoringAccess,
} from "./monitoring-access.js";

type IncidentState = "investigating" | "identified" | "monitoring" | "resolved";
type IncidentSeverity = "minor" | "major" | "critical";

const MAX_INCIDENT_SERVICES = 20;

interface IncidentResourceRow {
  resource_id: string;
}

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(", ");
}

function validText(value: string, minimum: number, maximum: number, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum) {
    throw error(400, `${label} must contain between ${minimum} and ${maximum} characters`);
  }
  return trimmed;
}

function finalServiceSetManageCondition(
  access: MonitoringAccess,
  actorUserId: string,
  serviceIds: readonly string[],
): FinalAuthorizationCondition {
  const servicePlaceholders = placeholders(serviceIds.length);
  if (access.role === "admin") {
    return {
      sql: `EXISTS (
        SELECT 1 FROM memberships actor
        WHERE actor.workspace_id = ? AND actor.user_id = ?
          AND actor.role = 'admin' AND actor.status = 'active'
      )
      AND (
        SELECT COUNT(*) FROM services current
        WHERE current.workspace_id = ? AND current.deleted_at IS NULL
          AND current.id IN (${servicePlaceholders})
      ) = ?`,
      binds: [
        access.workspaceId,
        actorUserId,
        access.workspaceId,
        ...serviceIds,
        serviceIds.length,
      ],
    };
  }
  return {
    sql: `EXISTS (
      SELECT 1 FROM memberships actor
      WHERE actor.workspace_id = ? AND actor.user_id = ?
        AND actor.role = 'member' AND actor.status = 'active'
    )
    AND (
      SELECT COUNT(*) FROM services current
      WHERE current.workspace_id = ? AND current.deleted_at IS NULL
        AND current.id IN (${servicePlaceholders})
        AND EXISTS (
          SELECT 1 FROM resource_grants allowed
          WHERE allowed.workspace_id = current.workspace_id AND allowed.subject_user_id = ?
            AND allowed.resource_type = 'service' AND allowed.resource_id = current.id
            AND allowed.capability = 'manage' AND allowed.effect = 'allow'
        )
        AND NOT EXISTS (
          SELECT 1 FROM resource_grants denied
          WHERE denied.workspace_id = current.workspace_id AND denied.subject_user_id = ?
            AND denied.resource_type = 'service' AND denied.resource_id = current.id
            AND denied.capability IN ('view', 'manage') AND denied.effect = 'deny'
        )
    ) = ?`,
    binds: [
      access.workspaceId,
      actorUserId,
      access.workspaceId,
      ...serviceIds,
      actorUserId,
      actorUserId,
      serviceIds.length,
    ],
  };
}

export async function createIncident(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  input: {
    title: string;
    summary: string;
    severity: IncidentSeverity;
    serviceIds: readonly string[];
    impact: "degraded" | "down";
    startsAt: number;
  },
): Promise<{ incidentId: string }> {
  const serviceIds = [...new Set(input.serviceIds)];
  if (serviceIds.length === 0) throw error(400, "Select at least one affected service");
  if (serviceIds.length > MAX_INCIDENT_SERVICES) {
    throw error(400, `An incident can affect at most ${MAX_INCIDENT_SERVICES} services`);
  }
  if (!(["minor", "major", "critical"] as const).includes(input.severity)) {
    throw error(400, "Incident severity is invalid");
  }
  if (input.impact !== "degraded" && input.impact !== "down") {
    throw error(400, "Incident impact is invalid");
  }
  const now = Date.now();
  if (
    !Number.isSafeInteger(input.startsAt) ||
    input.startsAt < now - 365 * 24 * 60 * 60_000 ||
    input.startsAt > now + 30 * 24 * 60 * 60_000
  ) {
    throw error(400, "Incident start time is outside the allowed range");
  }
  const title = validText(input.title, 2, 120, "Incident title");
  const summary = validText(input.summary, 2, 2_000, "Incident summary");
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  const services = await db
    .prepare(
      `SELECT id FROM services WHERE workspace_id = ? AND deleted_at IS NULL
     AND id IN (${placeholders(serviceIds.length)})`,
    )
    .bind(access.workspaceId, ...serviceIds)
    .all<{ id: string }>();
  if (
    services.results.length !== serviceIds.length ||
    serviceIds.some(
      (serviceId) => !canAccessResource(access.role, access.grants, "service", serviceId, "manage"),
    )
  ) {
    throw error(404, "Service not found");
  }
  const incidentId = crypto.randomUUID();
  const authorization = finalServiceSetManageCondition(access, userId, serviceIds);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO incidents
        (id, workspace_id, title, summary, severity, state, starts_at,
         created_by, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 'investigating', ?, ?, ?, ?
       WHERE ${authorization.sql}`,
      )
      .bind(
        incidentId,
        access.workspaceId,
        title,
        summary,
        input.severity,
        input.startsAt,
        userId,
        now,
        now,
        ...authorization.binds,
      ),
    db
      .prepare(
        `INSERT INTO incident_updates
        (id, incident_id, state, body, published_at, created_by, created_at)
       SELECT ?, ?, 'investigating', ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM incidents created WHERE created.id = ? AND created.workspace_id = ?
       )`,
      )
      .bind(
        crypto.randomUUID(),
        incidentId,
        summary,
        now,
        userId,
        now,
        incidentId,
        access.workspaceId,
      ),
  ];
  for (const serviceId of serviceIds) {
    statements.push(
      db
        .prepare(
          `INSERT INTO incident_resources (incident_id, resource_type, resource_id, impact)
       SELECT ?, 'service', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM incidents created WHERE created.id = ? AND created.workspace_id = ?
       )`,
        )
        .bind(incidentId, serviceId, input.impact, incidentId, access.workspaceId),
    );
  }
  const results = await db.batch(statements);
  if (results[0]?.meta.changes !== 1) {
    throw error(409, "Incident access changed; reload and try again");
  }
  return { incidentId };
}

export async function appendIncidentUpdate(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  incidentId: string,
  input: { state: IncidentState; body: string },
): Promise<void> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  const incident = await db
    .prepare(`SELECT id FROM incidents WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`)
    .bind(incidentId, access.workspaceId)
    .first<{ id: string }>();
  if (!incident) throw error(404, "Incident not found");
  const resources = await db
    .prepare(
      `SELECT resource_id FROM incident_resources
     WHERE incident_id = ? AND resource_type = 'service'
     LIMIT ${MAX_INCIDENT_SERVICES + 1}`,
    )
    .bind(incidentId)
    .all<IncidentResourceRow>();
  if (resources.results.length > MAX_INCIDENT_SERVICES) {
    throw error(503, "Incident resource scope exceeds the supported limit");
  }
  const canManageIncident = canAccessIncident(
    access.role,
    access.grants,
    incidentId,
    "manage",
    resources.results.length > 0 &&
      resources.results.every((resource) =>
        canAccessResource(access.role, access.grants, "service", resource.resource_id, "manage"),
      ),
  );
  if (!canManageIncident) throw error(404, "Incident not found");
  const directIncidentAccess = canAccessIncident(
    access.role,
    access.grants,
    incidentId,
    "manage",
    false,
  );
  if (!(["investigating", "identified", "monitoring", "resolved"] as const).includes(input.state)) {
    throw error(400, "Incident state is invalid");
  }
  const body = validText(input.body, 2, 4_000, "Incident update");
  const now = Date.now();
  const authorization = directIncidentAccess
    ? finalResourceCapabilityCondition(
        access,
        userId,
        "incident",
        "incidents.workspace_id",
        "incidents.id",
        "manage",
      )
    : finalServiceSetManageCondition(
        access,
        userId,
        resources.results.map((resource) => resource.resource_id),
      );
  const results = await db.batch([
    db
      .prepare(
        `UPDATE incidents SET state = ?, resolved_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
         AND ${authorization.sql}`,
      )
      .bind(
        input.state,
        input.state === "resolved" ? now : null,
        now,
        incidentId,
        access.workspaceId,
        ...authorization.binds,
      ),
    db
      .prepare(
        `INSERT INTO incident_updates
        (id, incident_id, state, body, published_at, created_by, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
      )
      .bind(crypto.randomUUID(), incidentId, input.state, body, now, userId, now),
  ]);
  if (results[0]?.meta.changes !== 1) {
    throw error(409, "Incident access changed; reload and try again");
  }
}

export async function createAnnouncement(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  input: {
    title: string;
    body: string;
    severity: "info" | "maintenance" | "minor" | "major" | "critical";
    visibility: "private" | "authenticated" | "public";
    startsAt: number;
    expiresAt: number;
  },
): Promise<void> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireAdmin(access);
  if (
    !(["info", "maintenance", "minor", "major", "critical"] as const).includes(input.severity) ||
    !(["private", "authenticated", "public"] as const).includes(input.visibility)
  ) {
    throw error(400, "Announcement options are invalid");
  }
  if (
    !Number.isSafeInteger(input.startsAt) ||
    !Number.isSafeInteger(input.expiresAt) ||
    input.expiresAt <= input.startsAt ||
    input.expiresAt - input.startsAt > 365 * 24 * 60 * 60_000
  ) {
    throw error(400, "Announcement expiry must be after its start and within one year");
  }
  const now = Date.now();
  const authorization = finalAdminCondition(userId, "?12");
  const result = await db
    .prepare(
      `INSERT INTO announcements
      (id, workspace_id, title, body, severity, visibility, starts_at, expires_at,
       created_by, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${authorization.sql}`,
    )
    .bind(
      crypto.randomUUID(),
      access.workspaceId,
      validText(input.title, 2, 120, "Announcement title"),
      validText(input.body, 2, 4_000, "Announcement body"),
      input.severity,
      input.visibility,
      input.startsAt,
      input.expiresAt,
      userId,
      now,
      now,
      access.workspaceId,
      ...authorization.binds,
    )
    .run();
  if (result.meta.changes !== 1) {
    throw error(409, "Workspace access changed; reload and try again");
  }
}
