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

export async function runWebManagementE2e({ baseUrl, adminCookie, queryControlDb }) {
  const machineAction = await submitAction(
    baseUrl,
    "/operations/admin?/machine",
    adminCookie,
    {
      name: "Edge E2E",
      expectedHost: "192.0.2.10",
      containersEnabled: "on",
    },
    "administrator machine creation",
  );
  if (
    !machineAction.serialized.includes("token") ||
    !machineAction.serialized.includes("expiresAt")
  ) {
    throw new Error("machine creation did not return the one-time enrollment material");
  }
  const machine = onlyRow(
    queryControlDb("SELECT id FROM machines WHERE name = 'Edge E2E'"),
    "created machine lookup",
  );
  const enrollment = onlyRow(
    queryControlDb(
      `SELECT COUNT(*) AS count FROM agent_enrollment_tokens WHERE machine_id = '${machine.id}'`,
    ),
    "machine enrollment lookup",
  );
  if (enrollment.count !== 1) throw new Error("machine enrollment token was not persisted once");

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
  let response = await fetch(`${baseUrl}/invite/${token}`);
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
}
