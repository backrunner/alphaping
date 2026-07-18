export type SetupEnvironmentCheckId =
  | "control-db"
  | "telemetry-db"
  | "auth-secrets"
  | "auth-rate-limiters"
  | "data-secrets"
  | "worker-runtime";

export interface SetupEnvironmentCheck {
  id: SetupEnvironmentCheckId;
  label: string;
  detail: string;
  ready: boolean;
}

export interface SetupEnvironmentReport {
  ready: boolean;
  checks: SetupEnvironmentCheck[];
}

export interface SetupEnvironmentSnapshot {
  controlTables: readonly string[] | null;
  telemetryTables: readonly string[] | null;
  betterAuthSecret: string;
  setupToken: string;
  enrollmentTokenPepper: string;
  checkSecretWrappingKey: string;
  liveTicketSecret: string;
  ingestOrigin: string;
  liveOrigin: string;
  webCryptoAvailable: boolean;
  authRateLimitersAvailable: boolean;
}

const CONTROL_TABLES = [
  "account",
  "dashboards",
  "installations",
  "memberships",
  "retention_policies",
  "telemetry_resource_sequences",
  "user",
  "workspaces",
] as const;

const TELEMETRY_TABLES = [
  "check_result_blocks_5m",
  "machine_latest",
  "retention_cursors",
  "telemetry_blocks_5m",
] as const;

function hasRequiredTables(actual: readonly string[] | null, required: readonly string[]): boolean {
  if (!actual) return false;
  const available = new Set(actual);
  return required.every((table) => available.has(table));
}

function configuredTextSecret(value: string): boolean {
  return (
    value.length >= 32 &&
    value.length <= 512 &&
    !/(change[-_ ]?me|example|placeholder|replace)/i.test(value)
  );
}

function configuredHexSecret(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value) && !/^([0-9a-f])\1{63}$/i.test(value);
}

function validOrigin(value: string, protocol: "https:" | "wss:"): boolean {
  if (value.length === 0 || value.length > 256) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === protocol &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.host.length > 0
    );
  } catch {
    return false;
  }
}

export function evaluateSetupEnvironment(
  snapshot: SetupEnvironmentSnapshot,
): SetupEnvironmentReport {
  const checks: SetupEnvironmentCheck[] = [
    {
      id: "control-db",
      label: "Control database",
      detail: hasRequiredTables(snapshot.controlTables, CONTROL_TABLES)
        ? "D1 is reachable and control migrations are present"
        : "CONTROL_DB is unavailable or requires migrations",
      ready: hasRequiredTables(snapshot.controlTables, CONTROL_TABLES),
    },
    {
      id: "telemetry-db",
      label: "Telemetry database",
      detail: hasRequiredTables(snapshot.telemetryTables, TELEMETRY_TABLES)
        ? "D1 is reachable and telemetry migrations are present"
        : "TELEMETRY_DB is unavailable or requires migrations",
      ready: hasRequiredTables(snapshot.telemetryTables, TELEMETRY_TABLES),
    },
    {
      id: "auth-secrets",
      label: "Initialization secrets",
      detail:
        configuredTextSecret(snapshot.betterAuthSecret) && configuredTextSecret(snapshot.setupToken)
          ? "Setup and authentication secrets meet the minimum length"
          : "SETUP_TOKEN and BETTER_AUTH_SECRET must be configured",
      ready:
        configuredTextSecret(snapshot.betterAuthSecret) &&
        configuredTextSecret(snapshot.setupToken),
    },
    {
      id: "auth-rate-limiters",
      label: "Authentication rate limits",
      detail: snapshot.authRateLimitersAvailable
        ? "Client and account credential rate limiters are available"
        : "AUTH_EDGE_RATE_LIMITER or AUTH_ACCOUNT_RATE_LIMITER is unavailable",
      ready: snapshot.authRateLimitersAvailable,
    },
    {
      id: "data-secrets",
      label: "Data channel secrets",
      detail:
        configuredHexSecret(snapshot.enrollmentTokenPepper) &&
        configuredHexSecret(snapshot.checkSecretWrappingKey) &&
        configuredTextSecret(snapshot.liveTicketSecret)
          ? "Enrollment, check, and live channel secrets are configured"
          : "Enrollment, check, or live channel secrets are missing",
      ready:
        configuredHexSecret(snapshot.enrollmentTokenPepper) &&
        configuredHexSecret(snapshot.checkSecretWrappingKey) &&
        configuredTextSecret(snapshot.liveTicketSecret),
    },
    {
      id: "worker-runtime",
      label: "Worker endpoints",
      detail:
        snapshot.webCryptoAvailable &&
        validOrigin(snapshot.ingestOrigin, "https:") &&
        validOrigin(snapshot.liveOrigin, "wss:")
          ? "Web Crypto and secure ingest/live origins are available"
          : "Worker crypto or secure service origins are unavailable",
      ready:
        snapshot.webCryptoAvailable &&
        validOrigin(snapshot.ingestOrigin, "https:") &&
        validOrigin(snapshot.liveOrigin, "wss:"),
    },
  ];
  return { ready: checks.every((check) => check.ready), checks };
}

async function tableNames(db: D1Database): Promise<string[] | null> {
  try {
    const result = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all<{ name: string }>();
    return result.results.map((row) => row.name);
  } catch {
    return null;
  }
}

export async function inspectSetupEnvironment(env: Env): Promise<SetupEnvironmentReport> {
  const [controlTables, telemetryTables] = await Promise.all([
    tableNames(env.CONTROL_DB),
    tableNames(env.TELEMETRY_DB),
  ]);
  return evaluateSetupEnvironment({
    controlTables,
    telemetryTables,
    betterAuthSecret: env.BETTER_AUTH_SECRET,
    setupToken: env.SETUP_TOKEN,
    enrollmentTokenPepper: env.ENROLLMENT_TOKEN_PEPPER,
    checkSecretWrappingKey: env.CHECK_SECRET_WRAPPING_KEY,
    liveTicketSecret: env.LIVE_TICKET_SECRET,
    ingestOrigin: env.INGEST_ORIGIN,
    liveOrigin: env.LIVE_ORIGIN,
    webCryptoAvailable:
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function" &&
      typeof crypto.subtle !== "undefined",
    authRateLimitersAvailable:
      typeof env.AUTH_EDGE_RATE_LIMITER?.limit === "function" &&
      typeof env.AUTH_ACCOUNT_RATE_LIMITER?.limit === "function",
  });
}

export function unavailableSetupEnvironment(): SetupEnvironmentReport {
  return {
    ready: false,
    checks: [
      {
        id: "worker-runtime",
        label: "Cloudflare runtime",
        detail: "Cloudflare bindings are unavailable in this environment",
        ready: false,
      },
    ],
  };
}
