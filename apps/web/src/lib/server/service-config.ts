import { canAccessResource } from "@alphaping/authz";
import {
  applyServiceStateSyncJob,
  createServiceStateSyncJob,
  prepareServiceStateSyncJob,
  type ServiceStateSyncJob,
} from "@alphaping/db";
import { error } from "@sveltejs/kit";

import {
  compileServiceConfig,
  type CompiledServiceConfig,
  type CreateServiceMonitorInput,
} from "./service-config-compiler.js";
import {
  loadMonitoringAccess,
  requireAdmin,
  requireResourceCapability,
} from "./monitoring-access.js";
import { prepareAuditStatement } from "./workspace-admin.js";

export type {
  CreateServiceMonitorInput,
  ServiceAssertionInput,
} from "./service-config-compiler.js";

interface SequenceRow {
  value: number;
}
interface AgentRow {
  id: string;
  machine_id: string;
  probe_count: number;
  config_bytes: number;
}

interface ManagedServiceRow {
  id: string;
  telemetry_pk: number;
  name: string;
  description: string;
  maintenance_until: number | null;
}

export interface ServiceCheckAgent {
  id: string;
  name: string;
}

export type AddServiceCheckInput = Omit<CreateServiceMonitorInput, "name" | "description"> & {
  checkName: string;
};

export interface UpdateServiceCheckPolicyInput {
  enabled: boolean;
  intervalSeconds: number;
  timeoutMs: number;
  retryCount: number;
  failureConfirmations: number;
  recoveryConfirmations: number;
  critical: boolean;
}

export type ReplaceServiceCheckConfigurationInput = AddServiceCheckInput & {
  replaceSecrets: boolean;
};

async function nextSequence(db: D1Database, kind: "service" | "check"): Promise<number> {
  const row = await db
    .prepare(
      `UPDATE telemetry_resource_sequences SET value = value + 1 WHERE kind = ? RETURNING value`,
    )
    .bind(kind)
    .first<SequenceRow>();
  if (!row) throw error(500, "Resource sequence is unavailable");
  return row.value;
}

function slugBase(name: string): string {
  const normalized = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return normalized || "service";
}

async function availableSlug(db: D1Database, workspaceId: string, name: string): Promise<string> {
  const base = slugBase(name);
  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const slug = suffix === 1 ? base : `${base}-${suffix}`;
    const existing = await db
      .prepare(
        `SELECT 1 AS present FROM services
       WHERE workspace_id = ? AND slug = ? AND deleted_at IS NULL LIMIT 1`,
      )
      .bind(workspaceId, slug)
      .first<{ present: number }>();
    if (!existing) return slug;
  }
  throw error(409, "A unique service slug could not be generated");
}

function configurationBytes(compiled: CompiledServiceConfig, preservedSecretBytes = 0): number {
  return (
    new TextEncoder().encode(JSON.stringify(compiled.request)).byteLength +
    compiled.secrets.reduce((total, secret) => total + secret.wrappedValue.byteLength, 0) +
    preservedSecretBytes +
    512
  );
}

const MAX_AGENT_CHECKS = 32;
const MAX_AGENT_CONFIG_BYTES = 44 * 1024;
const AGENT_CAPACITY_CONDITION = `
  AND (
    ? = 0 OR (
      (SELECT COUNT(*) FROM check_configs capacity
       WHERE capacity.executor_agent_id = ? AND capacity.enabled = 1
         AND (? IS NULL OR capacity.id != ?)) < ${MAX_AGENT_CHECKS}
      AND
      (SELECT COALESCE(SUM(capacity.config_bytes), 0) FROM check_configs capacity
       WHERE capacity.executor_agent_id = ? AND capacity.enabled = 1
         AND (? IS NULL OR capacity.id != ?)) + ? <= ${MAX_AGENT_CONFIG_BYTES}
    )
  )`;

async function applyServiceStateSyncOrDefer(
  controlDb: D1Database,
  telemetryDb: D1Database,
  job: ServiceStateSyncJob,
): Promise<void> {
  try {
    await applyServiceStateSyncJob(controlDb, telemetryDb, job);
  } catch {
    console.warn(JSON.stringify({ event: "service_state_sync_deferred" }));
  }
}

interface AgentCapacityInput {
  agentId: string;
  excludedCheckId: string | null;
  configBytes: number;
  enforce: boolean;
}

function agentCapacityBindings(input: AgentCapacityInput): readonly unknown[] {
  return [
    input.enforce ? 1 : 0,
    input.agentId,
    input.excludedCheckId,
    input.excludedCheckId,
    input.agentId,
    input.excludedCheckId,
    input.excludedCheckId,
    input.configBytes,
  ];
}

async function assertAgentCapacity(db: D1Database, input: AgentCapacityInput): Promise<void> {
  if (!input.enforce) return;
  const capacity = await db
    .prepare(
      `SELECT COUNT(*) AS probe_count, COALESCE(SUM(config_bytes), 0) AS config_bytes
       FROM check_configs
       WHERE executor_agent_id = ? AND enabled = 1 AND (? IS NULL OR id != ?)`,
    )
    .bind(input.agentId, input.excludedCheckId, input.excludedCheckId)
    .first<{ probe_count: number; config_bytes: number }>();
  if (!capacity || capacity.probe_count >= MAX_AGENT_CHECKS) {
    throw error(409, `An Agent can run at most ${MAX_AGENT_CHECKS} enabled checks`);
  }
  if (capacity.config_bytes + input.configBytes > MAX_AGENT_CONFIG_BYTES) {
    throw error(409, "The Agent configuration has reached its encrypted snapshot size limit");
  }
}

function advanceAgentConfigurationStatement(
  db: D1Database,
  workspaceId: string,
  machineId: string,
  now: number,
  capacity?: AgentCapacityInput,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE machines SET desired_config_revision = desired_config_revision + 1, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
       ${capacity ? AGENT_CAPACITY_CONDITION : ""}`,
    )
    .bind(now, machineId, workspaceId, ...(capacity ? agentCapacityBindings(capacity) : []));
}

function boundedPolicyInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw error(400, `${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

export async function createServiceMonitor(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  wrappingKey: string,
  input: CreateServiceMonitorInput,
): Promise<{ serviceId: string }> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireAdmin(access);
  const agent =
    input.executorKind === "agent"
      ? await db
          .prepare(
            `SELECT a.id, a.machine_id,
                    (SELECT COUNT(*) FROM check_configs c
                     WHERE c.executor_agent_id = a.id AND c.enabled = 1) AS probe_count,
                    (SELECT COALESCE(SUM(c.config_bytes), 0) FROM check_configs c
                     WHERE c.executor_agent_id = a.id AND c.enabled = 1) AS config_bytes
             FROM agents a
             WHERE a.id = ? AND a.workspace_id = ? AND a.status = 'active'`,
          )
          .bind(input.executorAgentId, access.workspaceId)
          .first<AgentRow>()
      : null;
  if (input.executorKind === "agent" && !agent) {
    throw error(400, "A valid Agent executor is required");
  }
  if (agent && agent.probe_count >= MAX_AGENT_CHECKS) {
    throw error(409, `An Agent can run at most ${MAX_AGENT_CHECKS} enabled checks`);
  }
  const compiled = await compileServiceConfig(input, access.workspaceId, wrappingKey);
  const configBytes = configurationBytes(compiled);
  if (agent && agent.config_bytes + configBytes > MAX_AGENT_CONFIG_BYTES) {
    throw error(409, "The Agent configuration has reached its encrypted snapshot size limit");
  }
  const capacity = agent
    ? {
        agentId: agent.id,
        excludedCheckId: null,
        configBytes,
        enforce: true,
      }
    : null;
  const [servicePk, checkPk, slug] = await Promise.all([
    nextSequence(db, "service"),
    nextSequence(db, "check"),
    availableSlug(db, access.workspaceId, input.name),
  ]);
  const serviceId = crypto.randomUUID();
  const checkId = crypto.randomUUID();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    ...(agent
      ? [
          advanceAgentConfigurationStatement(
            db,
            access.workspaceId,
            agent.machine_id,
            now,
            capacity ?? undefined,
          ),
        ]
      : []),
    db
      .prepare(
        `INSERT INTO services
        (id, telemetry_pk, workspace_id, name, slug, description, status_rule_json,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        serviceId,
        servicePk,
        access.workspaceId,
        input.name,
        slug,
        input.description,
        JSON.stringify({
          failureConfirmations: input.failureConfirmations,
          recoveryConfirmations: input.recoveryConfirmations,
        }),
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO check_configs
        (id, telemetry_pk, workspace_id, service_id, name, kind, executor_kind,
         executor_agent_id, assignment_revision, enabled, interval_seconds, phase_seconds, timeout_ms,
         retry_count, critical, request_json, secret_refs_json,
         failure_confirmations, recovery_confirmations,
         config_bytes, last_claimed_slot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?,
         CASE WHEN ? IS NULL THEN 0 ELSE (
           SELECT desired_config_revision FROM machines
           WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
           ${AGENT_CAPACITY_CONDITION}
         ) END,
         1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .bind(
        checkId,
        checkPk,
        access.workspaceId,
        serviceId,
        `${input.name} availability`,
        input.kind,
        input.executorKind,
        input.executorKind === "agent" ? input.executorAgentId : null,
        agent?.machine_id ?? null,
        agent?.machine_id ?? null,
        access.workspaceId,
        ...agentCapacityBindings(
          capacity ?? { agentId: "", excludedCheckId: null, configBytes, enforce: false },
        ),
        input.intervalSeconds,
        checkPk % input.intervalSeconds,
        input.timeoutMs,
        input.retryCount,
        input.critical ? 1 : 0,
        JSON.stringify(compiled.request),
        JSON.stringify(compiled.secretRefs),
        input.failureConfirmations,
        input.recoveryConfirmations,
        configBytes,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO dashboard_resources
        (dashboard_id, resource_type, resource_id, sort_order, public_override)
       VALUES (?, 'service', ?, ?, 'inherit')`,
      )
      .bind(access.defaultDashboardId, serviceId, servicePk),
    db
      .prepare(
        `INSERT INTO resource_public_policies
        (workspace_id, resource_type, resource_id, effect, projection_profile, updated_at)
       VALUES (?, 'service', ?, 'deny', 'summary', ?)`,
      )
      .bind(access.workspaceId, serviceId, now),
  ];
  for (const [index, assertion] of compiled.assertions.entries()) {
    statements.push(
      db
        .prepare(
          `INSERT INTO check_assertions
        (id, check_id, sort_order, source, operator, selector, expected_json, severity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          checkId,
          index,
          assertion.source,
          assertion.operator,
          assertion.selector,
          JSON.stringify(assertion.expected),
          assertion.severity,
          now,
        ),
    );
  }
  for (const secret of compiled.secrets) {
    statements.push(
      db
        .prepare(
          `INSERT INTO check_secrets
        (id, workspace_id, name, wrapped_value, wrapping_key_id, nonce, created_at)
       VALUES (?, ?, ?, ?, 'v1', ?, ?)`,
        )
        .bind(secret.id, access.workspaceId, secret.name, secret.wrappedValue, secret.nonce, now),
    );
  }
  statements.push(
    await prepareAuditStatement(db, {
      workspaceId: access.workspaceId,
      actorUserId: userId,
      action: "service.create",
      resourceType: "service",
      resourceId: serviceId,
      before: null,
      after: {
        name: input.name,
        description: input.description,
        checkId,
        kind: input.kind,
        executorKind: input.executorKind,
      },
      now,
    }),
  );
  try {
    await db.batch(statements);
  } catch (cause) {
    if (capacity) await assertAgentCapacity(db, capacity);
    throw cause;
  }
  return { serviceId };
}

export async function listServiceCheckAgents(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  serviceId: string,
): Promise<readonly ServiceCheckAgent[]> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireResourceCapability(access, "service", serviceId, "manage");
  const service = await db
    .prepare(`SELECT id FROM services WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`)
    .bind(serviceId, access.workspaceId)
    .first<{ id: string }>();
  if (!service) throw error(404, "Service not found");
  const agents = await db
    .prepare(
      `SELECT a.id, a.machine_id, m.name FROM agents a
       JOIN machines m ON m.id = a.machine_id
       WHERE a.workspace_id = ? AND a.status = 'active' AND m.deleted_at IS NULL
       ORDER BY m.name LIMIT 200`,
    )
    .bind(access.workspaceId)
    .all<{ id: string; machine_id: string; name: string }>();
  return agents.results
    .filter((agent) =>
      canAccessResource(access.role, access.grants, "machine", agent.machine_id, "manage"),
    )
    .map((agent) => ({ id: agent.id, name: agent.name }));
}

export async function addServiceCheck(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  wrappingKey: string,
  serviceId: string,
  input: AddServiceCheckInput,
): Promise<{ checkId: string }> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireResourceCapability(access, "service", serviceId, "manage");
  const service = await db
    .prepare(
      `SELECT id, telemetry_pk, name, description, maintenance_until FROM services
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(serviceId, access.workspaceId)
    .first<ManagedServiceRow>();
  if (!service) throw error(404, "Service not found");
  const checkName = input.checkName.trim();
  if (checkName.length < 2 || checkName.length > 80) throw error(400, "Check name is invalid");
  const agent =
    input.executorKind === "agent"
      ? await db
          .prepare(
            `SELECT a.id, a.machine_id,
                    (SELECT COUNT(*) FROM check_configs c
                     WHERE c.executor_agent_id = a.id AND c.enabled = 1) AS probe_count,
                    (SELECT COALESCE(SUM(c.config_bytes), 0) FROM check_configs c
                     WHERE c.executor_agent_id = a.id AND c.enabled = 1) AS config_bytes
             FROM agents a
             WHERE a.id = ? AND a.workspace_id = ? AND a.status = 'active'`,
          )
          .bind(input.executorAgentId, access.workspaceId)
          .first<AgentRow>()
      : null;
  if (
    input.executorKind === "agent" &&
    (!agent ||
      !canAccessResource(access.role, access.grants, "machine", agent.machine_id, "manage"))
  ) {
    throw error(400, "A valid Agent executor is required");
  }
  if (agent && agent.probe_count >= MAX_AGENT_CHECKS) {
    throw error(409, `An Agent can run at most ${MAX_AGENT_CHECKS} enabled checks`);
  }
  const compiled = await compileServiceConfig(
    { ...input, name: service.name, description: service.description },
    access.workspaceId,
    wrappingKey,
  );
  const configBytes = configurationBytes(compiled);
  if (agent && agent.config_bytes + configBytes > MAX_AGENT_CONFIG_BYTES) {
    throw error(409, "The Agent configuration has reached its encrypted snapshot size limit");
  }
  const capacity = agent
    ? {
        agentId: agent.id,
        excludedCheckId: null,
        configBytes,
        enforce: true,
      }
    : null;
  const checkPk = await nextSequence(db, "check");
  const checkId = crypto.randomUUID();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    ...(agent
      ? [
          advanceAgentConfigurationStatement(
            db,
            access.workspaceId,
            agent.machine_id,
            now,
            capacity ?? undefined,
          ),
        ]
      : []),
    db
      .prepare(
        `INSERT INTO check_configs
          (id, telemetry_pk, workspace_id, service_id, name, kind, executor_kind,
           executor_agent_id, assignment_revision, enabled, interval_seconds, phase_seconds,
           timeout_ms, retry_count, critical, request_json, secret_refs_json,
           failure_confirmations, recovery_confirmations, config_bytes, last_claimed_slot,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?,
           CASE WHEN ? IS NULL THEN 0 ELSE (
             SELECT desired_config_revision FROM machines
             WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
             ${AGENT_CAPACITY_CONDITION}
           ) END,
           1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .bind(
        checkId,
        checkPk,
        access.workspaceId,
        serviceId,
        checkName,
        input.kind,
        input.executorKind,
        input.executorKind === "agent" ? input.executorAgentId : null,
        agent?.machine_id ?? null,
        agent?.machine_id ?? null,
        access.workspaceId,
        ...agentCapacityBindings(
          capacity ?? { agentId: "", excludedCheckId: null, configBytes, enforce: false },
        ),
        input.intervalSeconds,
        checkPk % input.intervalSeconds,
        input.timeoutMs,
        input.retryCount,
        input.critical ? 1 : 0,
        JSON.stringify(compiled.request),
        JSON.stringify(compiled.secretRefs),
        input.failureConfirmations,
        input.recoveryConfirmations,
        configBytes,
        now,
        now,
      ),
  ];
  for (const [index, assertion] of compiled.assertions.entries()) {
    statements.push(
      db
        .prepare(
          `INSERT INTO check_assertions
            (id, check_id, sort_order, source, operator, selector, expected_json, severity, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          checkId,
          index,
          assertion.source,
          assertion.operator,
          assertion.selector,
          JSON.stringify(assertion.expected),
          assertion.severity,
          now,
        ),
    );
  }
  for (const secret of compiled.secrets) {
    statements.push(
      db
        .prepare(
          `INSERT INTO check_secrets
            (id, workspace_id, name, wrapped_value, wrapping_key_id, nonce, created_at)
           VALUES (?, ?, ?, ?, 'v1', ?, ?)`,
        )
        .bind(secret.id, access.workspaceId, secret.name, secret.wrappedValue, secret.nonce, now),
    );
  }
  statements.push(
    await prepareAuditStatement(db, {
      workspaceId: access.workspaceId,
      actorUserId: userId,
      action: "service.check.create",
      resourceType: "service",
      resourceId: serviceId,
      before: null,
      after: {
        checkId,
        checkName,
        kind: input.kind,
        executorKind: input.executorKind,
        critical: input.critical,
      },
      now,
    }),
  );
  try {
    await db.batch(statements);
  } catch (cause) {
    if (capacity) await assertAgentCapacity(db, capacity);
    throw cause;
  }
  return { checkId };
}

interface CheckPolicyRow {
  id: string;
  telemetry_pk: number;
  service_telemetry_pk: number;
  workspace_telemetry_pk: number;
  machine_id: string | null;
  executor_agent_id: string | null;
  executor_kind: "cloudflare" | "agent";
  enabled: number;
  interval_seconds: number;
  timeout_ms: number;
  retry_count: number;
  failure_confirmations: number;
  recovery_confirmations: number;
  critical: number;
  config_bytes: number;
  secret_refs_json: string;
  assignment_revision: number;
  maintenance_until: number | null;
}

interface CheckConfigurationEditRow extends CheckPolicyRow {
  name: string;
  kind: "http" | "tcp" | "icmp";
  request_json: string;
  service_name: string;
  service_description: string;
}

function parseSecretReferences(value: string): CompiledServiceConfig["secretRefs"] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const data = parsed as Readonly<Record<string, unknown>>;
    const headers =
      data.headers === undefined
        ? {}
        : typeof data.headers === "object" && data.headers !== null && !Array.isArray(data.headers)
          ? (data.headers as Readonly<Record<string, unknown>>)
          : null;
    if (
      !headers ||
      Object.values(headers).some((id) => typeof id !== "string" || id.length === 0)
    ) {
      return null;
    }
    const body = data.body ?? null;
    const tcpPayload = data.tcpPayload ?? null;
    if ((typeof body !== "string" || body.length === 0) && body !== null) return null;
    if ((typeof tcpPayload !== "string" || tcpPayload.length === 0) && tcpPayload !== null) {
      return null;
    }
    return {
      headers: Object.fromEntries(
        Object.entries(headers).map(([name, id]) => [name, id as string]),
      ),
      body,
      tcpPayload,
    };
  } catch {
    return null;
  }
}

export async function replaceServiceCheckConfiguration(
  controlDb: D1Database,
  telemetryDb: D1Database,
  workspaceSlug: string,
  userId: string,
  wrappingKey: string,
  serviceId: string,
  checkId: string,
  input: ReplaceServiceCheckConfigurationInput,
): Promise<void> {
  const access = await loadMonitoringAccess(controlDb, workspaceSlug, userId);
  requireResourceCapability(access, "service", serviceId, "manage");
  const row = await controlDb
    .prepare(
      `SELECT c.id, c.telemetry_pk, c.name, c.kind, c.executor_kind, c.executor_agent_id,
              c.enabled, c.interval_seconds, c.timeout_ms, c.retry_count, c.critical,
              c.failure_confirmations, c.recovery_confirmations, c.request_json,
              c.secret_refs_json, c.config_bytes, c.assignment_revision,
              s.telemetry_pk AS service_telemetry_pk, s.name AS service_name,
              s.description AS service_description, s.maintenance_until,
              w.telemetry_pk AS workspace_telemetry_pk, a.machine_id
       FROM check_configs c
       JOIN services s ON s.id = c.service_id AND s.deleted_at IS NULL
       JOIN workspaces w ON w.id = c.workspace_id AND w.deleted_at IS NULL
       LEFT JOIN agents a ON a.id = c.executor_agent_id AND a.status = 'active'
       WHERE c.id = ? AND c.service_id = ? AND c.workspace_id = ?`,
    )
    .bind(checkId, serviceId, access.workspaceId)
    .first<CheckConfigurationEditRow>();
  if (!row) throw error(404, "Check not found");
  if (row.executor_kind === "agent" && row.machine_id) {
    requireResourceCapability(access, "machine", row.machine_id, "manage");
  }
  const checkName = input.checkName.trim();
  if (checkName.length < 2 || checkName.length > 80) throw error(400, "Check name is invalid");
  if (
    input.kind !== row.kind ||
    input.executorKind !== row.executor_kind ||
    (input.executorAgentId || null) !== row.executor_agent_id
  ) {
    throw error(400, "Check type and executor cannot be changed during target replacement");
  }
  if (
    input.intervalSeconds !== row.interval_seconds ||
    input.timeoutMs !== row.timeout_ms ||
    input.retryCount !== row.retry_count ||
    input.failureConfirmations !== row.failure_confirmations ||
    input.recoveryConfirmations !== row.recovery_confirmations ||
    input.critical !== (row.critical === 1)
  ) {
    throw error(400, "Schedule and confirmation changes must use the Policy editor");
  }
  const submittedSecrets =
    input.secretRequestHeaders.trim().length > 0 ||
    (input.requestBodyIsSecret && input.requestBody.length > 0) ||
    (input.tcpPayloadIsSecret && input.tcpPayload.length > 0);
  if (!input.replaceSecrets && submittedSecrets) {
    throw error(400, "Secret values require explicit replacement confirmation");
  }
  const existingReferences = parseSecretReferences(row.secret_refs_json);
  if (!existingReferences) throw error(409, "The stored secret references are invalid");
  const compiled = await compileServiceConfig(
    {
      ...input,
      name: row.service_name,
      description: row.service_description,
    },
    access.workspaceId,
    wrappingKey,
  );
  if (!input.replaceSecrets) {
    const publicHeaders =
      typeof compiled.request.headers === "object" &&
      compiled.request.headers !== null &&
      !Array.isArray(compiled.request.headers)
        ? Object.keys(compiled.request.headers as Readonly<Record<string, unknown>>).map((name) =>
            name.toLowerCase(),
          )
        : [];
    const secretNames = Object.keys(existingReferences.headers).map((name) => name.toLowerCase());
    if (publicHeaders.some((name) => secretNames.includes(name))) {
      throw error(400, "A stored secret header must be replaced before becoming public");
    }
    if (existingReferences.body && compiled.request.body !== null) {
      throw error(400, "A stored secret body must be replaced before becoming public");
    }
    if (existingReferences.tcpPayload && compiled.request.payloadBase64 !== null) {
      throw error(400, "A stored secret TCP payload must be replaced before becoming public");
    }
  }
  const oldSecretIds = referencedSecretIds(row.secret_refs_json);
  let preservedSecretBytes = 0;
  if (!input.replaceSecrets && oldSecretIds.length > 0) {
    const stored = await controlDb
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(length(wrapped_value)), 0) AS bytes
         FROM check_secrets WHERE workspace_id = ?
           AND id IN (${oldSecretIds.map(() => "?").join(", ")})`,
      )
      .bind(access.workspaceId, ...oldSecretIds)
      .first<{ count: number; bytes: number }>();
    if (!stored || stored.count !== oldSecretIds.length) {
      throw error(409, "A stored check secret is unavailable");
    }
    preservedSecretBytes = stored.bytes;
  }
  const finalCompiled: CompiledServiceConfig = input.replaceSecrets
    ? compiled
    : { ...compiled, secretRefs: existingReferences, secrets: [] };
  const configBytes = configurationBytes(finalCompiled, preservedSecretBytes);
  if (row.executor_kind === "agent" && row.enabled === 1 && !row.executor_agent_id) {
    throw error(409, "The Agent executor is unavailable");
  }
  const capacity: AgentCapacityInput | null =
    row.executor_kind === "agent"
      ? {
          agentId: row.executor_agent_id ?? "",
          excludedCheckId: checkId,
          configBytes,
          enforce: row.enabled === 1,
        }
      : null;
  if (capacity) await assertAgentCapacity(controlDb, capacity);
  const now = Date.now();
  const agentMachineId = row.executor_kind === "agent" ? row.machine_id : null;
  if (row.executor_kind === "agent" && !agentMachineId) {
    throw error(409, "The Agent executor is unavailable");
  }
  const syncJob = createServiceStateSyncJob({
    workspaceId: access.workspaceId,
    workspacePk: row.workspace_telemetry_pk,
    serviceId,
    servicePk: row.service_telemetry_pk,
    checkId,
    checkPk: row.telemetry_pk,
    reasonCode: "check_configuration",
    updatedAt: now,
  });
  const mutationIndex = agentMachineId ? 1 : 0;
  const statements: D1PreparedStatement[] = [
    ...(agentMachineId
      ? [
          advanceAgentConfigurationStatement(
            controlDb,
            access.workspaceId,
            agentMachineId,
            now,
            capacity ?? undefined,
          ),
        ]
      : []),
    controlDb
      .prepare(
        `UPDATE check_configs SET name = ?, request_json = ?, secret_refs_json = ?,
           config_bytes = ?, config_revision = config_revision + 1,
           assignment_revision = CASE WHEN ? IS NULL THEN assignment_revision ELSE (
             SELECT desired_config_revision FROM machines
             WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
             ${AGENT_CAPACITY_CONDITION}
           ) END, updated_at = ?
         WHERE id = ? AND service_id = ? AND workspace_id = ?`,
      )
      .bind(
        checkName,
        JSON.stringify(finalCompiled.request),
        JSON.stringify(finalCompiled.secretRefs),
        configBytes,
        agentMachineId,
        agentMachineId,
        access.workspaceId,
        ...agentCapacityBindings(
          capacity ?? { agentId: "", excludedCheckId: checkId, configBytes, enforce: false },
        ),
        now,
        checkId,
        serviceId,
        access.workspaceId,
      ),
    prepareServiceStateSyncJob(controlDb, syncJob, true),
    controlDb.prepare(`DELETE FROM check_assertions WHERE check_id = ?`).bind(checkId),
  ];
  for (const [index, assertion] of finalCompiled.assertions.entries()) {
    statements.push(
      controlDb
        .prepare(
          `INSERT INTO check_assertions
            (id, check_id, sort_order, source, operator, selector, expected_json, severity, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          checkId,
          index,
          assertion.source,
          assertion.operator,
          assertion.selector,
          JSON.stringify(assertion.expected),
          assertion.severity,
          now,
        ),
    );
  }
  if (input.replaceSecrets && oldSecretIds.length > 0) {
    statements.push(
      controlDb
        .prepare(
          `DELETE FROM check_secrets WHERE workspace_id = ?
           AND id IN (${oldSecretIds.map(() => "?").join(", ")})`,
        )
        .bind(access.workspaceId, ...oldSecretIds),
    );
  }
  for (const secret of finalCompiled.secrets) {
    statements.push(
      controlDb
        .prepare(
          `INSERT INTO check_secrets
            (id, workspace_id, name, wrapped_value, wrapping_key_id, nonce, created_at)
           VALUES (?, ?, ?, ?, 'v1', ?, ?)`,
        )
        .bind(secret.id, access.workspaceId, secret.name, secret.wrappedValue, secret.nonce, now),
    );
  }
  statements.push(
    await prepareAuditStatement(controlDb, {
      workspaceId: access.workspaceId,
      actorUserId: userId,
      action: "service.check.configuration.replace",
      resourceType: "service",
      resourceId: serviceId,
      before: {
        checkId,
        checkName: row.name,
        request: row.request_json,
        secretCount: oldSecretIds.length,
      },
      after: {
        checkId,
        checkName,
        request: JSON.stringify(finalCompiled.request),
        secretCount: referencedSecretIds(JSON.stringify(finalCompiled.secretRefs)).length,
      },
      now,
    }),
  );
  let results: D1Result[];
  try {
    results = await controlDb.batch(statements);
  } catch (cause) {
    if (capacity) await assertAgentCapacity(controlDb, capacity);
    throw cause;
  }
  if (results[mutationIndex]?.meta.changes !== 1) {
    throw error(409, "Check configuration changed; reload and try again");
  }
  await applyServiceStateSyncOrDefer(controlDb, telemetryDb, syncJob);
}

export async function updateServiceCheckPolicy(
  controlDb: D1Database,
  telemetryDb: D1Database,
  workspaceSlug: string,
  userId: string,
  serviceId: string,
  checkId: string,
  input: UpdateServiceCheckPolicyInput,
): Promise<void> {
  const access = await loadMonitoringAccess(controlDb, workspaceSlug, userId);
  requireResourceCapability(access, "service", serviceId, "manage");
  const row = await controlDb
    .prepare(
      `SELECT c.id, c.telemetry_pk, s.telemetry_pk AS service_telemetry_pk,
              w.telemetry_pk AS workspace_telemetry_pk, a.machine_id, c.executor_agent_id,
              c.executor_kind,
              c.enabled, c.interval_seconds, c.timeout_ms, c.retry_count,
              c.failure_confirmations, c.recovery_confirmations, c.critical,
              c.config_bytes, c.secret_refs_json, c.assignment_revision, s.maintenance_until
       FROM check_configs c
       JOIN services s ON s.id = c.service_id AND s.deleted_at IS NULL
       JOIN workspaces w ON w.id = c.workspace_id AND w.deleted_at IS NULL
       LEFT JOIN agents a ON a.id = c.executor_agent_id AND a.status = 'active'
       WHERE c.id = ? AND c.service_id = ? AND c.workspace_id = ?`,
    )
    .bind(checkId, serviceId, access.workspaceId)
    .first<CheckPolicyRow>();
  if (!row) throw error(404, "Check not found");
  if (row.executor_kind === "agent" && input.enabled) {
    if (!row.executor_agent_id || !row.machine_id) {
      throw error(409, "The Agent executor is unavailable");
    }
    requireResourceCapability(access, "machine", row.machine_id, "manage");
  }
  const minimumInterval = row.executor_kind === "cloudflare" ? 60 : 5;
  boundedPolicyInteger(input.intervalSeconds, minimumInterval, 86_400, "Check interval");
  boundedPolicyInteger(input.timeoutMs, 100, 30_000, "Timeout");
  boundedPolicyInteger(input.retryCount, 0, 3, "Retry count");
  boundedPolicyInteger(input.failureConfirmations, 1, 20, "Failure confirmations");
  boundedPolicyInteger(input.recoveryConfirmations, 1, 20, "Recovery confirmations");
  if (row.enabled === 1 && !input.enabled) {
    const remaining = await controlDb
      .prepare(
        `SELECT COUNT(*) AS count FROM check_configs
         WHERE service_id = ? AND workspace_id = ? AND enabled = 1 AND id != ?`,
      )
      .bind(serviceId, access.workspaceId, checkId)
      .first<{ count: number }>();
    if (!remaining || remaining.count === 0) {
      throw error(409, "A service must keep at least one enabled check");
    }
  }
  const capacity: AgentCapacityInput | null =
    row.executor_kind === "agent"
      ? {
          agentId: row.executor_agent_id ?? "",
          excludedCheckId: checkId,
          configBytes: row.config_bytes,
          enforce: input.enabled,
        }
      : null;
  if (capacity) await assertAgentCapacity(controlDb, capacity);
  const now = Date.now();
  const agentMachineId = row.executor_kind === "agent" ? row.machine_id : null;
  const before = {
    enabled: row.enabled === 1,
    intervalSeconds: row.interval_seconds,
    timeoutMs: row.timeout_ms,
    retryCount: row.retry_count,
    failureConfirmations: row.failure_confirmations,
    recoveryConfirmations: row.recovery_confirmations,
    critical: row.critical === 1,
  };
  const after = input;
  const mutationIndex = agentMachineId ? 1 : 0;
  const syncJob = createServiceStateSyncJob({
    workspaceId: access.workspaceId,
    workspacePk: row.workspace_telemetry_pk,
    serviceId,
    servicePk: row.service_telemetry_pk,
    checkId,
    checkPk: row.telemetry_pk,
    reasonCode: "check_configuration",
    updatedAt: now,
  });
  const statements: D1PreparedStatement[] = [
    ...(agentMachineId
      ? [
          advanceAgentConfigurationStatement(
            controlDb,
            access.workspaceId,
            agentMachineId,
            now,
            capacity ?? undefined,
          ),
        ]
      : []),
    controlDb
      .prepare(
        `UPDATE check_configs SET enabled = ?, interval_seconds = ?, phase_seconds = ?,
           timeout_ms = ?, retry_count = ?, failure_confirmations = ?,
           recovery_confirmations = ?, critical = ?, config_revision = config_revision + 1,
           assignment_revision = CASE WHEN ? IS NULL THEN assignment_revision ELSE (
             SELECT desired_config_revision FROM machines
             WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
             ${AGENT_CAPACITY_CONDITION}
           ) END, updated_at = ?
         WHERE id = ? AND service_id = ? AND workspace_id = ? AND enabled = ?
           AND (
             ? = 1 OR EXISTS (
               SELECT 1 FROM check_configs remaining
               WHERE remaining.service_id = check_configs.service_id
                 AND remaining.workspace_id = check_configs.workspace_id
                 AND remaining.id != check_configs.id AND remaining.enabled = 1
             )
           )`,
      )
      .bind(
        input.enabled ? 1 : 0,
        input.intervalSeconds,
        row.telemetry_pk % input.intervalSeconds,
        input.timeoutMs,
        input.retryCount,
        input.failureConfirmations,
        input.recoveryConfirmations,
        input.critical ? 1 : 0,
        agentMachineId,
        agentMachineId,
        access.workspaceId,
        ...agentCapacityBindings(
          capacity ?? {
            agentId: "",
            excludedCheckId: checkId,
            configBytes: row.config_bytes,
            enforce: false,
          },
        ),
        now,
        checkId,
        serviceId,
        access.workspaceId,
        row.enabled,
        input.enabled ? 1 : 0,
      ),
    await prepareAuditStatement(controlDb, {
      workspaceId: access.workspaceId,
      actorUserId: userId,
      action: "service.check.policy.update",
      resourceType: "service",
      resourceId: serviceId,
      before,
      after,
      now,
      onlyIfPreviousStatementChanged: true,
    }),
    prepareServiceStateSyncJob(controlDb, syncJob, true),
  ];
  let results: D1Result[];
  try {
    results = await controlDb.batch(statements);
  } catch (cause) {
    if (capacity) await assertAgentCapacity(controlDb, capacity);
    throw cause;
  }
  if (results[mutationIndex]?.meta.changes !== 1) {
    throw error(409, "Check policy changed; reload and try again");
  }
  await applyServiceStateSyncOrDefer(controlDb, telemetryDb, syncJob);
}

function referencedSecretIds(value: string): readonly string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
    const config = parsed as Readonly<Record<string, unknown>>;
    const headers =
      typeof config.headers === "object" &&
      config.headers !== null &&
      !Array.isArray(config.headers)
        ? Object.values(config.headers as Readonly<Record<string, unknown>>)
        : [];
    return [config.body, config.tcpPayload, ...headers].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
  } catch {
    return [];
  }
}

export async function deleteServiceCheck(
  controlDb: D1Database,
  telemetryDb: D1Database,
  workspaceSlug: string,
  userId: string,
  serviceId: string,
  checkId: string,
): Promise<void> {
  const access = await loadMonitoringAccess(controlDb, workspaceSlug, userId);
  requireResourceCapability(access, "service", serviceId, "manage");
  const [row, count] = await Promise.all([
    controlDb
      .prepare(
        `SELECT c.id, c.telemetry_pk, s.telemetry_pk AS service_telemetry_pk,
                w.telemetry_pk AS workspace_telemetry_pk, a.machine_id, c.executor_agent_id,
                c.executor_kind, c.enabled, c.interval_seconds, c.timeout_ms, c.retry_count,
                c.failure_confirmations, c.recovery_confirmations, c.critical,
                c.config_bytes, c.secret_refs_json, c.assignment_revision, s.maintenance_until
         FROM check_configs c
         JOIN services s ON s.id = c.service_id AND s.deleted_at IS NULL
         JOIN workspaces w ON w.id = c.workspace_id AND w.deleted_at IS NULL
         LEFT JOIN agents a ON a.id = c.executor_agent_id AND a.status = 'active'
         WHERE c.id = ? AND c.service_id = ? AND c.workspace_id = ?`,
      )
      .bind(checkId, serviceId, access.workspaceId)
      .first<CheckPolicyRow>(),
    controlDb
      .prepare(
        `SELECT COUNT(*) AS count FROM check_configs
         WHERE service_id = ? AND workspace_id = ?`,
      )
      .bind(serviceId, access.workspaceId)
      .first<{ count: number }>(),
  ]);
  if (!row) throw error(404, "Check not found");
  if (!count || count.count <= 1) throw error(409, "A service must keep at least one check");
  const now = Date.now();
  const agentMachineId = row.executor_kind === "agent" ? row.machine_id : null;
  const secretIds = referencedSecretIds(row.secret_refs_json);
  const mutationIndex = agentMachineId ? 1 : 0;
  const syncJob = createServiceStateSyncJob({
    workspaceId: access.workspaceId,
    workspacePk: row.workspace_telemetry_pk,
    serviceId,
    servicePk: row.service_telemetry_pk,
    checkId,
    checkPk: row.telemetry_pk,
    reasonCode: "check_configuration",
    updatedAt: now,
  });
  const audit = await prepareAuditStatement(controlDb, {
    workspaceId: access.workspaceId,
    actorUserId: userId,
    action: "service.check.delete",
    resourceType: "service",
    resourceId: serviceId,
    before: {
      checkId,
      enabled: row.enabled === 1,
      executorKind: row.executor_kind,
      critical: row.critical === 1,
    },
    after: null,
    now,
    onlyIfPreviousStatementChanged: true,
  });
  const statements: D1PreparedStatement[] = [
    ...(agentMachineId
      ? [advanceAgentConfigurationStatement(controlDb, access.workspaceId, agentMachineId, now)]
      : []),
    controlDb
      .prepare(
        `DELETE FROM check_configs
         WHERE id = ? AND service_id = ? AND workspace_id = ?
           AND EXISTS (
             SELECT 1 FROM check_configs remaining
             WHERE remaining.service_id = check_configs.service_id
               AND remaining.workspace_id = check_configs.workspace_id
               AND remaining.id != check_configs.id
           )`,
      )
      .bind(checkId, serviceId, access.workspaceId),
    audit,
    prepareServiceStateSyncJob(controlDb, syncJob, true),
  ];
  if (secretIds.length > 0) {
    statements.push(
      controlDb
        .prepare(
          `DELETE FROM check_secrets WHERE workspace_id = ?
           AND id IN (${secretIds.map(() => "?").join(", ")})
           AND NOT EXISTS (
             SELECT 1 FROM check_configs
             WHERE id = ? AND service_id = ? AND workspace_id = ?
           )`,
        )
        .bind(access.workspaceId, ...secretIds, checkId, serviceId, access.workspaceId),
    );
  }
  const results = await controlDb.batch(statements);
  if (results[mutationIndex]?.meta.changes !== 1) {
    throw error(409, "A service must keep at least one check");
  }
  await applyServiceStateSyncOrDefer(controlDb, telemetryDb, syncJob);
}

export async function setServicePublicAccess(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  serviceId: string,
  isPublic: boolean,
): Promise<void> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  requireAdmin(access);
  const [service, policy, dashboard] = await Promise.all([
    db
      .prepare(`SELECT id FROM services WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`)
      .bind(serviceId, access.workspaceId)
      .first<{ id: string }>(),
    db
      .prepare(
        `SELECT effect, projection_profile FROM resource_public_policies
         WHERE workspace_id = ? AND resource_type = 'service' AND resource_id = ?`,
      )
      .bind(access.workspaceId, serviceId)
      .first<{ effect: "allow" | "deny"; projection_profile: "summary" | "detailed" }>(),
    db
      .prepare(`SELECT visibility FROM dashboards WHERE id = ? AND workspace_id = ?`)
      .bind(access.defaultDashboardId, access.workspaceId)
      .first<{ visibility: "private" | "authenticated" | "public" }>(),
  ]);
  if (!service) throw error(404, "Service not found");
  if (!dashboard) throw error(409, "The default dashboard is unavailable");
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO resource_public_policies
        (workspace_id, resource_type, resource_id, effect, projection_profile, updated_at)
       VALUES (?, 'service', ?, ?, 'detailed', ?)
       ON CONFLICT(workspace_id, resource_type, resource_id) DO UPDATE SET
         effect = excluded.effect, projection_profile = excluded.projection_profile,
         updated_at = excluded.updated_at`,
      )
      .bind(access.workspaceId, serviceId, isPublic ? "allow" : "deny", now),
    db
      .prepare(
        `INSERT INTO dashboard_resources
        (dashboard_id, resource_type, resource_id, sort_order, public_override)
       VALUES (?, 'service', ?, 0, ?)
       ON CONFLICT(dashboard_id, resource_type, resource_id) DO UPDATE SET
         public_override = excluded.public_override`,
      )
      .bind(access.defaultDashboardId, serviceId, isPublic ? "allow" : "deny"),
  ];
  if (isPublic) {
    statements.push(
      db
        .prepare(
          `UPDATE dashboards SET visibility = 'public', updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
        )
        .bind(now, access.defaultDashboardId, access.workspaceId),
    );
  }
  statements.push(
    await prepareAuditStatement(db, {
      workspaceId: access.workspaceId,
      actorUserId: userId,
      action: "service.public_access.update",
      resourceType: "service",
      resourceId: serviceId,
      before: {
        effect: policy?.effect ?? "deny",
        projectionProfile: policy?.projection_profile ?? "summary",
        dashboardVisibility: dashboard.visibility,
      },
      after: {
        effect: isPublic ? "allow" : "deny",
        projectionProfile: "detailed",
        dashboardVisibility: isPublic ? "public" : dashboard.visibility,
      },
      now,
    }),
  );
  await db.batch(statements);
}

export async function setServiceMaintenance(
  controlDb: D1Database,
  telemetryDb: D1Database,
  workspaceSlug: string,
  userId: string,
  serviceId: string,
  maintenanceUntil: number | null,
): Promise<void> {
  const access = await loadMonitoringAccess(controlDb, workspaceSlug, userId);
  requireResourceCapability(access, "service", serviceId, "manage");
  const service = await controlDb
    .prepare(
      `SELECT s.maintenance_until, s.telemetry_pk, w.telemetry_pk AS workspace_telemetry_pk
       FROM services s JOIN workspaces w ON w.id = s.workspace_id
       WHERE s.id = ? AND s.workspace_id = ? AND s.deleted_at IS NULL`,
    )
    .bind(serviceId, access.workspaceId)
    .first<{
      maintenance_until: number | null;
      telemetry_pk: number;
      workspace_telemetry_pk: number;
    }>();
  if (!service) throw error(404, "Service not found");
  if (maintenanceUntil !== null && (!Number.isInteger(maintenanceUntil) || maintenanceUntil < 0)) {
    throw error(400, "Maintenance end time is invalid");
  }
  const now = Date.now();
  const syncJob = createServiceStateSyncJob(
    {
      workspaceId: access.workspaceId,
      workspacePk: service.workspace_telemetry_pk,
      serviceId,
      servicePk: service.telemetry_pk,
      checkId: null,
      checkPk: null,
      reasonCode:
        maintenanceUntil !== null && maintenanceUntil > now
          ? "maintenance_window"
          : "maintenance_window_ended",
      updatedAt: now,
    },
    maintenanceUntil ?? undefined,
  );
  const audit = await prepareAuditStatement(controlDb, {
    workspaceId: access.workspaceId,
    actorUserId: userId,
    action: "service.maintenance.update",
    resourceType: "service",
    resourceId: serviceId,
    before: { maintenanceUntil: service.maintenance_until },
    after: { maintenanceUntil },
    now,
    onlyIfPreviousStatementChanged: true,
  });
  const results = await controlDb.batch([
    controlDb
      .prepare(
        `UPDATE services SET maintenance_until = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      )
      .bind(maintenanceUntil, now, serviceId, access.workspaceId),
    audit,
    prepareServiceStateSyncJob(controlDb, syncJob, true),
  ]);
  if (results[0]?.meta.changes !== 1) {
    throw error(409, "Service changed; reload and try again");
  }
  await applyServiceStateSyncOrDefer(controlDb, telemetryDb, syncJob);
}
