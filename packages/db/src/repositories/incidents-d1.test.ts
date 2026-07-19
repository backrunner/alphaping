import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadIncidentCenter } from "./incidents.js";

const now = 1_752_580_800_000;

let miniflare: Miniflare;
let database: D1Database;

beforeEach(async () => {
  miniflare = new Miniflare({
    compatibilityDate: "2026-07-17",
    d1Databases: { CONTROL_DB: "incident-center-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
  });
  database = await miniflare.getD1Database("CONTROL_DB");
  await database.batch([
    database.prepare(
      `CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE memberships (
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE resource_grants (
        workspace_id TEXT NOT NULL,
        subject_user_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        effect TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE services (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE incidents (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        severity TEXT NOT NULL,
        state TEXT NOT NULL,
        starts_at INTEGER NOT NULL,
        resolved_at INTEGER,
        created_at INTEGER NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `CREATE TABLE incident_resources (
        incident_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        impact TEXT NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE incident_updates (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        state TEXT NOT NULL,
        body TEXT NOT NULL,
        published_at INTEGER,
        created_at INTEGER NOT NULL
      )`,
    ),
    database.prepare(
      `CREATE TABLE announcements (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        severity TEXT NOT NULL,
        starts_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        visibility TEXT NOT NULL,
        deleted_at INTEGER
      )`,
    ),
    database.prepare(
      `INSERT INTO workspaces VALUES ('workspace-1', 'Operations', 'operations', NULL)`,
    ),
    database.prepare(
      `INSERT INTO memberships VALUES
        ('workspace-1', 'admin-1', 'admin', 'active'),
        ('workspace-1', 'member-1', 'member', 'active')`,
    ),
    database
      .prepare(
        `INSERT INTO announcements VALUES
        ('active-public', 'workspace-1', 'Active public', 'Visible now', 'info', ?, ?, 'public', NULL),
        ('active-authenticated', 'workspace-1', 'Active authenticated', 'Visible now', 'info', ?, ?, 'authenticated', NULL),
        ('active-private', 'workspace-1', 'Active private', 'Admins only', 'info', ?, ?, 'private', NULL),
        ('future-public', 'workspace-1', 'Future public', 'Not started', 'info', ?, ?, 'public', NULL),
        ('future-private', 'workspace-1', 'Future private', 'Scheduled admin item', 'info', ?, ?, 'private', NULL),
        ('expired-public', 'workspace-1', 'Expired public', 'No longer visible', 'info', ?, ?, 'public', NULL)`,
      )
      .bind(
        now - 1_000,
        now + 60_000,
        now - 1_000,
        now + 60_000,
        now - 1_000,
        now + 60_000,
        now + 1_000,
        now + 60_000,
        now + 1_000,
        now + 60_000,
        now - 60_000,
        now,
      ),
  ]);
});

afterEach(async () => {
  await miniflare.dispose();
});

describe("incident center announcement visibility", () => {
  it("does not reveal scheduled, private, or expired announcements to members", async () => {
    const center = await loadIncidentCenter(database, "operations", "member-1", now);

    expect(center.announcements.map((announcement) => announcement.id).sort()).toEqual([
      "active-authenticated",
      "active-public",
    ]);
  });

  it("keeps scheduled and private announcements available to administrators", async () => {
    const center = await loadIncidentCenter(database, "operations", "admin-1", now);

    expect(center.announcements.map((announcement) => announcement.id).sort()).toEqual([
      "active-authenticated",
      "active-private",
      "active-public",
      "future-private",
      "future-public",
    ]);
  });
});

describe("incident center collection bounds", () => {
  it("applies service and incident visibility before collection limits", async () => {
    await database.batch([
      database.prepare(
        `WITH RECURSIVE sequence(value) AS (
           VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 201
         )
         INSERT INTO services (id, workspace_id, name, deleted_at)
         SELECT printf('service-%03d', value), 'workspace-1',
                printf('Service %03d', value), NULL FROM sequence`,
      ),
      database
        .prepare(
          `WITH RECURSIVE sequence(value) AS (
             VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 101
           )
           INSERT INTO incidents
             (id, workspace_id, title, summary, severity, state, starts_at,
              resolved_at, created_at, deleted_at)
           SELECT printf('incident-%03d', value), 'workspace-1',
                  printf('Incident %03d', value), 'Visibility bound', 'minor',
                  'monitoring', ? - value, NULL, ? - value, NULL FROM sequence`,
        )
        .bind(now, now),
      database.prepare(
        `INSERT INTO incident_resources VALUES
          ('incident-101', 'service', 'service-201', 'degraded'),
          ('incident-101', 'service', 'service-200', 'degraded')`,
      ),
      database.prepare(
        `INSERT INTO resource_grants VALUES
          ('workspace-1', 'member-1', 'service', 'service-201', 'view', 'allow'),
          ('workspace-1', 'member-1', 'service', 'service-201', 'manage', 'allow')`,
      ),
    ]);

    const center = await loadIncidentCenter(database, "operations", "member-1", now);

    expect(center.services.map((service) => service.id)).toEqual(["service-201"]);
    expect(center.incidents.map((incident) => incident.id)).toEqual(["incident-101"]);
    expect(center.incidents[0]?.affectedServices.map((service) => service.id)).toEqual([
      "service-201",
    ]);
    expect(center.incidents[0]?.canManage).toBe(false);

    await database
      .prepare(
        `INSERT INTO resource_grants VALUES
          ('workspace-1', 'member-1', 'service', 'service-200', 'manage', 'allow')`,
      )
      .run();
    await expect(
      loadIncidentCenter(database, "operations", "member-1", now),
    ).resolves.toMatchObject({
      incidents: [{ id: "incident-101", canManage: true }],
    });

    await database
      .prepare(
        `INSERT INTO resource_grants VALUES
          ('workspace-1', 'member-1', 'incident', 'incident-101', 'view', 'deny')`,
      )
      .run();
    await expect(
      loadIncidentCenter(database, "operations", "member-1", now),
    ).resolves.toMatchObject({
      incidents: [],
    });
  });

  it("batches 100 incident relations while preserving the latest 500 updates globally", async () => {
    await database.batch([
      database.prepare(
        `WITH RECURSIVE sequence(value) AS (
             VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 100
           )
           INSERT INTO services (id, workspace_id, name, deleted_at)
           SELECT printf('service-%03d', value), 'workspace-1',
                  printf('Service %03d', value), NULL FROM sequence`,
      ),
      database
        .prepare(
          `WITH RECURSIVE sequence(value) AS (
             VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 100
           )
           INSERT INTO incidents
             (id, workspace_id, title, summary, severity, state, starts_at,
              resolved_at, created_at, deleted_at)
           SELECT printf('incident-%03d', value), 'workspace-1',
                  printf('Incident %03d', value), 'Collection bound', 'minor',
                  'monitoring', ? - value, NULL, ? - value, NULL FROM sequence`,
        )
        .bind(now, now),
      database.prepare(
        `WITH RECURSIVE sequence(value) AS (
             VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 100
           )
           INSERT INTO incident_resources (incident_id, resource_type, resource_id, impact)
           SELECT printf('incident-%03d', value), 'service',
                  printf('service-%03d', value), 'degraded' FROM sequence`,
      ),
      database
        .prepare(
          `WITH RECURSIVE sequence(value) AS (
             VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 600
           )
           INSERT INTO incident_updates
             (id, incident_id, state, body, published_at, created_at)
           SELECT printf('update-%03d', value),
                  printf('incident-%03d', ((value - 1) % 100) + 1),
                  'monitoring', printf('Update %03d', value), NULL,
                  ? - (600 - value) FROM sequence`,
        )
        .bind(now),
    ]);

    const center = await loadIncidentCenter(database, "operations", "admin-1", now);
    const updateIds = center.incidents.flatMap((incident) =>
      incident.updates.map((update) => update.id),
    );

    expect(center.incidents).toHaveLength(100);
    expect(center.incidents.every((incident) => incident.affectedServices.length === 1)).toBe(true);
    expect(updateIds).toHaveLength(500);
    expect(updateIds).toContain("update-600");
    expect(updateIds).not.toContain("update-100");
    expect(center.incidents.every((incident) => incident.updates.length === 5)).toBe(true);
  });
});
