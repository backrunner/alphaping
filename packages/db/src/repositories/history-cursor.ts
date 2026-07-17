import { decodeBase64Url, encodeBase64Url } from "@alphaping/contracts";

export type HistoryResolution = "raw" | "5m" | "1h";

interface HistoryCursorPayload {
  v: 1;
  resolution: HistoryResolution;
  last: number;
}

export class HistoryCursorError extends Error {}

function isResolution(value: unknown): value is HistoryResolution {
  return value === "raw" || value === "5m" || value === "1h";
}

export function encodeHistoryCursor(resolution: HistoryResolution, last: number): string {
  if (!Number.isSafeInteger(last) || last < 0) throw new HistoryCursorError();
  const payload: HistoryCursorPayload = { v: 1, resolution, last };
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodeHistoryCursor(
  value: string | null,
  resolution: HistoryResolution,
): number | null {
  if (value === null) return null;
  if (value.length === 0 || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HistoryCursorError();
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(value, 96))) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new HistoryCursorError();
    }
    const data = parsed as Readonly<Record<string, unknown>>;
    if (
      Object.keys(data).length !== 3 ||
      data.v !== 1 ||
      !isResolution(data.resolution) ||
      data.resolution !== resolution ||
      typeof data.last !== "number" ||
      !Number.isSafeInteger(data.last) ||
      data.last < 0
    ) {
      throw new HistoryCursorError();
    }
    return data.last;
  } catch (cause) {
    if (cause instanceof HistoryCursorError) throw cause;
    throw new HistoryCursorError();
  }
}
