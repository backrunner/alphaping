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
