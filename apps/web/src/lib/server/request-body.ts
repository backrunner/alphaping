import { error } from "@sveltejs/kit";

export const MAX_AUTH_REQUEST_BODY_BYTES = 16 * 1024;
export const MAX_FORM_REQUEST_BODY_BYTES = 512 * 1024;

export function requestBodyLimit(pathname: string): number {
  return pathname.startsWith("/api/auth")
    ? MAX_AUTH_REQUEST_BODY_BYTES
    : MAX_FORM_REQUEST_BODY_BYTES;
}

export async function withBoundedRequestBody(
  request: Request,
  maximumBytes: number,
): Promise<Request> {
  if (!request.body) return request;
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > maximumBytes
  ) {
    throw error(413, "Request body is too large");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw error(413, "Request body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request, { body, headers });
}
