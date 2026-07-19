import type { PublicStatusPage } from "@alphaping/db";

export const PUBLIC_STATUS_SERVICE_PAGE_SIZE = 25;
export const PUBLIC_STATUS_MAX_SERVICE_PAGES = 8;

export type PublicStatusOverallState = "healthy" | "degraded" | "down" | "maintenance" | "unknown";

export type PublicStatusView = PublicStatusPage & {
  overallState: PublicStatusOverallState;
  servicePagination: {
    page: number;
    pageSize: number;
    pageCount: number;
    total: number;
    from: number;
    to: number;
  };
};

export function normalizePublicStatusServicePage(value: string | null): number {
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(parsed, PUBLIC_STATUS_MAX_SERVICE_PAGES) : 1;
}

function summarizeOverallState(page: PublicStatusPage): PublicStatusOverallState {
  const states = [
    ...page.machines.map((machine) => machine.state),
    ...page.services.map((service) => service.state),
  ];
  if (states.some((state) => state === "down" || state === "offline")) return "down";
  if (states.some((state) => state === "degraded")) return "degraded";
  if (states.some((state) => state === "maintenance")) return "maintenance";
  return states.length > 0 && states.every((state) => state === "healthy") ? "healthy" : "unknown";
}

export function buildPublicStatusView(
  page: PublicStatusPage,
  requestedPage: number,
): PublicStatusView {
  const total = page.services.length;
  const pageCount = Math.max(1, Math.ceil(total / PUBLIC_STATUS_SERVICE_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, requestedPage), pageCount);
  const offset = (currentPage - 1) * PUBLIC_STATUS_SERVICE_PAGE_SIZE;
  const to = Math.min(offset + PUBLIC_STATUS_SERVICE_PAGE_SIZE, total);
  return {
    ...page,
    services: page.services.slice(offset, to),
    overallState: summarizeOverallState(page),
    servicePagination: {
      page: currentPage,
      pageSize: PUBLIC_STATUS_SERVICE_PAGE_SIZE,
      pageCount,
      total,
      from: total === 0 ? 0 : offset + 1,
      to,
    },
  };
}
