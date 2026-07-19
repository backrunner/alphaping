import { error } from "@sveltejs/kit";

import {
  finalAdminCondition,
  finalResourceCapabilityCondition,
  loadMonitoringAccess,
  requireAdmin,
  requireResourceCapability,
} from "$lib/server/monitoring-access";

type CommandType = "check_update" | "install_version" | "redetect_runtimes";

interface AgentRow {
  id: string;
}

const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export async function queueAgentCommand(
  db: D1Database,
  workspaceSlug: string,
  userId: string,
  machineId: string,
  input: { type: CommandType; version?: string; bypassRollout?: boolean },
  now = Date.now(),
): Promise<{ commandId: string }> {
  const access = await loadMonitoringAccess(db, workspaceSlug, userId);
  if (input.type === "redetect_runtimes") {
    requireResourceCapability(access, "machine", machineId, "manage");
  } else {
    requireAdmin(access);
  }
  const agent = await db
    .prepare(
      `SELECT a.id FROM agents a JOIN machines m ON m.id = a.machine_id
       WHERE a.workspace_id = ? AND a.machine_id = ? AND a.status = 'active'
         AND m.deleted_at IS NULL`,
    )
    .bind(access.workspaceId, machineId)
    .first<AgentRow>();
  if (!agent) throw error(409, "Machine does not have an active Agent");

  const version = input.version?.trim() ?? "";
  if (input.type === "install_version" && !VERSION_PATTERN.test(version)) {
    throw error(400, "Version must be an exact semantic version");
  }
  if (input.type !== "install_version" && version) {
    throw error(400, "This command does not accept a version");
  }
  const payload = JSON.stringify({
    ...(version ? { version } : {}),
    ...(input.type === "check_update" || input.type === "install_version"
      ? { bypassRollout: input.bypassRollout === true }
      : {}),
  });
  const commandId = crypto.randomUUID();
  const authorization =
    input.type === "redetect_runtimes"
      ? finalResourceCapabilityCondition(
          access,
          userId,
          "machine",
          "?",
          "?",
          "manage",
          [machineId],
          [access.workspaceId],
        )
      : finalAdminCondition(userId, "?10");
  const result = await db
    .prepare(
      `INSERT INTO agent_commands
        (id, workspace_id, agent_id, type, payload_json, state, not_before, expires_at,
         attempt_limit, payload_schema_version, created_by, created_at)
       SELECT ?, ?, ?, ?, ?, 'pending', ?, ?, 3, 1, ?, ?
       WHERE ${authorization.sql}
         AND EXISTS (
           SELECT 1 FROM agents current JOIN machines machine ON machine.id = current.machine_id
           WHERE current.id = ? AND current.workspace_id = ? AND current.machine_id = ?
             AND current.status = 'active' AND machine.deleted_at IS NULL
         )`,
    )
    .bind(
      commandId,
      access.workspaceId,
      agent.id,
      input.type,
      payload,
      now,
      now + 30 * 60_000,
      userId,
      now,
      ...(input.type === "redetect_runtimes" ? [] : [access.workspaceId]),
      ...authorization.binds,
      agent.id,
      access.workspaceId,
      machineId,
    )
    .run();
  if (result.meta.changes !== 1) {
    throw error(409, "Machine access changed; reload and try again");
  }
  return { commandId };
}
