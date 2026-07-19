import { wrapNotificationConfig } from "@alphaping/contracts";
import { error } from "@sveltejs/kit";

import { finalAdminCondition } from "./monitoring-access.js";
import { prepareAuditStatement, requireWorkspaceAdmin } from "./workspace-admin.js";

export type NotificationProvider = "resend" | "smtp" | "discord" | "telegram" | "slack" | "bark";
export type NotificationDimension = "availability" | "resource" | "recovery";
export type NotificationResourceType = "machine" | "service";

const PROVIDERS: readonly NotificationProvider[] = [
  "resend",
  "smtp",
  "discord",
  "telegram",
  "slack",
  "bark",
];
const DIMENSIONS: readonly NotificationDimension[] = ["availability", "resource", "recovery"];
const MAX_CHANNELS = 20;
const MAX_RULES = 1_000;
const MAX_RESOURCES = 700;

interface ChannelRow {
  id: string;
  name: string;
  provider: NotificationProvider;
  config_summary_json: string;
  enabled: number;
  updated_at: number;
}

interface RuleRow {
  id: string;
  resource_type: NotificationResourceType;
  resource_id: string;
  resource_name: string | null;
  dimension: NotificationDimension;
  channel_id: string;
  channel_name: string;
  enabled: number;
}

interface ResourceRow {
  id: string;
  type: NotificationResourceType;
  name: string;
}

export interface NotificationPanel {
  channels: readonly {
    id: string;
    name: string;
    provider: NotificationProvider;
    summary: Readonly<Record<string, unknown>>;
    enabled: boolean;
    updatedAt: number;
  }[];
  rules: readonly {
    id: string;
    resourceType: NotificationResourceType;
    resourceId: string;
    resourceName: string;
    dimension: NotificationDimension;
    channelId: string;
    channelName: string;
    enabled: boolean;
  }[];
  resources: readonly ResourceRow[];
}

export interface NotificationChannelInput {
  name: string;
  provider: NotificationProvider;
  config: Readonly<Record<string, unknown>>;
}

function parseSummary(value: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && !Array.isArray(parsed) && typeof parsed === "object"
      ? (parsed as Readonly<Record<string, unknown>>)
      : {};
  } catch {
    return {};
  }
}

function provider(value: string): NotificationProvider {
  if (!PROVIDERS.includes(value as NotificationProvider)) throw error(400, "Provider is invalid");
  return value as NotificationProvider;
}

function dimension(value: string): NotificationDimension {
  if (!DIMENSIONS.includes(value as NotificationDimension)) {
    throw error(400, "Notification dimension is invalid");
  }
  return value as NotificationDimension;
}

function resourceType(value: string): NotificationResourceType {
  if (value !== "machine" && value !== "service") throw error(400, "Resource type is invalid");
  return value;
}

function bounded(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") throw error(400, `${field} is required`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw error(400, `${field} is invalid`);
  return normalized;
}

function optional(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw error(400, "Optional channel value is invalid");
  const normalized = value.trim();
  if (normalized.length > maximum) throw error(400, "Optional channel value is too long");
  return normalized || null;
}

function secureUrl(value: unknown, field: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(bounded(value, field, 2_048));
  } catch {
    throw error(400, `${field} must be a valid URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw error(400, `${field} must use HTTPS without embedded credentials`);
  }
  return parsed;
}

function recipientList(value: unknown): string[] {
  if (typeof value !== "string") throw error(400, "At least one email recipient is required");
  const recipients = value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (
    recipients.length === 0 ||
    recipients.length > 20 ||
    recipients.some((entry) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry))
  ) {
    throw error(400, "Email recipients are invalid");
  }
  return [...new Set(recipients)];
}

function emailConfig(input: Readonly<Record<string, unknown>>, smtp: boolean) {
  const from = bounded(input.from, "Sender", 254);
  const recipients = recipientList(input.recipients);
  if (smtp) {
    return {
      relayUrl: secureUrl(input.relayUrl, "Relay URL").toString(),
      relayToken: optional(input.relayToken, 2_048),
      from,
      recipients,
    };
  }
  return {
    apiKey: bounded(input.apiKey, "Resend API key", 2_048),
    from,
    recipients,
    replyTo: optional(input.replyTo, 254),
  };
}

export function parseNotificationChannelConfig(
  selectedProvider: NotificationProvider,
  input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (selectedProvider === "resend") return emailConfig(input, false);
  if (selectedProvider === "smtp") return emailConfig(input, true);
  if (selectedProvider === "discord" || selectedProvider === "slack") {
    const webhook = secureUrl(input.webhookUrl, "Webhook URL");
    const host = webhook.hostname.toLowerCase();
    const valid =
      selectedProvider === "discord"
        ? (host === "discord.com" || host === "discordapp.com") &&
          webhook.pathname.startsWith("/api/webhooks/")
        : host === "hooks.slack.com" && webhook.pathname.startsWith("/services/");
    if (!valid) throw error(400, `${selectedProvider} webhook URL is invalid`);
    return { webhookUrl: webhook.toString() };
  }
  if (selectedProvider === "telegram") {
    const botToken = bounded(input.botToken, "Bot token", 256);
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) throw error(400, "Bot token is invalid");
    return { botToken, chatId: bounded(input.chatId, "Chat ID", 128) };
  }
  const endpointValue = optional(input.endpoint, 2_048);
  return {
    endpoint: endpointValue ? secureUrl(endpointValue, "Bark endpoint").toString() : null,
    deviceKey: bounded(input.deviceKey, "Device key", 512),
    group: optional(input.group, 80),
  };
}

function summaryForConfig(
  selectedProvider: NotificationProvider,
  config: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (selectedProvider === "resend" || selectedProvider === "smtp") {
    const recipients = config.recipients as readonly string[];
    const from = String(config.from);
    return {
      senderDomain: from.includes("@")
        ? from.slice(from.lastIndexOf("@") + 1).replace(/>$/, "")
        : "configured",
      recipientCount: recipients.length,
      ...(selectedProvider === "smtp"
        ? { relayHost: new URL(String(config.relayUrl)).hostname }
        : {}),
    };
  }
  if (selectedProvider === "discord" || selectedProvider === "slack") {
    return { webhookHost: new URL(String(config.webhookUrl)).hostname };
  }
  if (selectedProvider === "telegram") return { destination: "Chat configured" };
  return {
    endpointHost: new URL(String(config.endpoint ?? "https://api.day.app")).hostname,
    group: config.group ?? "AlphaPing",
  };
}

export async function loadNotificationPanel(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
): Promise<NotificationPanel> {
  const access = await requireWorkspaceAdmin(db, workspaceSlug, userId);
  const [channels, rules, resources] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, provider, config_summary_json, enabled, updated_at
         FROM notification_channels WHERE workspace_id = ?
         ORDER BY enabled DESC, name, id LIMIT ?`,
      )
      .bind(access.workspaceId, MAX_CHANNELS + 1)
      .all<ChannelRow>(),
    db
      .prepare(
        `SELECT rule.id, rule.resource_type, rule.resource_id,
                CASE rule.resource_type
                  WHEN 'machine' THEN machine.name ELSE service.name END AS resource_name,
                rule.dimension, rule.channel_id, channel.name AS channel_name, rule.enabled
         FROM notification_rules rule
         JOIN notification_channels channel ON channel.id = rule.channel_id
         LEFT JOIN machines machine
           ON rule.resource_type = 'machine' AND machine.id = rule.resource_id
         LEFT JOIN services service
           ON rule.resource_type = 'service' AND service.id = rule.resource_id
         WHERE rule.workspace_id = ?
         ORDER BY resource_name, rule.dimension, channel.name, rule.id LIMIT ?`,
      )
      .bind(access.workspaceId, MAX_RULES + 1)
      .all<RuleRow>(),
    db
      .prepare(
        `SELECT id, type, name FROM (
           SELECT id, 'machine' AS type, name FROM machines
           WHERE workspace_id = ? AND deleted_at IS NULL
           UNION ALL
           SELECT id, 'service' AS type, name FROM services
           WHERE workspace_id = ? AND deleted_at IS NULL
         ) ORDER BY type, name, id LIMIT ?`,
      )
      .bind(access.workspaceId, access.workspaceId, MAX_RESOURCES + 1)
      .all<ResourceRow>(),
  ]);
  if (channels.results.length > MAX_CHANNELS) throw error(409, "Too many notification channels");
  if (rules.results.length > MAX_RULES) throw error(409, "Too many notification rules");
  if (resources.results.length > MAX_RESOURCES) {
    throw error(409, "Notification rules support up to 700 active resources per workspace");
  }
  return {
    channels: channels.results.map((row) => ({
      id: row.id,
      name: row.name,
      provider: row.provider,
      summary: parseSummary(row.config_summary_json),
      enabled: row.enabled === 1,
      updatedAt: row.updated_at,
    })),
    rules: rules.results.map((row) => ({
      id: row.id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      resourceName: row.resource_name ?? "Deleted resource",
      dimension: row.dimension,
      channelId: row.channel_id,
      channelName: row.channel_name,
      enabled: row.enabled === 1,
    })),
    resources: resources.results,
  };
}

export async function createNotificationChannel(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  wrappingKey: string,
  input: NotificationChannelInput,
): Promise<string> {
  const access = await requireWorkspaceAdmin(db, workspaceSlug, userId);
  const selectedProvider = provider(input.provider);
  const name = bounded(input.name, "Channel name", 80);
  const config = parseNotificationChannelConfig(selectedProvider, input.config);
  const id = crypto.randomUUID();
  const wrapped = await wrapNotificationConfig(config, wrappingKey, access.workspaceId, id);
  const now = Date.now();
  const authorization = finalAdminCondition(userId, "?");
  const insert = db
    .prepare(
      `INSERT INTO notification_channels
        (id, workspace_id, name, provider, config_ciphertext, config_nonce, wrapping_key_id,
         config_summary_json, enabled, created_by, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, 'v1', ?, 1, ?, ?, ?
       WHERE ${authorization.sql}
         AND NOT EXISTS (
           SELECT 1 FROM notification_channels WHERE workspace_id = ? LIMIT 1 OFFSET ?
         )`,
    )
    .bind(
      id,
      access.workspaceId,
      name,
      selectedProvider,
      wrapped.ciphertext,
      wrapped.nonce,
      JSON.stringify(summaryForConfig(selectedProvider, config)),
      userId,
      now,
      now,
      access.workspaceId,
      ...authorization.binds,
      access.workspaceId,
      MAX_CHANNELS - 1,
    );
  const audit = await prepareAuditStatement(db, {
    workspaceId: access.workspaceId,
    actorUserId: userId,
    action: "notification_channel.create",
    resourceType: "notification_channel",
    resourceId: id,
    before: null,
    after: { name, provider: selectedProvider },
    now,
    onlyIfPreviousStatementChanged: true,
  });
  const result = await db.batch([insert, audit]);
  if ((result[0]?.meta.changes ?? 0) !== 1)
    throw error(409, "Notification channel could not be created");
  return id;
}

export async function updateNotificationChannel(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  input: { channelId: string; name: string; enabled: boolean },
): Promise<void> {
  const access = await requireWorkspaceAdmin(db, workspaceSlug, userId);
  const name = bounded(input.name, "Channel name", 80);
  const authorization = finalAdminCondition(userId, "notification_channels.workspace_id");
  const now = Date.now();
  const mutation = db
    .prepare(
      `UPDATE notification_channels SET name = ?, enabled = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND ${authorization.sql}`,
    )
    .bind(
      name,
      input.enabled ? 1 : 0,
      now,
      input.channelId,
      access.workspaceId,
      ...authorization.binds,
    );
  const audit = await prepareAuditStatement(db, {
    workspaceId: access.workspaceId,
    actorUserId: userId,
    action: "notification_channel.update",
    resourceType: "notification_channel",
    resourceId: input.channelId,
    before: null,
    after: { name, enabled: input.enabled },
    now,
    onlyIfPreviousStatementChanged: true,
  });
  const result = await db.batch([mutation, audit]);
  if ((result[0]?.meta.changes ?? 0) !== 1) throw error(404, "Notification channel not found");
}

export async function deleteNotificationChannel(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  channelId: string,
): Promise<void> {
  const access = await requireWorkspaceAdmin(db, workspaceSlug, userId);
  const authorization = finalAdminCondition(userId, "notification_channels.workspace_id");
  const now = Date.now();
  const mutation = db
    .prepare(
      `DELETE FROM notification_channels
       WHERE id = ? AND workspace_id = ? AND ${authorization.sql}`,
    )
    .bind(channelId, access.workspaceId, ...authorization.binds);
  const audit = await prepareAuditStatement(db, {
    workspaceId: access.workspaceId,
    actorUserId: userId,
    action: "notification_channel.delete",
    resourceType: "notification_channel",
    resourceId: channelId,
    before: { present: true },
    after: null,
    now,
    onlyIfPreviousStatementChanged: true,
  });
  const result = await db.batch([mutation, audit]);
  if ((result[0]?.meta.changes ?? 0) < 1) throw error(404, "Notification channel not found");
}

export async function createNotificationRule(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  input: {
    resourceType: NotificationResourceType;
    resourceId: string;
    dimension: NotificationDimension;
    channelId: string;
  },
): Promise<string> {
  const access = await requireWorkspaceAdmin(db, workspaceSlug, userId);
  const selectedType = resourceType(input.resourceType);
  const selectedDimension = dimension(input.dimension);
  const resourceId = bounded(input.resourceId, "Resource", 128);
  const channelId = bounded(input.channelId, "Channel", 128);
  const id = crypto.randomUUID();
  const now = Date.now();
  const resourceTable = selectedType === "machine" ? "machines" : "services";
  const authorization = finalAdminCondition(userId, "?");
  const mutation = db
    .prepare(
      `INSERT INTO notification_rules
        (id, workspace_id, resource_type, resource_id, dimension, channel_id,
         enabled, created_by, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, 1, ?, ?, ?
       WHERE ${authorization.sql}
         AND EXISTS (
           SELECT 1 FROM ${resourceTable}
           WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
         )
         AND EXISTS (
           SELECT 1 FROM notification_channels
           WHERE id = ? AND workspace_id = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM notification_rules WHERE workspace_id = ? LIMIT 1 OFFSET ?
         )
       ON CONFLICT (channel_id, resource_type, resource_id, dimension)
       DO UPDATE SET enabled = 1, updated_at = excluded.updated_at
       WHERE notification_rules.workspace_id = excluded.workspace_id`,
    )
    .bind(
      id,
      access.workspaceId,
      selectedType,
      resourceId,
      selectedDimension,
      channelId,
      userId,
      now,
      now,
      access.workspaceId,
      ...authorization.binds,
      resourceId,
      access.workspaceId,
      channelId,
      access.workspaceId,
      access.workspaceId,
      MAX_RULES - 1,
    );
  const audit = await prepareAuditStatement(db, {
    workspaceId: access.workspaceId,
    actorUserId: userId,
    action: "notification_rule.create",
    resourceType: "notification_rule",
    resourceId: id,
    before: null,
    after: { selectedType, resourceId, selectedDimension, channelId },
    now,
    onlyIfPreviousStatementChanged: true,
  });
  const result = await db.batch([mutation, audit]);
  if ((result[0]?.meta.changes ?? 0) !== 1)
    throw error(409, "Notification rule could not be created");
  return id;
}

export async function deleteNotificationRule(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  ruleId: string,
): Promise<void> {
  const access = await requireWorkspaceAdmin(db, workspaceSlug, userId);
  const authorization = finalAdminCondition(userId, "notification_rules.workspace_id");
  const now = Date.now();
  const mutation = db
    .prepare(
      `DELETE FROM notification_rules
       WHERE id = ? AND workspace_id = ? AND ${authorization.sql}`,
    )
    .bind(ruleId, access.workspaceId, ...authorization.binds);
  const audit = await prepareAuditStatement(db, {
    workspaceId: access.workspaceId,
    actorUserId: userId,
    action: "notification_rule.delete",
    resourceType: "notification_rule",
    resourceId: ruleId,
    before: { present: true },
    after: null,
    now,
    onlyIfPreviousStatementChanged: true,
  });
  const result = await db.batch([mutation, audit]);
  if ((result[0]?.meta.changes ?? 0) !== 1) throw error(404, "Notification rule not found");
}
