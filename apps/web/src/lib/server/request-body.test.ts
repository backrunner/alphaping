import { describe, expect, it } from "vitest";

import {
  MAX_AUTH_REQUEST_BODY_BYTES,
  MAX_FORM_REQUEST_BODY_BYTES,
  requestBodyLimit,
  withBoundedRequestBody,
} from "./request-body.js";

function streamingRequest(chunks: readonly Uint8Array[], contentLength?: string): Request {
  const headers = new Headers({ "content-type": "application/octet-stream" });
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  return new Request("https://alphaping.example.test/action", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}

describe("bounded request bodies", () => {
  it("uses a tighter limit for Better Auth routes", () => {
    expect(requestBodyLimit("/api/auth/sign-in/email")).toBe(MAX_AUTH_REQUEST_BODY_BYTES);
    expect(requestBodyLimit("/operations/services/service-1")).toBe(MAX_FORM_REQUEST_BODY_BYTES);
  });

  it("rebuilds an in-limit streamed request without trusting content-length", async () => {
    const bounded = await withBoundedRequestBody(
      streamingRequest([new Uint8Array([1, 2]), new Uint8Array([3])], "1"),
      3,
    );

    expect(bounded.headers.get("content-length")).toBeNull();
    await expect(bounded.arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2, 3]).buffer);
  });

  it("rejects a chunked body that exceeds the declared and actual limit", async () => {
    const request = streamingRequest([new Uint8Array([1, 2]), new Uint8Array([3, 4])], "2");

    await expect(withBoundedRequestBody(request, 3)).rejects.toMatchObject({ status: 413 });
  });

  it("rejects an oversized declared body before consuming the stream", async () => {
    const request = new Request("https://alphaping.example.test/action", {
      method: "POST",
      headers: { "content-length": "10" },
      body: new Uint8Array([1]),
    });

    await expect(withBoundedRequestBody(request, 3)).rejects.toMatchObject({ status: 413 });
    expect(request.bodyUsed).toBe(false);
  });
});
