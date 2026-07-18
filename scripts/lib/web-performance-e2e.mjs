import { performance } from "node:perf_hooks";

const MACHINE_TARGET = 500;
const MEASURED_REQUESTS = 9;
const SSR_P95_LIMIT_MS = 500;
const TELEMETRY_PK_BASE = 1_000_000;

function onlyRow(rows, label) {
  if (rows.length !== 1) throw new Error(`${label} returned ${rows.length} rows, expected one`);
  return rows[0];
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function percentile95(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1];
}

async function fetchDashboard(baseUrl, adminCookie) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/operations`, {
    headers: { cookie: adminCookie },
  });
  const html = await response.text();
  const durationMs = performance.now() - startedAt;
  if (response.status !== 200) {
    throw new Error(
      `500-machine dashboard returned ${response.status}, expected 200; body starts with ${JSON.stringify(html.slice(0, 500))}`,
    );
  }
  if (response.headers.get("cache-control") !== "private, no-store") {
    throw new Error("500-machine dashboard was not marked private");
  }
  return { durationMs, html };
}

export async function runWebPerformanceE2e({
  baseUrl,
  adminCookie,
  queryControlDb,
  queryTelemetryDb,
}) {
  const workspace = onlyRow(
    queryControlDb(
      `SELECT id, telemetry_pk FROM workspaces
       WHERE slug = 'operations' AND deleted_at IS NULL`,
    ),
    "performance workspace lookup",
  );
  const existing = onlyRow(
    queryControlDb(
      `SELECT COUNT(*) AS count FROM machines
       WHERE workspace_id = ${sqlString(workspace.id)} AND deleted_at IS NULL`,
    ),
    "performance machine count",
  ).count;
  const machinesToAdd = MACHINE_TARGET - existing;
  if (!Number.isInteger(machinesToAdd) || machinesToAdd < 0) {
    throw new Error(`performance fixture already contains ${existing} machines`);
  }

  const now = Date.now();
  if (machinesToAdd > 0) {
    queryControlDb(
      `WITH RECURSIVE sequence(value) AS (
         VALUES (1)
         UNION ALL SELECT value + 1 FROM sequence WHERE value < ${machinesToAdd}
       )
       INSERT INTO machines
         (id, telemetry_pk, workspace_id, name, description, labels_json,
          sampling_interval_seconds, report_interval_seconds, offline_after_seconds,
          container_monitoring_enabled, desired_config_revision, created_at, updated_at)
       SELECT printf('performance-machine-%03d', value), ${TELEMETRY_PK_BASE} + value,
              ${sqlString(workspace.id)}, printf('Benchmark %03d', value),
              '500-machine SSR performance fixture', '{"fixture":"performance"}',
              10, 60, 150, 0, 1, ${now}, ${now}
       FROM sequence`,
    );
    queryControlDb(
      `INSERT INTO agents
         (id, workspace_id, machine_id, identity_public_key, platform, arch,
          agent_version, protocol_version, status, applied_config_revision,
          created_at, last_seen_at)
       SELECT replace(id, 'machine', 'agent'), workspace_id, id, zeroblob(32),
              'linux', 'x86_64', '0.1.0', 1, 'active', 1, ${now}, ${now}
       FROM machines WHERE id LIKE 'performance-machine-%'`,
    );
    queryTelemetryDb(
      `WITH RECURSIVE sequence(value) AS (
         VALUES (1)
         UNION ALL SELECT value + 1 FROM sequence WHERE value < ${machinesToAdd}
       )
       INSERT INTO machine_latest
         (machine_pk, workspace_pk, agent_id, observed_at, received_at, state,
          cpu_permille, memory_used_bytes, memory_total_bytes, storage_used_bytes,
          storage_total_bytes, network_rx_bps, network_tx_bps, network_rx_total,
          network_tx_total, load_1m_milli, uptime_seconds, report_id,
          container_inventory_json)
       SELECT ${TELEMETRY_PK_BASE} + value, ${workspace.telemetry_pk},
              printf('performance-agent-%03d', value), ${now}, ${now}, 'healthy',
              250, 1073741824, 4294967296, 8589934592, 17179869184,
              4096, 2048, 1000000, 500000, 750, 86400, zeroblob(16), NULL
       FROM sequence`,
    );
  }

  const machineRows = queryControlDb(
    `SELECT name FROM machines
     WHERE workspace_id = ${sqlString(workspace.id)} AND deleted_at IS NULL
     ORDER BY name`,
  );
  if (machineRows.length !== MACHINE_TARGET) {
    throw new Error(`performance fixture contains ${machineRows.length} machines, expected 500`);
  }
  const latestCount = onlyRow(
    queryTelemetryDb(
      `SELECT COUNT(*) AS count FROM machine_latest WHERE workspace_pk = ${workspace.telemetry_pk}`,
    ),
    "performance latest count",
  ).count;
  if (latestCount !== MACHINE_TARGET) {
    throw new Error(`performance fixture contains ${latestCount} latest rows, expected 500`);
  }

  await fetchDashboard(baseUrl, adminCookie);
  const timings = [];
  let htmlBytes = 0;
  for (let request = 0; request < MEASURED_REQUESTS; request += 1) {
    const result = await fetchDashboard(baseUrl, adminCookie);
    timings.push(result.durationMs);
    htmlBytes = Buffer.byteLength(result.html);
    for (const machine of machineRows) {
      if (!result.html.includes(machine.name)) {
        throw new Error(`500-machine dashboard omitted ${machine.name}`);
      }
    }
  }

  const p95Ms = percentile95(timings);
  const maxMs = Math.max(...timings);
  console.log(
    `Web 500-machine SSR: p95=${p95Ms.toFixed(1)}ms max=${maxMs.toFixed(1)}ms html=${htmlBytes}B`,
  );
  if (p95Ms >= SSR_P95_LIMIT_MS) {
    throw new Error(
      `500-machine dashboard SSR p95 ${p95Ms.toFixed(1)}ms exceeded ${SSR_P95_LIMIT_MS}ms`,
    );
  }
}
