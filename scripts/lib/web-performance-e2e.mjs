import { performance } from "node:perf_hooks";

const MACHINE_TARGET = 500;
const MACHINE_PREVIEW_TARGET = 12;
const SERVICE_TARGET = 200;
const MEASURED_REQUESTS = 20;
const SSR_P95_LIMIT_MS = 500;
const SSR_HTML_LIMIT_BYTES = 250_000;
const TELEMETRY_PK_BASE = 1_000_000;
const SERVICE_TELEMETRY_PK_BASE = 2_000_000;
const CHECK_TELEMETRY_PK_BASE = 3_000_000;

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

async function fetchMachineCollection(baseUrl, adminCookie) {
  const response = await fetch(`${baseUrl}/operations/machines`, {
    headers: { cookie: adminCookie },
  });
  const html = await response.text();
  if (response.status !== 200) {
    throw new Error(
      `500-machine collection returned ${response.status}, expected 200; body starts with ${JSON.stringify(html.slice(0, 500))}`,
    );
  }
  if (response.headers.get("cache-control") !== "private, no-store") {
    throw new Error("500-machine collection was not marked private");
  }
  return html;
}

async function fetchServiceCollection(baseUrl, adminCookie) {
  const response = await fetch(`${baseUrl}/operations/services`, {
    headers: { cookie: adminCookie },
  });
  const html = await response.text();
  if (response.status !== 200) {
    throw new Error(
      `200-service collection returned ${response.status}, expected 200; body starts with ${JSON.stringify(html.slice(0, 500))}`,
    );
  }
  if (response.headers.get("cache-control") !== "private, no-store") {
    throw new Error("200-service collection was not marked private");
  }
  return html;
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

  const existingServices = onlyRow(
    queryControlDb(
      `SELECT COUNT(*) AS count FROM services
       WHERE workspace_id = ${sqlString(workspace.id)} AND deleted_at IS NULL`,
    ),
    "performance service count",
  ).count;
  const servicesToAdd = SERVICE_TARGET - existingServices;
  if (!Number.isInteger(servicesToAdd) || servicesToAdd < 0) {
    throw new Error(`performance fixture already contains ${existingServices} services`);
  }
  if (servicesToAdd > 0) {
    queryControlDb(
      `WITH RECURSIVE sequence(value) AS (
         VALUES (1)
         UNION ALL SELECT value + 1 FROM sequence WHERE value < ${servicesToAdd}
       )
       INSERT INTO services
         (id, telemetry_pk, workspace_id, name, description, created_at, updated_at)
       SELECT printf('performance-service-%03d', value), ${SERVICE_TELEMETRY_PK_BASE} + value,
              ${sqlString(workspace.id)}, printf('Performance service %03d', value),
              '200-service collection fixture', ${now}, ${now}
       FROM sequence`,
    );
    queryControlDb(
      `INSERT INTO check_configs
         (id, telemetry_pk, workspace_id, service_id, name, kind, executor_kind,
          enabled, interval_seconds, phase_seconds, timeout_ms, request_json,
          created_at, updated_at)
       SELECT replace(id, 'service', 'check'),
              ${CHECK_TELEMETRY_PK_BASE} + (telemetry_pk - ${SERVICE_TELEMETRY_PK_BASE}),
              workspace_id, id, 'Availability', 'http', 'cloudflare', 1, 300, 0, 5000,
              '{"url":"https://example.com/health","method":"GET","expectedStatus":[200],"assertions":[]}',
              ${now}, ${now}
       FROM services WHERE id LIKE 'performance-service-%'`,
    );
    queryTelemetryDb(
      `WITH RECURSIVE sequence(value) AS (
         VALUES (1)
         UNION ALL SELECT value + 1 FROM sequence WHERE value < ${servicesToAdd}
       )
       INSERT INTO service_latest
         (service_pk, workspace_pk, state, status_since, reason_code,
          last_transition_at, updated_at)
       SELECT ${SERVICE_TELEMETRY_PK_BASE} + value, ${workspace.telemetry_pk}, 'healthy',
              ${now}, 'checks_healthy', ${now}, ${now}
       FROM sequence`,
    );
    queryTelemetryDb(
      `WITH RECURSIVE sequence(value) AS (
         VALUES (1)
         UNION ALL SELECT value + 1 FROM sequence WHERE value < ${servicesToAdd}
       )
       INSERT INTO check_latest
         (check_pk, workspace_pk, observed_at, state, latency_ms, result_id,
          service_pk, critical, config_revision)
       SELECT ${CHECK_TELEMETRY_PK_BASE} + value, ${workspace.telemetry_pk}, ${now},
              'healthy', 25, zeroblob(16), ${SERVICE_TELEMETRY_PK_BASE} + value, 1, 1
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

  const serviceRows = queryControlDb(
    `SELECT name FROM services
     WHERE workspace_id = ${sqlString(workspace.id)} AND deleted_at IS NULL
     ORDER BY name`,
  );
  if (serviceRows.length !== SERVICE_TARGET) {
    throw new Error(
      `performance fixture contains ${serviceRows.length} services, expected ${SERVICE_TARGET}`,
    );
  }

  const machineCollection = await fetchMachineCollection(baseUrl, adminCookie);
  if (
    !machineCollection.includes(machineRows[0].name) ||
    !machineCollection.includes(machineRows.at(-1).name)
  ) {
    throw new Error("500-machine collection did not render the complete bounded resource set");
  }
  const serviceCollection = await fetchServiceCollection(baseUrl, adminCookie);
  if (
    !serviceCollection.includes(serviceRows[0].name) ||
    !serviceCollection.includes(serviceRows.at(-1).name)
  ) {
    throw new Error("200-service collection did not render the complete bounded resource set");
  }

  await fetchDashboard(baseUrl, adminCookie);
  const timings = [];
  let htmlBytes = 0;
  const previewMachines = machineRows.slice(0, MACHINE_PREVIEW_TARGET);
  const firstOmittedMachine = machineRows[MACHINE_PREVIEW_TARGET];
  const lastOmittedMachine = machineRows.at(-1);
  if (!firstOmittedMachine || !lastOmittedMachine) {
    throw new Error("performance fixture does not exceed the dashboard preview limit");
  }
  for (let request = 0; request < MEASURED_REQUESTS; request += 1) {
    const result = await fetchDashboard(baseUrl, adminCookie);
    timings.push(result.durationMs);
    htmlBytes = Buffer.byteLength(result.html);
    for (const machine of previewMachines) {
      if (!result.html.includes(machine.name)) {
        throw new Error(`500-machine dashboard preview omitted ${machine.name}`);
      }
    }
    if (
      result.html.includes(firstOmittedMachine.name) ||
      result.html.includes(lastOmittedMachine.name)
    ) {
      throw new Error("500-machine dashboard rendered resources beyond its bounded preview");
    }
  }

  const p95Ms = percentile95(timings);
  const maxMs = Math.max(...timings);
  console.log(
    `Web 500-machine SSR: p95=${p95Ms.toFixed(1)}ms max=${maxMs.toFixed(1)}ms html=${htmlBytes}B preview=${MACHINE_PREVIEW_TARGET}`,
  );
  if (p95Ms >= SSR_P95_LIMIT_MS) {
    throw new Error(
      `500-machine dashboard SSR p95 ${p95Ms.toFixed(1)}ms exceeded ${SSR_P95_LIMIT_MS}ms`,
    );
  }
  if (htmlBytes > SSR_HTML_LIMIT_BYTES) {
    throw new Error(`500-machine dashboard HTML ${htmlBytes}B exceeded ${SSR_HTML_LIMIT_BYTES}B`);
  }
}
