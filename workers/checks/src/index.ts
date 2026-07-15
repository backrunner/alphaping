import { executeHttp, executeTcp } from "./executor.js";
import { persistCheckResult } from "./persistence.js";
import { dueSlot, isDue } from "./schedule.js";
import type { CheckConfigRow } from "./types.js";
import { parseHttpRequest, parseTcpRequest } from "./validation.js";

const MAX_CANDIDATES = 200;
const MAX_CONCURRENCY = 5;

async function processCheck(env: Env, row: CheckConfigRow, nowMs: number): Promise<void> {
  const slotSeconds = dueSlot(nowMs, row.interval_seconds, row.phase_seconds);
  const claim = await env.CONTROL_DB.prepare(
    `UPDATE check_configs SET last_claimed_slot = ?
     WHERE id = ? AND enabled = 1 AND executor_kind = 'cloudflare' AND last_claimed_slot < ?`,
  )
    .bind(slotSeconds, row.id, slotSeconds)
    .run();
  if ((claim.meta.changes ?? 0) !== 1) return;

  let result;
  try {
    result =
      row.kind === "http"
        ? await executeHttp(parseHttpRequest(row.request_json), row.timeout_ms)
        : await executeTcp(parseTcpRequest(row.request_json), row.timeout_ms);
  } catch {
    result = { state: "down" as const, latencyMs: null, failureCode: "invalid_config" };
  }
  try {
    await persistCheckResult(env.TELEMETRY_DB, row, slotSeconds * 1_000, Date.now(), result);
  } catch (error) {
    await env.CONTROL_DB.prepare(
      "UPDATE check_configs SET last_claimed_slot = ? WHERE id = ? AND last_claimed_slot = ?",
    )
      .bind(row.last_claimed_slot, row.id, slotSeconds)
      .run();
    throw error;
  }
}

async function runScheduled(env: Env, scheduledAt: number): Promise<void> {
  const candidates = await env.CONTROL_DB.prepare(
    `SELECT c.id, c.telemetry_pk, w.telemetry_pk AS workspace_telemetry_pk,
            c.kind, c.interval_seconds, c.phase_seconds, c.timeout_ms,
            c.request_json, c.last_claimed_slot
     FROM check_configs c
     JOIN workspaces w ON w.id = c.workspace_id
     WHERE c.enabled = 1 AND c.executor_kind = 'cloudflare' AND c.kind IN ('http', 'tcp')
     LIMIT ?`,
  )
    .bind(MAX_CANDIDATES)
    .all<CheckConfigRow>();
  const due = candidates.results.filter((row) =>
    isDue(scheduledAt, row.interval_seconds, row.phase_seconds, row.last_claimed_slot),
  );

  for (let offset = 0; offset < due.length; offset += MAX_CONCURRENCY) {
    await Promise.all(
      due.slice(offset, offset + MAX_CONCURRENCY).map((row) => processCheck(env, row, scheduledAt)),
    );
  }
}

export default {
  async scheduled(event, env, ctx): Promise<void> {
    ctx.waitUntil(runScheduled(env, event.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
