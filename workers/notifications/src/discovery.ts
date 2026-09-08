import type { NotificationDimension, NotificationPayload, ResourceType } from "./types.js";

const EVENT_LIMIT = 100;
const INSERT_BATCH = 50;
const MAX_MATCHED_RULES = 2_000;

interface CursorRow {
  last_sequence: number;
  updated_at: number;
}

interface StateEventRow {
  sequence: number;
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
      `SELECT last_sequence, updated_at
       FROM notification_event_cursors WHERE singleton = 1`,
    )
    .first<CursorRow>();
  if (!cursor) throw new Error("notification_cursor_missing");
  return cursor;
}

async function newestSequence(db: D1Database): Promise<number> {
  return (
    (await db
      .prepare("SELECT sequence FROM notification_event_queue ORDER BY sequence DESC LIMIT 1")
      .first<number>("sequence")) ?? 0
  );
}

async function updateCursor(db: D1Database, sequence: number, now: number): Promise<void> {
  await db
    .prepare(
      `UPDATE notification_event_cursors SET last_sequence = ?, updated_at = ?
     WHERE singleton = 1 AND last_sequence <= ?`,
    )
    .bind(sequence, now, sequence)
    .run();
}

async function cleanConsumedEvents(db: D1Database, sequence: number): Promise<void> {
  await db
    .prepare(
      `DELETE FROM notification_event_queue WHERE sequence IN (
       SELECT sequence FROM notification_event_queue
       WHERE sequence <= ? ORDER BY sequence LIMIT ?
     )`,
    )
    .bind(sequence, EVENT_LIMIT)
    .run();
}

async function loadEvents(db: D1Database, cursor: CursorRow): Promise<StateEventRow[]> {
  const result = await db
    .prepare(
      `SELECT queued.sequence, event.workspace_pk, event.resource_type, event.resource_pk,
            event.occurred_at, event.event_id, hex(event.event_id) AS event_id_hex,
            event.previous_state, event.current_state, event.reason_code
     FROM notification_event_queue queued
     JOIN state_events event
       ON event.resource_type = queued.resource_type AND event.resource_pk = queued.resource_pk
         AND event.occurred_at = queued.occurred_at AND event.event_id = queued.event_id
         AND event.workspace_pk = queued.workspace_pk
     WHERE queued.sequence > ? ORDER BY queued.sequence LIMIT ?`,
    )
    .bind(cursor.last_sequence, EVENT_LIMIT)
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
  events: readonly StateEventRow[],
): Promise<Map<string, RuleRow[]>> {
  const requested = new Map<string, readonly string[]>();
  for (const event of events) {
    const type = resourceType(event.resource_type);
    const resource = resources.get(resourceKey(type, event.workspace_pk, event.resource_pk));
    if (!resource) continue;
    const dimension = dimensionForEvent(event);
    requested.set(ruleKey(resource.workspaceId, type, resource.id, dimension), [
      resource.workspaceId,
      type,
      resource.id,
      dimension,
    ]);
  }
  const keys = [...requested.values()];
  const rules = new Map<string, RuleRow[]>();
  let matched = 0;
  // Four parameters per key plus LIMIT: stay below D1's 100-parameter limit.
  for (let offset = 0; offset < keys.length; offset += 24) {
    const batch = keys.slice(offset, offset + 24);
    const result = await db
      .prepare(
        `WITH requested(workspace_id, resource_type, resource_id, dimension) AS (
         VALUES ${batch.map(() => "(?, ?, ?, ?)").join(", ")}
       )
       SELECT rule.workspace_id, rule.resource_type, rule.resource_id,
              rule.dimension, rule.channel_id
       FROM requested JOIN notification_rules rule
         ON rule.workspace_id = requested.workspace_id
           AND rule.resource_type = requested.resource_type
           AND rule.resource_id = requested.resource_id AND rule.dimension = requested.dimension
       JOIN notification_channels channel
         ON channel.id = rule.channel_id AND channel.workspace_id = rule.workspace_id
       WHERE rule.enabled = 1 AND channel.enabled = 1
       ORDER BY rule.resource_type, rule.resource_id, rule.dimension, rule.channel_id
       LIMIT ?`,
      )
      .bind(...batch.flat(), MAX_MATCHED_RULES - matched + 1)
      .all<RuleRow>();
    matched += result.results.length;
    if (matched > MAX_MATCHED_RULES) throw new Error("notification_rule_batch_exceeded");
    for (const row of result.results) {
      const key = ruleKey(row.workspace_id, row.resource_type, row.resource_id, row.dimension);
      const group = rules.get(key) ?? [];
      group.push(row);
      rules.set(key, group);
    }
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
  let cursor = await loadCursor(controlDb);
  if (cursor.updated_at === 0) {
    const sequence = await newestSequence(telemetryDb);
    const initialized = await controlDb
      .prepare(
        `UPDATE notification_event_cursors SET last_sequence = ?, updated_at = ?
         WHERE singleton = 1 AND updated_at = 0 RETURNING last_sequence, updated_at`,
      )
      .bind(sequence, now)
      .first<CursorRow>();
    if (initialized) {
      await cleanConsumedEvents(telemetryDb, initialized.last_sequence);
      return { scanned: 0, enqueued: 0, bootstrapped: true };
    }
    // A concurrent first run already initialized the cursor. Its boundary wins.
    cursor = await loadCursor(controlDb);
  }
  const events = await loadEvents(telemetryDb, cursor);
  if (events.length === 0) {
    await cleanConsumedEvents(telemetryDb, cursor.last_sequence);
    return { scanned: 0, enqueued: 0, bootstrapped: false };
  }
  const resources = await resolveResources(controlDb, events);
  const rules = await loadRules(controlDb, resources, events);
  const deliveries = await prepareDeliveries(events, resources, rules);
  await persistDeliveries(controlDb, deliveries, now);
  const sequence = events.at(-1)?.sequence ?? cursor.last_sequence;
  await updateCursor(controlDb, sequence, now);
  await cleanConsumedEvents(telemetryDb, sequence);
  return { scanned: events.length, enqueued: deliveries.length, bootstrapped: false };
}
