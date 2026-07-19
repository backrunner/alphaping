import { d1BlobToArrayBuffer } from "@alphaping/contracts";

import type { NotificationDimension, NotificationPayload, ResourceType } from "./types.js";

const EVENT_LIMIT = 100;
const INSERT_BATCH = 50;
const MAX_MATCHED_RULES = 2_000;

interface CursorRow {
  last_occurred_at: number;
  last_event_id: unknown;
  last_resource_type: number;
  last_resource_pk: number;
  updated_at: number;
}

interface StateEventRow {
  workspace_pk: number;
  resource_type: 1 | 2;
  resource_pk: number;
  occurred_at: number;
  event_id: unknown;
  event_id_hex: string;
  previous_state: string;
  current_state: string;
  reason_code: string;
}

interface ResourceRow {
  telemetry_pk: number;
  id: string;
  name: string;
  workspace_id: string;
  workspace_pk: number;
  workspace_name: string;
}

interface RuleRow {
  workspace_id: string;
  resource_type: ResourceType;
  resource_id: string;
  dimension: NotificationDimension;
  channel_id: string;
}

interface ResolvedResource {
  type: ResourceType;
  id: string;
  name: string;
  workspaceId: string;
  workspacePk: number;
  workspaceName: string;
}

interface DeliveryInsert {
  id: string;
  workspaceId: string;
  channelId: string;
  event: StateEventRow;
  dimension: NotificationDimension;
  payload: NotificationPayload;
}

export function dimensionForEvent(
  event: Pick<StateEventRow, "current_state" | "reason_code">,
): NotificationDimension {
  if (event.current_state === "healthy") return "recovery";
  if (event.reason_code === "resource_threshold") return "resource";
  return "availability";
}

function resourceType(value: 1 | 2): ResourceType {
  return value === 1 ? "machine" : "service";
}

function resourceKey(type: ResourceType, workspacePk: number, resourcePk: number): string {
  return `${type}:${workspacePk}:${resourcePk}`;
}

function ruleKey(
  workspaceId: string,
  type: ResourceType,
  resourceId: string,
  dimension: NotificationDimension,
): string {
  return `${workspaceId}:${type}:${resourceId}:${dimension}`;
}

async function digestId(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadCursor(db: D1Database): Promise<CursorRow> {
  const cursor = await db
    .prepare(
      `SELECT last_occurred_at, last_event_id, last_resource_type, last_resource_pk, updated_at
       FROM notification_event_cursors WHERE singleton = 1`,
    )
    .first<CursorRow>();
  if (!cursor) throw new Error("notification_cursor_missing");
  return cursor;
}

async function newestEvent(db: D1Database): Promise<StateEventRow | null> {
  return db
    .prepare(
      `SELECT workspace_pk, resource_type, resource_pk, occurred_at, event_id,
              hex(event_id) AS event_id_hex, previous_state, current_state, reason_code
       FROM state_events
       ORDER BY occurred_at DESC, event_id DESC, resource_type DESC, resource_pk DESC
       LIMIT 1`,
    )
    .first<StateEventRow>();
}

async function updateCursor(
  db: D1Database,
  event: StateEventRow | null,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE notification_event_cursors
       SET last_occurred_at = ?, last_event_id = ?, last_resource_type = ?,
           last_resource_pk = ?, updated_at = ?
       WHERE singleton = 1`,
    )
    .bind(
      event?.occurred_at ?? 0,
      event ? d1BlobToArrayBuffer(event.event_id) : new Uint8Array().buffer,
      event?.resource_type ?? 0,
      event?.resource_pk ?? 0,
      now,
    )
    .run();
}

async function loadEvents(db: D1Database, cursor: CursorRow): Promise<StateEventRow[]> {
  const eventId = d1BlobToArrayBuffer(cursor.last_event_id);
  const result = await db
    .prepare(
      `SELECT workspace_pk, resource_type, resource_pk, occurred_at, event_id,
              hex(event_id) AS event_id_hex, previous_state, current_state, reason_code
       FROM state_events
       WHERE occurred_at > ?
          OR (occurred_at = ? AND event_id > ?)
          OR (occurred_at = ? AND event_id = ? AND resource_type > ?)
          OR (occurred_at = ? AND event_id = ? AND resource_type = ? AND resource_pk > ?)
       ORDER BY occurred_at, event_id, resource_type, resource_pk
       LIMIT ?`,
    )
    .bind(
      cursor.last_occurred_at,
      cursor.last_occurred_at,
      eventId,
      cursor.last_occurred_at,
      eventId,
      cursor.last_resource_type,
      cursor.last_occurred_at,
      eventId,
      cursor.last_resource_type,
      cursor.last_resource_pk,
      EVENT_LIMIT,
    )
    .all<StateEventRow>();
  return result.results;
}

async function loadResourceRows(
  db: D1Database,
  table: "machines" | "services",
  telemetryPks: readonly number[],
): Promise<ResourceRow[]> {
  if (telemetryPks.length === 0) return [];
  const placeholders = telemetryPks.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT resource.telemetry_pk, resource.id, resource.name, resource.workspace_id,
              workspace.telemetry_pk AS workspace_pk, workspace.name AS workspace_name
       FROM ${table} resource
       JOIN workspaces workspace ON workspace.id = resource.workspace_id
       WHERE resource.telemetry_pk IN (${placeholders})
         AND resource.deleted_at IS NULL AND workspace.deleted_at IS NULL`,
    )
    .bind(...telemetryPks)
    .all<ResourceRow>();
  return result.results;
}

async function resolveResources(
  db: D1Database,
  events: readonly StateEventRow[],
): Promise<Map<string, ResolvedResource>> {
  const machinePks = [
    ...new Set(
      events.filter((event) => event.resource_type === 1).map((event) => event.resource_pk),
    ),
  ];
  const servicePks = [
    ...new Set(
      events.filter((event) => event.resource_type === 2).map((event) => event.resource_pk),
    ),
  ];
  const [machines, services] = await Promise.all([
    loadResourceRows(db, "machines", machinePks),
    loadResourceRows(db, "services", servicePks),
  ]);
  const resolved = new Map<string, ResolvedResource>();
  for (const [type, rows] of [
    ["machine", machines],
    ["service", services],
  ] as const) {
    for (const row of rows) {
      resolved.set(resourceKey(type, row.workspace_pk, row.telemetry_pk), {
        type,
        id: row.id,
        name: row.name,
        workspaceId: row.workspace_id,
        workspacePk: row.workspace_pk,
        workspaceName: row.workspace_name,
      });
    }
  }
  return resolved;
}

async function loadRules(
  db: D1Database,
  resources: ReadonlyMap<string, ResolvedResource>,
): Promise<Map<string, RuleRow[]>> {
  const ids = [...new Set([...resources.values()].map((resource) => resource.id))];
  const workspaceIds = [
    ...new Set([...resources.values()].map((resource) => resource.workspaceId)),
  ];
  if (ids.length === 0) return new Map();
  const result = await db
    .prepare(
      `SELECT rule.workspace_id, rule.resource_type, rule.resource_id,
              rule.dimension, rule.channel_id
       FROM notification_rules rule
       JOIN notification_channels channel
         ON channel.id = rule.channel_id AND channel.workspace_id = rule.workspace_id
       WHERE rule.workspace_id IN (${workspaceIds.map(() => "?").join(", ")})
         AND rule.resource_id IN (${ids.map(() => "?").join(", ")})
         AND rule.enabled = 1 AND channel.enabled = 1
       ORDER BY rule.resource_type, rule.resource_id, rule.dimension, rule.channel_id
       LIMIT ?`,
    )
    .bind(...workspaceIds, ...ids, MAX_MATCHED_RULES + 1)
    .all<RuleRow>();
  if (result.results.length > MAX_MATCHED_RULES) {
    throw new Error("notification_rule_batch_exceeded");
  }
  const rules = new Map<string, RuleRow[]>();
  for (const row of result.results) {
    const key = ruleKey(row.workspace_id, row.resource_type, row.resource_id, row.dimension);
    rules.set(key, [...(rules.get(key) ?? []), row]);
  }
  return rules;
}

async function prepareDeliveries(
  events: readonly StateEventRow[],
  resources: ReadonlyMap<string, ResolvedResource>,
  rules: ReadonlyMap<string, RuleRow[]>,
): Promise<DeliveryInsert[]> {
  const pending: Promise<DeliveryInsert>[] = [];
  for (const event of events) {
    const type = resourceType(event.resource_type);
    const resource = resources.get(resourceKey(type, event.workspace_pk, event.resource_pk));
    if (!resource) continue;
    const dimension = dimensionForEvent(event);
    for (const rule of rules.get(ruleKey(resource.workspaceId, type, resource.id, dimension)) ??
      []) {
      const payload: NotificationPayload = {
        workspace: resource.workspaceName,
        resourceType: type,
        resourceName: resource.name,
        dimension,
        previousState: event.previous_state,
        currentState: event.current_state,
        reasonCode: event.reason_code,
        occurredAt: event.occurred_at,
      };
      const identity = [
        rule.channel_id,
        event.workspace_pk,
        event.resource_type,
        event.resource_pk,
        event.occurred_at,
        event.event_id_hex,
      ].join(":");
      pending.push(
        digestId(identity).then((id) => ({
          id,
          workspaceId: resource.workspaceId,
          channelId: rule.channel_id,
          event,
          dimension,
          payload,
        })),
      );
    }
  }
  return Promise.all(pending);
}

async function persistDeliveries(
  db: D1Database,
  deliveries: readonly DeliveryInsert[],
  now: number,
): Promise<void> {
  for (let offset = 0; offset < deliveries.length; offset += INSERT_BATCH) {
    const batch = deliveries.slice(offset, offset + INSERT_BATCH).map((delivery) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO notification_deliveries
            (id, workspace_id, channel_id, source_workspace_pk, source_resource_type,
             source_resource_pk, source_occurred_at, source_event_id, dimension, payload_json,
             state, attempt_count, next_attempt_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
        )
        .bind(
          delivery.id,
          delivery.workspaceId,
          delivery.channelId,
          delivery.event.workspace_pk,
          delivery.event.resource_type,
          delivery.event.resource_pk,
          delivery.event.occurred_at,
          delivery.event.event_id_hex,
          delivery.dimension,
          JSON.stringify(delivery.payload),
          now,
          now,
          now,
        ),
    );
    await db.batch(batch);
  }
}

export interface DiscoveryResult {
  scanned: number;
  enqueued: number;
  bootstrapped: boolean;
}

export async function discoverNotificationEvents(
  controlDb: D1Database,
  telemetryDb: D1Database,
  now = Date.now(),
): Promise<DiscoveryResult> {
  const cursor = await loadCursor(controlDb);
  if (cursor.updated_at === 0) {
    await updateCursor(controlDb, await newestEvent(telemetryDb), now);
    return { scanned: 0, enqueued: 0, bootstrapped: true };
  }
  const events = await loadEvents(telemetryDb, cursor);
  if (events.length === 0) return { scanned: 0, enqueued: 0, bootstrapped: false };
  const resources = await resolveResources(controlDb, events);
  const rules = await loadRules(controlDb, resources);
  const deliveries = await prepareDeliveries(events, resources, rules);
  await persistDeliveries(controlDb, deliveries, now);
  await updateCursor(controlDb, events.at(-1) ?? null, now);
  return { scanned: events.length, enqueued: deliveries.length, bootstrapped: false };
}
