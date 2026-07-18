import { canAccessResource } from "@alphaping/authz";
import { error } from "@sveltejs/kit";

import { loadMonitoringAccess, requireAdmin } from "./monitoring-access.js";

type IncidentState = "investigating" | "identified" | "monitoring" | "resolved";
type IncidentSeverity = "minor" | "major" | "critical";

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
  if (serviceIds.length > 20) throw error(400, "An incident can affect at most 20 services");
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
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO incidents
        (id, workspace_id, title, summary, severity, state, starts_at,
         created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'investigating', ?, ?, ?, ?)`,
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
      ),
    db
      .prepare(
        `INSERT INTO incident_updates
        (id, incident_id, state, body, published_at, created_by, created_at)
       VALUES (?, ?, 'investigating', ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), incidentId, summary, now, userId, now),
  ];
  for (const serviceId of serviceIds) {
    statements.push(
      db
        .prepare(
          `INSERT INTO incident_resources (incident_id, resource_type, resource_id, impact)
       VALUES (?, 'service', ?, ?)`,
        )
        .bind(incidentId, serviceId, input.impact),
    );
  }
  await db.batch(statements);
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
     WHERE incident_id = ? AND resource_type = 'service'`,
    )
    .bind(incidentId)
    .all<IncidentResourceRow>();
  const canManageIncident =
    canAccessResource(access.role, access.grants, "incident", incidentId, "manage") ||
    (resources.results.length > 0 &&
      resources.results.every((resource) =>
        canAccessResource(access.role, access.grants, "service", resource.resource_id, "manage"),
      ));
  if (!canManageIncident) throw error(404, "Incident not found");
  if (!(["investigating", "identified", "monitoring", "resolved"] as const).includes(input.state)) {
    throw error(400, "Incident state is invalid");
  }
  const body = validText(input.body, 2, 4_000, "Incident update");
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO incident_updates
        (id, incident_id, state, body, published_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), incidentId, input.state, body, now, userId, now),
    db
      .prepare(
        `UPDATE incidents SET state = ?, resolved_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
      )
      .bind(
        input.state,
        input.state === "resolved" ? now : null,
        now,
        incidentId,
        access.workspaceId,
      ),
  ]);
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
  await db
    .prepare(
      `INSERT INTO announcements
      (id, workspace_id, title, body, severity, visibility, starts_at, expires_at,
       created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    )
    .run();
}
