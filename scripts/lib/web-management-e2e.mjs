function assertResponse(response, expectedStatus, label) {
  if (response.status !== expectedStatus) {
    throw new Error(`${label} returned ${response.status}, expected ${expectedStatus}`);
  }
}

function form(values) {
  return new URLSearchParams(values).toString();
}

function cookieHeader(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  const fallback = response.headers.get("set-cookie");
  const cookies = values.length > 0 ? values : fallback ? [fallback] : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

async function submitAction(baseUrl, path, cookie, values, label, expected = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "x-sveltekit-action": "true",
      cookie,
      origin: baseUrl,
    },
    body: form(values),
  });
  assertResponse(response, expected.httpStatus ?? 200, label);
  const serialized = await response.text();
  let result;
  try {
    result = JSON.parse(serialized);
  } catch (cause) {
    throw new Error(`${label} did not return a SvelteKit action result`, { cause });
  }
  const expectedType = expected.type ?? "success";
  const expectedActionStatus = expected.actionStatus ?? 200;
  if (result.type !== expectedType || result.status !== expectedActionStatus) {
    throw new Error(
      `${label} returned action ${result.type}/${result.status}, expected ${expectedType}/${expectedActionStatus}`,
    );
  }
  return { result, serialized };
}

function onlyRow(rows, label) {
  if (rows.length !== 1) throw new Error(`${label} returned ${rows.length} rows, expected one`);
  return rows[0];
}

function dateTimeInput(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 16);
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function runWebManagementE2e({
  baseUrl,
  adminCookie,
  queryControlDb,
  queryTelemetryDb,
}) {
  const machineAction = await submitAction(
    baseUrl,
    "/operations/admin?/machine",
    adminCookie,
    {
      name: "Edge E2E",
      expectedHost: "192.0.2.10",
      description: "Singapore edge gateway",
      labels: "region=ap-southeast-1\nrole=gateway",
      samplingIntervalSeconds: "15",
      reportIntervalSeconds: "120",
      offlineAfterSeconds: "300",
      containersEnabled: "on",
    },
    "administrator machine creation",
  );
  if (
    !machineAction.serialized.includes("token") ||
    !machineAction.serialized.includes("tokenId") ||
    !machineAction.serialized.includes("expiresAt")
  ) {
    throw new Error("machine creation did not return the one-time enrollment material");
  }
  const machine = onlyRow(
    queryControlDb(
      `SELECT id, telemetry_pk, description, labels_json, sampling_interval_seconds,
              report_interval_seconds, offline_after_seconds, container_monitoring_enabled,
              desired_config_revision
       FROM machines WHERE name = 'Edge E2E'`,
    ),
    "created machine lookup",
  );
  if (
    machine.description !== "Singapore edge gateway" ||
    machine.labels_json !== '{"region":"ap-southeast-1","role":"gateway"}' ||
    machine.sampling_interval_seconds !== 15 ||
    machine.report_interval_seconds !== 120 ||
    machine.offline_after_seconds !== 300 ||
    machine.container_monitoring_enabled !== 1 ||
    machine.desired_config_revision !== 1
  ) {
    throw new Error("machine creation did not persist the requested configuration");
  }
  const enrollment = onlyRow(
    queryControlDb(
      `SELECT id, revoked_at FROM agent_enrollment_tokens WHERE machine_id = '${machine.id}'`,
    ),
    "machine enrollment lookup",
  );
  if (enrollment.revoked_at !== null) throw new Error("machine enrollment token was not active");
  const maintenanceUntil = Date.now() + 2 * 60 * 60_000;
  await submitAction(
    baseUrl,
    `/operations/machines/${machine.id}?/updateConfig`,
    adminCookie,
    {
      name: "Edge E2E",
      expectedHost: "edge-e2e.example.test",
      description: "Updated edge gateway",
      labels: "region=ap-southeast-1\nrole=ingress",
      samplingIntervalSeconds: "30",
      reportIntervalSeconds: "120",
      offlineAfterSeconds: "420",
      maintenanceUntil: dateTimeInput(maintenanceUntil),
      timezoneOffsetMinutes: "0",
      containersEnabled: "on",
    },
    "administrator machine configuration update",
  );
  const updatedMachine = onlyRow(
    queryControlDb(
      `SELECT expected_host, description, labels_json, sampling_interval_seconds,
              report_interval_seconds, offline_after_seconds, maintenance_until,
              desired_config_revision
       FROM machines WHERE id = '${machine.id}'`,
    ),
    "updated machine configuration lookup",
  );
  if (
    updatedMachine.expected_host !== "edge-e2e.example.test" ||
    updatedMachine.description !== "Updated edge gateway" ||
    updatedMachine.labels_json !== '{"region":"ap-southeast-1","role":"ingress"}' ||
    updatedMachine.sampling_interval_seconds !== 30 ||
    updatedMachine.report_interval_seconds !== 120 ||
    updatedMachine.offline_after_seconds !== 420 ||
    updatedMachine.maintenance_until !== Math.floor(maintenanceUntil / 60_000) * 60_000 ||
    updatedMachine.desired_config_revision !== 2
  ) {
    throw new Error("machine configuration update did not persist or advance its revision");
  }
  const configurationAudit = onlyRow(
    queryControlDb(
      `SELECT before_digest, after_digest FROM audit_logs
       WHERE resource_id = '${machine.id}' AND action = 'machine.configuration.update'`,
    ),
    "machine configuration audit lookup",
  );
  if (!configurationAudit.before_digest || !configurationAudit.after_digest) {
    throw new Error("machine configuration update did not retain audit digests");
  }
  await submitAction(
    baseUrl,
    `/operations/machines/${machine.id}?/revokeEnrollment`,
    adminCookie,
    { tokenId: enrollment.id },
    "administrator enrollment token revocation",
  );
  const revokedEnrollment = onlyRow(
    queryControlDb(
      `SELECT revoked_at FROM agent_enrollment_tokens
       WHERE machine_id = '${machine.id}' AND id = '${enrollment.id}'`,
    ),
    "revoked enrollment token lookup",
  );
  if (revokedEnrollment.revoked_at === null) {
    throw new Error("enrollment token revocation was not persisted");
  }
  const regeneratedAction = await submitAction(
    baseUrl,
    `/operations/machines/${machine.id}?/regenerateEnrollment`,
    adminCookie,
    {},
    "administrator enrollment token regeneration",
  );
  if (
    !regeneratedAction.serialized.includes("tokenId") ||
    !regeneratedAction.serialized.includes("token")
  ) {
    throw new Error("token regeneration did not return one-time enrollment material");
  }
  const enrollmentTokens = queryControlDb(
    `SELECT id, revoked_at, used_at FROM agent_enrollment_tokens
     WHERE machine_id = '${machine.id}' ORDER BY created_at`,
  );
  if (
    enrollmentTokens.length !== 2 ||
    enrollmentTokens[0].revoked_at === null ||
    enrollmentTokens[1].revoked_at !== null ||
    enrollmentTokens[1].used_at !== null
  ) {
    throw new Error("token regeneration did not leave exactly one active unused token");
  }
  let response = await fetch(`${baseUrl}/operations/machines/${machine.id}?tab=config`, {
    headers: { cookie: adminCookie },
  });
  assertResponse(response, 200, "machine enrollment management view");
  const enrollmentPage = await response.text();
  if (
    !enrollmentPage.includes(enrollmentTokens[1].id) ||
    !enrollmentPage.includes("Replace token") ||
    !enrollmentPage.includes("SHA-256")
  ) {
    throw new Error("machine enrollment management omitted token actions or installer checksum");
  }
  const agentId = "018f5f7e-7d28-7e12-a521-100000000001";
  queryControlDb(
    `INSERT INTO agents
      (id, workspace_id, machine_id, identity_public_key, platform, arch, agent_version,
       protocol_version, status, applied_config_revision, created_at)
     SELECT '${agentId}', workspace_id, id, X'${"01".repeat(32)}', 'linux', 'x86_64',
       '0.1.0', 1, 'active', 1, ${Date.now()} FROM machines WHERE id = '${machine.id}'`,
  );
  const latestAt = Date.now();
  const containerInventory = JSON.stringify({
    observedAt: latestAt,
    catalogDigest: "24".repeat(32),
    runtimes: [
      {
        kind: "docker",
        instance: "default",
        availability: "available",
        version: "27.0.0",
        detailCode: "",
      },
      {
        kind: "colima-docker",
        instance: "default",
        availability: "stopped",
        version: "",
        detailCode: "profile_stopped",
      },
      {
        kind: "colima-containerd",
        instance: "default",
        availability: "absent",
        version: "",
        detailCode: "profile_absent",
      },
      {
        kind: "apple-container",
        instance: "default",
        availability: "available",
        version: "1.0.0",
        detailCode: "",
      },
    ],
    containers: [
      {
        id: "42".repeat(16),
        runtime: "apple-container",
        runtimeInstance: "default",
        name: "api-runtime-e2e",
        image: "example/api:1",
        state: "running",
        health: "healthy",
        startedAt: latestAt - 60_000,
        restartCount: 1,
        cpuPermille: 125,
        memoryUsedBytes: 134_217_728,
        memoryLimitBytes: 536_870_912,
        networkRxBps: 4_096,
        networkTxBps: 2_048,
        ports: [{ privatePort: 8080, publicPort: 8443, protocol: "tcp" }],
      },
    ],
  });
  queryTelemetryDb(
    `INSERT INTO machine_latest
      (machine_pk, workspace_pk, agent_id, observed_at, received_at, state,
       cpu_permille, memory_used_bytes, memory_total_bytes, storage_used_bytes,
       storage_total_bytes, network_rx_bps, network_tx_bps, network_rx_total,
       network_tx_total, report_id, container_inventory_json)
     VALUES (${machine.telemetry_pk}, 1, '${agentId}', ${latestAt}, ${latestAt}, 'healthy',
       420, 2147483648, 4294967296, 8589934592, 17179869184, 4096, 2048,
       1000000, 500000, X'01010101010101010101010101010101',
       ${sqlString(containerInventory)})`,
  );
  response = await fetch(`${baseUrl}/operations`, { headers: { cookie: adminCookie } });
  assertResponse(response, 200, "dashboard machine latest projection");
  const dashboard = await response.text();
  if (!dashboard.includes("Edge E2E") || !dashboard.includes("42.0%")) {
    throw new Error("dashboard did not render the newly reported machine latest state");
  }
  response = await fetch(`${baseUrl}/operations/machines/${machine.id}/latest`, {
    headers: { cookie: adminCookie },
  });
  assertResponse(response, 200, "administrator machine latest API");
  const latest = await response.json();
  if (latest.latest.cpuPermille !== 420 || latest.latest.state !== "healthy") {
    throw new Error("machine latest API did not return the durable telemetry projection");
  }
  response = await fetch(`${baseUrl}/operations/machines/${machine.id}`, {
    headers: { cookie: adminCookie },
  });
  assertResponse(response, 200, "administrator machine container projection");
  const machineDetail = await response.text();
  for (const expected of [
    "docker",
    "colima-docker",
    "colima-containerd",
    "apple-container",
    "api-runtime-e2e",
    "healthy",
  ]) {
    if (!machineDetail.includes(expected)) {
      throw new Error(`machine detail omitted container projection value ${expected}`);
    }
  }
  await submitAction(
    baseUrl,
    `/operations/machines/${machine.id}?/checkUpdate`,
    adminCookie,
    { bypassRollout: "on" },
    "administrator forced update check",
    { type: "redirect", actionStatus: 303 },
  );
  const queuedCommand = onlyRow(
    queryControlDb(
      `SELECT type, payload_json, state, attempt_limit, payload_schema_version
       FROM agent_commands WHERE agent_id = '${agentId}'`,
    ),
    "queued Agent command lookup",
  );
  if (
    queuedCommand.type !== "check_update" ||
    queuedCommand.payload_json !== '{"bypassRollout":true}' ||
    queuedCommand.state !== "pending" ||
    queuedCommand.attempt_limit !== 3 ||
    queuedCommand.payload_schema_version !== 1
  ) {
    throw new Error("forced update check was not queued with the allowlisted command schema");
  }

  await submitAction(
    baseUrl,
    "/operations/admin?/service",
    adminCookie,
    {
      name: "AlphaPing API E2E",
      description: "End-to-end HTTP monitor",
      kind: "http",
      executorKind: "cloudflare",
      executorAgentId: "",
      intervalSeconds: "60",
      timeoutMs: "5000",
      failureConfirmations: "2",
      recoveryConfirmations: "2",
      url: "https://example.com/health",
      method: "GET",
      expectedStatuses: "200, 204",
      degradedAfterMs: "1000",
      downAfterMs: "3000",
      maxResponseBytes: "65536",
      requestHeaders: "Accept: application/json",
      secretRequestHeaders: "X-Probe-Key: e2e-private-value",
      requestBody: "",
      hostname: "",
      tcpPayload: "",
      tcpResponsePrefix: "",
      assertionSource: "header",
      assertionOperator: "exists",
      assertionSelector: "content-type",
      assertionExpected: "",
      assertionSeverity: "down",
    },
    "administrator service creation",
  );
  const service = onlyRow(
    queryControlDb("SELECT id FROM services WHERE name = 'AlphaPing API E2E'"),
    "created service lookup",
  );
  const serviceMaintenanceUntil = Date.now() + 90 * 60_000;
  await submitAction(
    baseUrl,
    `/operations/services/${service.id}?/maintenance`,
    adminCookie,
    {
      maintenanceUntil: dateTimeInput(serviceMaintenanceUntil),
      timezoneOffsetMinutes: "0",
    },
    "administrator service maintenance update",
  );
  const maintainedService = onlyRow(
    queryControlDb(`SELECT maintenance_until FROM services WHERE id = '${service.id}'`),
    "service maintenance lookup",
  );
  if (
    maintainedService.maintenance_until !==
    Math.floor(serviceMaintenanceUntil / 60_000) * 60_000
  ) {
    throw new Error("service maintenance window was not persisted");
  }
  const compiledCheck = onlyRow(
    queryControlDb(
      `SELECT request_json, secret_refs_json,
        (SELECT COUNT(*) FROM check_assertions a WHERE a.check_id = c.id) AS assertion_count,
        (SELECT COUNT(*) FROM check_secrets s WHERE s.workspace_id = c.workspace_id) AS secret_count
       FROM check_configs c WHERE c.service_id = '${service.id}'`,
    ),
    "compiled check lookup",
  );
  if (
    compiledCheck.request_json.includes("e2e-private-value") ||
    compiledCheck.secret_refs_json.includes("e2e-private-value") ||
    compiledCheck.assertion_count !== 1 ||
    compiledCheck.secret_count !== 1
  ) {
    throw new Error("service secret wrapping or assertion persistence is incorrect");
  }

  for (const monitor of [
    {
      name: "Agent TCP E2E",
      description: "Agent-origin TCP probe",
      kind: "tcp",
      hostname: "192.0.2.20",
      port: "443",
      useTls: "on",
      tcpPayload: "PING",
      tcpResponsePrefix: "PONG",
    },
    {
      name: "Agent ICMP E2E",
      description: "Agent-origin ICMP probe",
      kind: "icmp",
      hostname: "192.0.2.21",
      port: "",
      useTls: "",
      tcpPayload: "",
      tcpResponsePrefix: "",
    },
  ]) {
    await submitAction(
      baseUrl,
      "/operations/admin?/service",
      adminCookie,
      {
        ...monitor,
        executorKind: "agent",
        executorAgentId: agentId,
        intervalSeconds: "5",
        timeoutMs: "1000",
        failureConfirmations: "2",
        recoveryConfirmations: "2",
        url: "",
        method: "GET",
        expectedStatuses: "200",
        degradedAfterMs: "250",
        downAfterMs: "750",
        maxResponseBytes: "65536",
        requestHeaders: "",
        secretRequestHeaders: "",
        requestBody: "",
        tcpPayloadIsSecret: "",
        assertionSource: "none",
        assertionOperator: "exists",
        assertionSelector: "",
        assertionExpected: "",
        assertionSeverity: "down",
      },
      `administrator ${monitor.kind.toUpperCase()} Agent service creation`,
    );
  }
  const agentChecks = queryControlDb(
    `SELECT s.name, c.kind, c.executor_kind, c.executor_agent_id,
            c.interval_seconds, c.assignment_revision, c.request_json
     FROM check_configs c JOIN services s ON s.id = c.service_id
     WHERE c.executor_agent_id = '${agentId}' ORDER BY c.assignment_revision`,
  );
  if (
    agentChecks.length !== 2 ||
    agentChecks[0].kind !== "tcp" ||
    agentChecks[1].kind !== "icmp" ||
    agentChecks.some(
      (check) =>
        check.executor_kind !== "agent" ||
        check.executor_agent_id !== agentId ||
        check.interval_seconds !== 5 ||
        check.assignment_revision <= 1,
    ) ||
    agentChecks[0].assignment_revision >= agentChecks[1].assignment_revision ||
    !agentChecks[0].request_json.includes('"port":443') ||
    !agentChecks[1].request_json.includes('"hostname":"192.0.2.21"')
  ) {
    throw new Error("Agent TCP/ICMP checks did not persist their executor, period, or revision");
  }
  const desiredRevision = onlyRow(
    queryControlDb(`SELECT desired_config_revision FROM machines WHERE id = '${machine.id}'`),
    "Agent assignment revision lookup",
  );
  if (desiredRevision.desired_config_revision !== agentChecks[1].assignment_revision) {
    throw new Error("Agent machine revision did not advance with its assigned checks");
  }

  await submitAction(
    baseUrl,
    "/operations/incidents?/incident",
    adminCookie,
    {
      title: "API response degradation",
      summary: "Elevated response latency is under investigation.",
      severity: "major",
      serviceIds: service.id,
      impact: "degraded",
      timezoneOffsetMinutes: "0",
    },
    "incident creation",
  );
  const incident = onlyRow(
    queryControlDb("SELECT id FROM incidents WHERE title = 'API response degradation'"),
    "created incident lookup",
  );
  const dashboardResponse = await fetch(`${baseUrl}/operations`, {
    headers: { cookie: adminCookie },
  });
  assertResponse(dashboardResponse, 200, "dashboard incident summary");
  const dashboardPage = await dashboardResponse.text();
  if (
    !dashboardPage.includes("Active incidents") ||
    !dashboardPage.includes('href="/operations/incidents?state=active"')
  ) {
    throw new Error("dashboard omitted the active incident filter metric");
  }
  for (const [path, expected, label] of [
    [
      "/operations/machines?status=online&sort=download",
      "Filter machine status",
      "machine filters",
    ],
    ["/operations/services?status=down", "Filter service status", "service filters"],
    ["/operations/incidents?state=active", "Active incidents", "incident filters"],
  ]) {
    const filteredResponse = await fetch(`${baseUrl}${path}`, {
      headers: { cookie: adminCookie },
    });
    assertResponse(filteredResponse, 200, label);
    if (!(await filteredResponse.text()).includes(expected)) {
      throw new Error(`${label} did not render their URL-backed state`);
    }
  }
  await submitAction(
    baseUrl,
    "/operations/incidents?/update",
    adminCookie,
    {
      incidentId: incident.id,
      state: "identified",
      body: "The upstream dependency has been isolated.",
    },
    "incident timeline update",
  );

  const now = Date.now();
  await submitAction(
    baseUrl,
    "/operations/incidents?/announcement",
    adminCookie,
    {
      title: "Planned network maintenance",
      body: "Traffic may briefly fail over between regions.",
      severity: "maintenance",
      visibility: "public",
      startsAt: dateTimeInput(now - 60_000),
      expiresAt: dateTimeInput(now + 60 * 60_000),
      timezoneOffsetMinutes: "0",
    },
    "active announcement creation",
  );
  await submitAction(
    baseUrl,
    "/operations/incidents?/announcement",
    adminCookie,
    {
      title: "Expired maintenance notice",
      body: "This notice must not appear on the public page.",
      severity: "info",
      visibility: "public",
      startsAt: dateTimeInput(now - 2 * 60 * 60_000),
      expiresAt: dateTimeInput(now - 60 * 60_000),
      timezoneOffsetMinutes: "0",
    },
    "expired announcement creation",
  );

  const inviteAction = await submitAction(
    baseUrl,
    "/operations/admin/access?/invite",
    adminCookie,
    { email: "member@example.test", role: "member" },
    "member invitation creation",
  );
  const token = inviteAction.serialized.match(/\/invite\/([A-Za-z0-9_-]{43})/)?.[1];
  if (!token) throw new Error("invitation action did not return a one-time URL");
  response = await fetch(`${baseUrl}/invite/${token}`);
  assertResponse(response, 200, "anonymous invitation view");
  const invitationPage = await response.text();
  if (!invitationPage.includes("me****@example.test")) {
    throw new Error("invitation page did not render the masked recipient");
  }
  response = await fetch(`${baseUrl}/invite/${token}`, {
    method: "POST",
    headers: {
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      origin: baseUrl,
    },
    body: form({ name: "E2E Member", password: "member correct horse battery staple" }),
    redirect: "manual",
  });
  assertResponse(response, 303, "member invitation acceptance");
  if (response.headers.get("location") !== "/operations") {
    throw new Error("accepted invitation did not redirect to its workspace");
  }
  const memberCookie = cookieHeader(response);
  if (!memberCookie.includes("alphaping")) {
    throw new Error("accepted invitation did not create an authenticated session");
  }
  const member = onlyRow(
    queryControlDb("SELECT id FROM user WHERE email = 'member@example.test'"),
    "invited member lookup",
  );

  response = await fetch(`${baseUrl}/operations/admin`, { headers: { cookie: memberCookie } });
  assertResponse(response, 404, "member developer panel access");
  response = await fetch(`${baseUrl}/operations/machines/${machine.id}`, {
    headers: { cookie: memberCookie },
  });
  assertResponse(response, 404, "ungranted member machine detail");
  response = await fetch(`${baseUrl}/operations/machines/${machine.id}/latest`, {
    headers: { cookie: memberCookie },
  });
  assertResponse(response, 404, "ungranted member machine API");
  response = await fetch(`${baseUrl}/operations/services/${service.id}`, {
    headers: { cookie: memberCookie },
  });
  assertResponse(response, 404, "ungranted member service detail");
  await submitAction(
    baseUrl,
    "/operations/admin?/machine",
    memberCookie,
    { name: "Unauthorized machine", expectedHost: "", containersEnabled: "on" },
    "member direct machine creation",
    { type: "failure", actionStatus: 404 },
  );
  await submitAction(
    baseUrl,
    "/operations/admin/access?/grant",
    adminCookie,
    {
      memberId: member.id,
      resourceType: "machine",
      resourceId: machine.id,
      permission: "view",
    },
    "machine view grant",
  );
  await submitAction(
    baseUrl,
    "/operations/admin/access?/grant",
    adminCookie,
    {
      memberId: member.id,
      resourceType: "service",
      resourceId: service.id,
      permission: "manage",
    },
    "service manage grant",
  );
  response = await fetch(`${baseUrl}/operations/machines/${machine.id}/latest`, {
    headers: { cookie: memberCookie },
  });
  assertResponse(response, 200, "granted member machine API");
  response = await fetch(`${baseUrl}/operations/services/${service.id}`, {
    headers: { cookie: memberCookie },
  });
  assertResponse(response, 200, "managed member service detail");
  await submitAction(
    baseUrl,
    `/operations/machines/${machine.id}?/checkUpdate`,
    memberCookie,
    { bypassRollout: "on" },
    "view-only member forced update check",
    { type: "failure", actionStatus: 404 },
  );
  await submitAction(
    baseUrl,
    `/operations/machines/${machine.id}?/regenerateEnrollment`,
    memberCookie,
    {},
    "view-only member enrollment token regeneration",
    { type: "failure", actionStatus: 404 },
  );
  await submitAction(
    baseUrl,
    `/operations/machines/${machine.id}?/updateConfig`,
    memberCookie,
    {
      name: "Unauthorized rename",
      expectedHost: "",
      description: "",
      labels: "",
      samplingIntervalSeconds: "10",
      reportIntervalSeconds: "60",
      offlineAfterSeconds: "150",
      maintenanceUntil: "",
      timezoneOffsetMinutes: "0",
    },
    "view-only member machine configuration update",
    { type: "failure", actionStatus: 404 },
  );
  await submitAction(
    baseUrl,
    "/operations/incidents?/incident",
    memberCookie,
    {
      title: "Member managed incident",
      summary: "A resource manager can open an incident.",
      severity: "minor",
      serviceIds: service.id,
      impact: "down",
      timezoneOffsetMinutes: "0",
    },
    "resource manager incident creation",
  );

  await submitAction(
    baseUrl,
    "/operations/admin/settings?/visibility",
    adminCookie,
    { visibility: "public" },
    "dashboard publication",
  );
  for (const [resourceType, resourceId] of [
    ["machine", machine.id],
    ["service", service.id],
  ]) {
    await submitAction(
      baseUrl,
      "/operations/admin/settings?/publicResource",
      adminCookie,
      {
        resourceType,
        resourceId,
        effect: "allow",
        projectionProfile: "summary",
      },
      `public ${resourceType} projection`,
    );
  }
  response = await fetch(`${baseUrl}/status/operations`);
  assertResponse(response, 200, "public status page");
  if (response.headers.get("cache-control") !== "public, max-age=30, stale-while-revalidate=300") {
    throw new Error("public status page cache policy is incorrect");
  }
  const publicPage = await response.text();
  for (const expected of [
    "Edge E2E",
    "AlphaPing API E2E",
    "API response degradation",
    "The upstream dependency has been isolated.",
    "Planned network maintenance",
  ]) {
    if (!publicPage.includes(expected)) throw new Error(`public status omitted ${expected}`);
  }
  for (const privateValue of ["192.0.2.10", "e2e-private-value", "Expired maintenance notice"]) {
    if (publicPage.includes(privateValue)) throw new Error(`public status leaked ${privateValue}`);
  }

  await submitAction(
    baseUrl,
    "/operations/admin/access?/grant",
    adminCookie,
    {
      memberId: member.id,
      resourceType: "machine",
      resourceId: machine.id,
      permission: "deny",
    },
    "explicit machine deny",
  );
  response = await fetch(`${baseUrl}/operations/machines/${machine.id}/latest`, {
    headers: { cookie: memberCookie },
  });
  assertResponse(response, 404, "explicitly denied member machine API");
  response = await fetch(`${baseUrl}/operations/machines/${machine.id}/latest`);
  assertResponse(response, 404, "guest machine API");

  for (const [resourceType, resourceId, path, label] of [
    ["service", service.id, "services", "service"],
    ["machine", machine.id, "machines", "machine"],
  ]) {
    await submitAction(
      baseUrl,
      `/operations/${path}/${resourceId}?/delete`,
      adminCookie,
      {},
      `administrator ${label} soft delete`,
      { type: "redirect", actionStatus: 303 },
    );
    const deleted = onlyRow(
      queryControlDb(`SELECT deleted_at FROM ${resourceType}s WHERE id = '${resourceId}'`),
      `${label} soft delete lookup`,
    );
    if (deleted.deleted_at === null) throw new Error(`${label} soft delete was not persisted`);
    response = await fetch(`${baseUrl}/operations/${path}/${resourceId}`, {
      headers: { cookie: adminCookie },
    });
    assertResponse(response, 404, `deleted ${label} detail denial`);
    const adminPage = await fetch(`${baseUrl}/operations/admin`, {
      headers: { cookie: adminCookie },
    });
    assertResponse(adminPage, 200, "deleted resource administration view");
    if (!(await adminPage.text()).includes("Recently deleted")) {
      throw new Error("admin page omitted recoverable resource section");
    }
    await submitAction(
      baseUrl,
      "/operations/admin?/restoreResource",
      adminCookie,
      { resourceType, resourceId },
      `administrator ${label} restore`,
    );
    const restored = onlyRow(
      queryControlDb(`SELECT deleted_at FROM ${resourceType}s WHERE id = '${resourceId}'`),
      `${label} restore lookup`,
    );
    if (restored.deleted_at !== null) throw new Error(`${label} restore was not persisted`);
  }
}
