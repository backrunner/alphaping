import type { PublicStatusPage } from "@alphaping/db";

import {
  normalizePublicStatusServicePage,
  PUBLIC_STATUS_MAX_SERVICE_PAGES,
  PUBLIC_STATUS_SERVICE_PAGE_SIZE,
  type PublicStatusView,
} from "$lib/public-status-view";

export const PUBLIC_STATUS_SNAPSHOT_TTL_SECONDS = 5 * 60;
export const PUBLIC_STATUS_FRESH_CACHE_TTL_SECONDS = 30;
export const PUBLIC_STATUS_SNAPSHOT_CACHE = "alphaping-public-status-v2";

const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const serviceStates = new Set(["healthy", "degraded", "down", "maintenance", "unknown"]);
const machineStates = new Set(["healthy", "degraded", "down", "offline", "maintenance", "unknown"]);

interface PublicStatusSnapshot {
  version: 2;
  cachedAt: number;
  page: PublicStatusView;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number, allowEmpty = true): string | null {
  return typeof value === "string" && value.length <= maximum && (allowEmpty || value.length > 0)
    ? value
    : null;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : null;
}

function nullableInteger(
  value: unknown,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number | null | undefined {
  return value === null ? null : (integer(value, minimum, maximum) ?? undefined);
}

function boundedArray<T>(
  value: unknown,
  maximum: number,
  sanitize: (item: unknown) => T | null,
): readonly T[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const result: T[] = [];
  for (const item of value) {
    const sanitized = sanitize(item);
    if (sanitized === null) return null;
    result.push(sanitized);
  }
  return result;
}

function sanitizeMachine(value: unknown): PublicStatusPage["machines"][number] | null {
  if (!isRecord(value)) return null;
  const slug = boundedString(value.slug, 200, false);
  const name = boundedString(value.name, 200, false);
  const description = boundedString(value.description, 2_000);
  const observedAt = nullableInteger(value.observedAt);
  const cpuPermille = nullableInteger(value.cpuPermille, 0, 1_000);
  const memoryUsedBytes = nullableInteger(value.memoryUsedBytes);
  const memoryTotalBytes = nullableInteger(value.memoryTotalBytes);
  const storageUsedBytes = nullableInteger(value.storageUsedBytes);
  const storageTotalBytes = nullableInteger(value.storageTotalBytes);
  const networkRxBps = nullableInteger(value.networkRxBps);
  const networkTxBps = nullableInteger(value.networkTxBps);
  const containers = boundedArray(value.containers, 500, (item) => {
    if (!isRecord(item)) return null;
    const containerName = boundedString(item.name, 200, false);
    const state = boundedString(item.state, 64, false);
    const health = boundedString(item.health, 64, false);
    const containerCpu = nullableInteger(item.cpuPermille, 0, 1_000);
    const containerMemory = nullableInteger(item.memoryUsedBytes);
    if (
      containerName === null ||
      state === null ||
      health === null ||
      containerCpu === undefined ||
      containerMemory === undefined
    ) {
      return null;
    }
    return {
      name: containerName,
      state,
      health,
      cpuPermille: containerCpu,
      memoryUsedBytes: containerMemory,
    };
  });
  if (
    slug === null ||
    name === null ||
    description === null ||
    typeof value.state !== "string" ||
    !machineStates.has(value.state) ||
    observedAt === undefined ||
    cpuPermille === undefined ||
    memoryUsedBytes === undefined ||
    memoryTotalBytes === undefined ||
    storageUsedBytes === undefined ||
    storageTotalBytes === undefined ||
    networkRxBps === undefined ||
    networkTxBps === undefined ||
    containers === null
  ) {
    return null;
  }
  return {
    slug,
    name,
    description,
    state: value.state as PublicStatusPage["machines"][number]["state"],
    observedAt,
    cpuPermille,
    memoryUsedBytes,
    memoryTotalBytes,
    storageUsedBytes,
    storageTotalBytes,
    networkRxBps,
    networkTxBps,
    containers,
  };
}

function sanitizeService(value: unknown): PublicStatusPage["services"][number] | null {
  if (!isRecord(value)) return null;
  const name = boundedString(value.name, 200, false);
  const slug = boundedString(value.slug, 200, false);
  const description = boundedString(value.description, 2_000);
  const lastCheckedAt = nullableInteger(value.lastCheckedAt);
  const lastTransitionAt = nullableInteger(value.lastTransitionAt);
  const availability = nullableInteger(value.availability24hPermille, 0, 1_000);
  const timeline = boundedArray(value.timeline, 48, (item) => {
    if (!isRecord(item)) return null;
    const bucketStart = integer(item.bucketStart);
    const bucketAvailability = nullableInteger(item.availabilityPermille, 0, 1_000);
    const latencyMs = nullableInteger(item.latencyMs, 0, 120_000);
    const summaryCode =
      item.summaryCode === null ? null : boundedString(item.summaryCode, 128, false);
    if (
      bucketStart === null ||
      typeof item.state !== "string" ||
      !serviceStates.has(item.state) ||
      bucketAvailability === undefined ||
      latencyMs === undefined ||
      (summaryCode === null && item.summaryCode !== null)
    ) {
      return null;
    }
    return {
      bucketStart,
      state: item.state as PublicStatusPage["services"][number]["timeline"][number]["state"],
      availabilityPermille: bucketAvailability,
      latencyMs,
      summaryCode,
    };
  });
  if (
    name === null ||
    slug === null ||
    description === null ||
    typeof value.state !== "string" ||
    !serviceStates.has(value.state) ||
    lastCheckedAt === undefined ||
    lastTransitionAt === undefined ||
    availability === undefined ||
    timeline === null
  ) {
    return null;
  }
  return {
    name,
    slug,
    description,
    state: value.state as PublicStatusPage["services"][number]["state"],
    lastCheckedAt,
    lastTransitionAt,
    availability24hPermille: availability,
    timeline,
  };
}

function sanitizeIncident(value: unknown): PublicStatusPage["incidents"][number] | null {
  if (!isRecord(value)) return null;
  const id = boundedString(value.id, 128, false);
  const title = boundedString(value.title, 300, false);
  const summary = boundedString(value.summary, 4_000);
  const startsAt = integer(value.startsAt);
  const resolvedAt = nullableInteger(value.resolvedAt);
  const affectedServices = boundedArray(value.affectedServices, 200, (item) => {
    if (!isRecord(item)) return null;
    const name = boundedString(item.name, 200, false);
    const impact = item.impact;
    if (name === null || (impact !== "degraded" && impact !== "down")) return null;
    return { name, impact } as const;
  });
  const updates = boundedArray(value.updates, 20, (item) => {
    if (!isRecord(item)) return null;
    const updateId = boundedString(item.id, 128, false);
    const state = boundedString(item.state, 64, false);
    const body = boundedString(item.body, 8_000);
    const publishedAt = integer(item.publishedAt);
    if (updateId === null || state === null || body === null || publishedAt === null) return null;
    return { id: updateId, state, body, publishedAt };
  });
  if (
    id === null ||
    title === null ||
    summary === null ||
    (value.severity !== "minor" && value.severity !== "major" && value.severity !== "critical") ||
    (value.state !== "investigating" &&
      value.state !== "identified" &&
      value.state !== "monitoring" &&
      value.state !== "resolved") ||
    startsAt === null ||
    resolvedAt === undefined ||
    affectedServices === null ||
    updates === null
  ) {
    return null;
  }
  return {
    id,
    title,
    summary,
    severity: value.severity,
    state: value.state,
    startsAt,
    resolvedAt,
    affectedServices,
    updates,
  };
}

function sanitizeAnnouncement(value: unknown): PublicStatusPage["announcements"][number] | null {
  if (!isRecord(value)) return null;
  const id = boundedString(value.id, 128, false);
  const title = boundedString(value.title, 300, false);
  const body = boundedString(value.body, 8_000);
  const startsAt = integer(value.startsAt);
  const expiresAt = integer(value.expiresAt);
  if (
    id === null ||
    title === null ||
    body === null ||
    (value.severity !== "info" &&
      value.severity !== "maintenance" &&
      value.severity !== "minor" &&
      value.severity !== "major" &&
      value.severity !== "critical") ||
    startsAt === null ||
    expiresAt === null
  ) {
    return null;
  }
  return { id, title, body, severity: value.severity, startsAt, expiresAt };
}

function sanitizePage(value: unknown, workspaceSlug: string): PublicStatusPage | null {
  if (!isRecord(value) || !isRecord(value.workspace) || !isRecord(value.dashboard)) return null;
  const workspaceName = boundedString(value.workspace.name, 200, false);
  const slug = boundedString(value.workspace.slug, 200, false);
  const dashboardName = boundedString(value.dashboard.name, 200, false);
  const machines = boundedArray(value.machines, 200, sanitizeMachine);
  const services = boundedArray(value.services, 200, sanitizeService);
  const incidents = boundedArray(value.incidents, 20, sanitizeIncident);
  const announcements = boundedArray(value.announcements, 20, sanitizeAnnouncement);
  const updatedAt = nullableInteger(value.updatedAt);
  if (
    workspaceName === null ||
    slug === null ||
    slug !== workspaceSlug ||
    dashboardName === null ||
    machines === null ||
    services === null ||
    incidents === null ||
    announcements === null ||
    updatedAt === undefined
  ) {
    return null;
  }
  return {
    workspace: { name: workspaceName, slug },
    dashboard: { name: dashboardName },
    machines,
    services,
    incidents,
    announcements,
    updatedAt,
  };
}

function sanitizeView(value: unknown, workspaceSlug: string): PublicStatusView | null {
  if (!isRecord(value) || !isRecord(value.servicePagination)) return null;
  const page = sanitizePage(value, workspaceSlug);
  const pagination = value.servicePagination;
  const currentPage = integer(pagination.page, 1, PUBLIC_STATUS_MAX_SERVICE_PAGES);
  const pageSize = integer(pagination.pageSize, PUBLIC_STATUS_SERVICE_PAGE_SIZE);
  const pageCount = integer(pagination.pageCount, 1, PUBLIC_STATUS_MAX_SERVICE_PAGES);
  const total = integer(pagination.total, 0, 200);
  const from = integer(pagination.from, 0, 200);
  const to = integer(pagination.to, 0, 200);
  if (
    !page ||
    typeof value.overallState !== "string" ||
    !serviceStates.has(value.overallState) ||
    currentPage === null ||
    pageSize !== PUBLIC_STATUS_SERVICE_PAGE_SIZE ||
    pageCount === null ||
    total === null ||
    from === null ||
    to === null ||
    pageCount !== Math.max(1, Math.ceil(total / pageSize)) ||
    currentPage > pageCount
  ) {
    return null;
  }
  const expectedFrom = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const expectedTo = Math.min(currentPage * pageSize, total);
  if (
    from !== expectedFrom ||
    to !== expectedTo ||
    page.services.length !== (total === 0 ? 0 : to - from + 1)
  ) {
    return null;
  }
  return {
    ...page,
    overallState: value.overallState as PublicStatusView["overallState"],
    servicePagination: { page: currentPage, pageSize, pageCount, total, from, to },
  };
}

function visibleAnnouncements(
  page: PublicStatusView,
  now: number,
): PublicStatusView["announcements"] {
  return page.announcements.filter(
    (announcement) => announcement.startsAt <= now && announcement.expiresAt > now,
  );
}

export function publicStatusSnapshotKey(
  origin: string,
  workspaceSlug: string,
  servicePage = 1,
): Request {
  const normalizedPage = normalizePublicStatusServicePage(String(servicePage));
  const url = new URL(
    `/__alphaping_cache__/public-status/v2/${encodeURIComponent(workspaceSlug)}/services/${normalizedPage}`,
    origin,
  );
  return new Request(url, { method: "GET" });
}

export function buildPublicStatusSnapshot(
  page: PublicStatusView,
  cachedAt: number,
): PublicStatusSnapshot {
  const sanitized = sanitizeView(page, page.workspace.slug);
  if (!sanitized || integer(cachedAt) === null) throw new Error("invalid_public_status_snapshot");
  return { version: 2, cachedAt, page: sanitized };
}

export function parsePublicStatusSnapshot(
  value: string,
  workspaceSlug: string,
  now: number,
): { page: PublicStatusView; cachedAt: number } | null {
  if (value.length === 0 || value.length > MAX_SNAPSHOT_BYTES) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || parsed.version !== 2) return null;
    const cachedAt = integer(parsed.cachedAt);
    if (
      cachedAt === null ||
      cachedAt > now + 60_000 ||
      now - cachedAt > PUBLIC_STATUS_SNAPSHOT_TTL_SECONDS * 1_000
    ) {
      return null;
    }
    const page = sanitizeView(parsed.page, workspaceSlug);
    return page
      ? {
          page: { ...page, announcements: visibleAnnouncements(page, now) },
          cachedAt,
        }
      : null;
  } catch {
    return null;
  }
}

export function publicStatusSnapshotFreshMaxAge(cachedAt: number, now: number): number | null {
  if (!Number.isSafeInteger(cachedAt) || !Number.isSafeInteger(now) || cachedAt > now) return null;
  const remainingMs = PUBLIC_STATUS_FRESH_CACHE_TTL_SECONDS * 1_000 - (now - cachedAt);
  return remainingMs < 0 ? null : Math.ceil(remainingMs / 1_000);
}

async function readBoundedSnapshotText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_SNAPSHOT_BYTES
  ) {
    throw new Error("public_status_snapshot_too_large");
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SNAPSHOT_BYTES) {
        throw new Error("public_status_snapshot_too_large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function writePublicStatusSnapshot(
  cache: Cache,
  origin: string,
  page: PublicStatusView,
  cachedAt: number,
  servicePage = page.servicePagination.page,
): Promise<void> {
  const snapshot = buildPublicStatusSnapshot(page, cachedAt);
  const serialized = JSON.stringify(snapshot);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new Error("public_status_snapshot_too_large");
  }
  await cache.put(
    publicStatusSnapshotKey(origin, page.workspace.slug, servicePage),
    new Response(serialized, {
      headers: {
        "cache-control": `public, max-age=${PUBLIC_STATUS_SNAPSHOT_TTL_SECONDS}`,
        "content-type": "application/json",
      },
    }),
  );
}

export async function readPublicStatusSnapshot(
  cache: Cache,
  origin: string,
  workspaceSlug: string,
  now: number,
  servicePage = 1,
): Promise<{ page: PublicStatusView; cachedAt: number } | null> {
  const response = await cache.match(publicStatusSnapshotKey(origin, workspaceSlug, servicePage));
  if (!response) return null;
  try {
    return parsePublicStatusSnapshot(await readBoundedSnapshotText(response), workspaceSlug, now);
  } catch {
    return null;
  }
}
