import { executeHttp, executeTcp } from "./executor.js";
import { reconcileMachineLiveness } from "./machine-liveness.js";
import { persistCheckResult } from "./persistence.js";
import { dueSlot, isDue } from "./schedule.js";
import { applyHttpSecrets, applyTcpSecrets, resolveCheckSecrets } from "./secrets.js";
import type { CheckConfigRow } from "./types.js";
import { parseHttpRequest, parseTcpRequest } from "./validation.js";

const MAX_CANDIDATES = 500;
const MAX_CONCURRENCY = 5;

function configurationFailureSummary(cause: unknown): string {
  if (cause instanceof DOMException && cause.name === "OperationError") {
    return "secret_decryption_failed";
  }
  if (cause instanceof Error) {
    const allowed = new Set([
      "missing_check_secret",
      "invalid_check_secret_wrapping_key",
      "invalid_check_secret_envelope",
      "secret_payload_too_large",
      "invalid_check_config",
      "invalid_url",
      "invalid_protocol",
      "blocked_target",
    ]);
    if (allowed.has(cause.message)) return cause.message;
  }
  return "configuration_rejected";
}

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
    const secrets = await resolveCheckSecrets(env.CONTROL_DB, row, env.CHECK_SECRET_WRAPPING_KEY);
    result =
      row.kind === "http"
        ? await executeHttp(
            applyHttpSecrets(parseHttpRequest(row.request_json), secrets),
            row.timeout_ms,
          )
        : await executeTcp(
            applyTcpSecrets(parseTcpRequest(row.request_json), secrets),
            row.timeout_ms,
          );
  } catch (cause) {
    result = {
      state: "down" as const,
      latencyMs: null,
      failureCode: "invalid_config",
      failureSummary: configurationFailureSummary(cause),
    };
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

async function runChecks(env: Env, scheduledAt: number): Promise<void> {
  const candidates = await env.CONTROL_DB.prepare(
    `SELECT c.id, c.telemetry_pk, c.workspace_id,
            w.telemetry_pk AS workspace_telemetry_pk, s.telemetry_pk AS service_telemetry_pk,
            s.maintenance_until AS service_maintenance_until,
            c.kind, c.interval_seconds, c.phase_seconds, c.timeout_ms,
            c.request_json, c.secret_refs_json, c.failure_confirmations,
            c.recovery_confirmations, c.last_claimed_slot
     FROM check_configs c
     JOIN workspaces w ON w.id = c.workspace_id
     JOIN services s ON s.id = c.service_id AND s.deleted_at IS NULL
     WHERE c.enabled = 1 AND c.executor_kind = 'cloudflare' AND c.kind IN ('http', 'tcp')
     LIMIT ?`,
  )
    .bind(MAX_CANDIDATES)
    .all<CheckConfigRow>();
  const due = candidates.results.filter((row) =>
    isDue(scheduledAt, row.interval_seconds, row.phase_seconds, row.last_claimed_slot),
  );

  const serviceGroups = new Map<number, CheckConfigRow[]>();
  for (const row of due) {
    const group = serviceGroups.get(row.service_telemetry_pk) ?? [];
    group.push(row);
    serviceGroups.set(row.service_telemetry_pk, group);
  }
  const groups = [...serviceGroups.values()];
  let failedGroups = 0;
  for (let offset = 0; offset < groups.length; offset += MAX_CONCURRENCY) {
    const outcomes = await Promise.allSettled(
      groups.slice(offset, offset + MAX_CONCURRENCY).map(async (group) => {
        for (const row of group) await processCheck(env, row, scheduledAt);
      }),
    );
    failedGroups += outcomes.filter((outcome) => outcome.status === "rejected").length;
  }
  if (failedGroups > 0) {
    throw new Error(`check_persistence_failed:${failedGroups}`);
  }
}

export async function runScheduled(env: Env, scheduledAt: number): Promise<void> {
  const [liveness, checks] = await Promise.allSettled([
    reconcileMachineLiveness(env.CONTROL_DB, env.TELEMETRY_DB, scheduledAt),
    runChecks(env, scheduledAt),
  ]);
  if (liveness.status === "fulfilled" && liveness.value.transitioned > 0) {
    console.log(
      JSON.stringify({
        event: "machine_liveness_reconciled",
        scanned: liveness.value.scanned,
        transitioned: liveness.value.transitioned,
      }),
    );
  }
  const failedTasks = Number(liveness.status === "rejected") + Number(checks.status === "rejected");
  if (failedTasks > 0) throw new Error(`scheduled_tasks_failed:${failedTasks}`);
}

export default {
  async scheduled(event, env, ctx): Promise<void> {
    ctx.waitUntil(runScheduled(env, event.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
