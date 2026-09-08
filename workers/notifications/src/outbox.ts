import { d1BlobToArrayBuffer, unwrapNotificationConfig } from "@alphaping/contracts";

import { sendNotification } from "./providers.js";
import type { DeliveryResult, NotificationPayload, NotificationProvider } from "./types.js";

const DELIVERY_LIMIT = 50;
const CONCURRENCY = 5;
const CLAIM_MS = 30_000;
const MAX_ATTEMPTS = 6;

interface DeliveryCandidate {
  id: string;
}

interface ClaimedDelivery {
  id: string;
  workspace_id: string;
  channel_id: string;
  payload_json: string;
  attempt_count: number;
  provider: NotificationProvider | null;
  config_ciphertext: unknown;
  config_nonce: unknown;
  wrapping_key_id: string | null;
  channel_enabled: number | null;
  rule_available: number;
}

export function retryDelayMs(attempt: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));
}

async function claimDelivery(
  db: D1Database,
  id: string,
  now: number,
): Promise<{ row: ClaimedDelivery; token: string } | null> {
  const token = crypto.randomUUID();
  const result = await db
    .prepare(
      `UPDATE notification_deliveries
       SET state = CASE WHEN attempt_count >= ${MAX_ATTEMPTS} THEN 'dead' ELSE 'delivering' END,
           claim_token = CASE WHEN attempt_count >= ${MAX_ATTEMPTS} THEN NULL ELSE ? END,
           claim_until = CASE WHEN attempt_count >= ${MAX_ATTEMPTS} THEN NULL ELSE ? END,
           last_error = CASE WHEN attempt_count >= ${MAX_ATTEMPTS}
             THEN 'notification_attempts_exhausted' ELSE last_error END,
           attempt_count = MIN(attempt_count + 1, ${MAX_ATTEMPTS}), updated_at = ?
       WHERE id = ? AND (
         (state = 'pending' AND next_attempt_at <= ?)
         OR (state = 'delivering' AND claim_until <= ?)
       )`,
    )
    .bind(token, now + CLAIM_MS, now, id, now, now)
    .run();
  if ((result.meta.changes ?? 0) !== 1) return null;
  const row = await db
    .prepare(
      `SELECT delivery.id, delivery.workspace_id, delivery.channel_id,
              delivery.payload_json, delivery.attempt_count,
              channel.provider, channel.config_ciphertext, channel.config_nonce,
              channel.wrapping_key_id, channel.enabled AS channel_enabled,
              EXISTS (
                SELECT 1 FROM notification_rules rule
                JOIN workspaces workspace ON workspace.id = rule.workspace_id
                WHERE rule.workspace_id = delivery.workspace_id
                  AND workspace.telemetry_pk = delivery.source_workspace_pk
                  AND workspace.deleted_at IS NULL
                  AND rule.channel_id = delivery.channel_id
                  AND rule.dimension = delivery.dimension AND rule.enabled = 1
                  AND rule.resource_type = CASE delivery.source_resource_type
                    WHEN 1 THEN 'machine' ELSE 'service' END
                  AND rule.resource_id = CASE delivery.source_resource_type
                    WHEN 1 THEN machine.id ELSE service.id END
              ) AS rule_available
       FROM notification_deliveries delivery
       LEFT JOIN notification_channels channel ON channel.id = delivery.channel_id
         AND channel.workspace_id = delivery.workspace_id
       LEFT JOIN machines machine ON delivery.source_resource_type = 1
         AND machine.telemetry_pk = delivery.source_resource_pk
         AND machine.workspace_id = delivery.workspace_id AND machine.deleted_at IS NULL
       LEFT JOIN services service ON delivery.source_resource_type = 2
         AND service.telemetry_pk = delivery.source_resource_pk
         AND service.workspace_id = delivery.workspace_id AND service.deleted_at IS NULL
       WHERE delivery.id = ? AND delivery.claim_token = ?`,
    )
    .bind(id, token)
    .first<ClaimedDelivery>();
  return row ? { row, token } : null;
}

async function finishDelivery(
  db: D1Database,
  claimed: { row: ClaimedDelivery; token: string },
  result: DeliveryResult,
  now: number,
): Promise<void> {
  const sent = result.ok;
  const dead = !sent && (!result.retryable || claimed.row.attempt_count >= MAX_ATTEMPTS);
  const state = sent ? "sent" : dead ? "dead" : "pending";
  const nextAttemptAt = sent || dead ? 0 : now + retryDelayMs(claimed.row.attempt_count);
  await db
    .prepare(
      `UPDATE notification_deliveries
       SET state = ?, next_attempt_at = ?, claim_token = NULL, claim_until = NULL,
           last_error = ?, response_status = ?, updated_at = ?, sent_at = ?
       WHERE id = ? AND state = 'delivering' AND claim_token = ?`,
    )
    .bind(
      state,
      nextAttemptAt,
      result.error?.slice(0, 160) ?? null,
      result.status,
      now,
      sent ? now : null,
      claimed.row.id,
      claimed.token,
    )
    .run();
}

function unavailableResult(error: string, retryable = false): DeliveryResult {
  return { ok: false, retryable, status: null, error };
}

async function deliverOne(
  db: D1Database,
  id: string,
  wrappingKey: string,
  now: number,
): Promise<"sent" | "failed" | "skipped"> {
  const claimed = await claimDelivery(db, id, now);
  if (!claimed) return "skipped";
  let result: DeliveryResult;
  if (
    claimed.row.provider === null ||
    claimed.row.channel_enabled !== 1 ||
    claimed.row.wrapping_key_id !== "v1"
  ) {
    result = unavailableResult("notification_channel_unavailable");
  } else if (claimed.row.rule_available !== 1) {
    result = unavailableResult("notification_rule_unavailable");
  } else {
    try {
      const config = await unwrapNotificationConfig(
        {
          ciphertext: d1BlobToArrayBuffer(claimed.row.config_ciphertext),
          nonce: d1BlobToArrayBuffer(claimed.row.config_nonce),
        },
        wrappingKey,
        claimed.row.workspace_id,
        claimed.row.channel_id,
      );
      const payload = JSON.parse(claimed.row.payload_json) as NotificationPayload;
      result = await sendNotification(claimed.row.provider, config, payload);
    } catch {
      result = unavailableResult("notification_config_unavailable", true);
    }
  }
  await finishDelivery(db, claimed, result, Date.now());
  return result.ok ? "sent" : "failed";
}

export interface DeliveryBatchResult {
  attempted: number;
  sent: number;
  failed: number;
}

export async function deliverNotificationOutbox(
  db: D1Database,
  wrappingKey: string,
  now = Date.now(),
): Promise<DeliveryBatchResult> {
  const candidates = await db
    .prepare(
      `SELECT id FROM notification_deliveries
       WHERE (state = 'pending' AND next_attempt_at <= ?)
          OR (state = 'delivering' AND claim_until <= ?)
       ORDER BY next_attempt_at, created_at, id
       LIMIT ?`,
    )
    .bind(now, now, DELIVERY_LIMIT)
    .all<DeliveryCandidate>();
  let sent = 0;
  let failed = 0;
  for (let offset = 0; offset < candidates.results.length; offset += CONCURRENCY) {
    const outcomes = await Promise.all(
      candidates.results
        .slice(offset, offset + CONCURRENCY)
        .map((candidate) => deliverOne(db, candidate.id, wrappingKey, Date.now())),
    );
    sent += outcomes.filter((outcome) => outcome === "sent").length;
    failed += outcomes.filter((outcome) => outcome === "failed").length;
  }
  return { attempted: sent + failed, sent, failed };
}
