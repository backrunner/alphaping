import type {
  PaginatedPublicStatusPage,
  PublicStatusOverallState as DbPublicStatusOverallState,
} from "@alphaping/db";

export const PUBLIC_STATUS_SERVICE_PAGE_SIZE = 25;
export const PUBLIC_STATUS_MAX_SERVICE_PAGES = 8;

export type PublicStatusOverallState = DbPublicStatusOverallState;
export type PublicStatusView = PaginatedPublicStatusPage;

export function normalizePublicStatusServicePage(value: string | null): number {
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(parsed, PUBLIC_STATUS_MAX_SERVICE_PAGES) : 1;
}
