import { env, runInDurableObject, SELF } from "cloudflare:test";
import { signViewerLiveTicket } from "@alphaping/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { liveConnectionAvailable } from "./live-hub.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const WORKSPACE = "workspace-live-test";
const SESSION = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const PREFIX = new Uint8Array([9, 8, 7, 6]);
const sockets: WebSocket[] = [];
const messageQueues = new WeakMap<WebSocket, Array<string | ArrayBuffer>>();
const messageWaiters = new WeakMap<WebSocket, Array<(message: string | ArrayBuffer) => void>>();

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

async function keyedDigest(label: string, parts: readonly Uint8Array[]): Promise<Uint8Array> {
  const labelBytes = new TextEncoder().encode(label);
  const input = new Uint8Array(
    labelBytes.length + parts.reduce((total, part) => total + part.length + 1, 0),
  );
  input.set(labelBytes, 0);
  let offset = labelBytes.length;
  for (const part of parts) {
    input[offset] = 0;
    input.set(part, offset + 1);
    offset += part.length + 1;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, input));
}

async function agentTicket(machinePk: number, now = Date.now()): Promise<string> {
  const payload = base64Url(
    new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        workspaceId: WORKSPACE,
        subjectId: "agent-1",
        role: "agent",
        topics: [`machine:${machinePk}`],
        projection: "internal",
        issuedAt: now,
        notBefore: now,
        expiresAt: now + 15 * 60_000,
        sessionId: base64Url(SESSION),
        noncePrefix: base64Url(PREFIX),
      }),
    ),
  );
  const signature = await keyedDigest("alphaping/v1/live-ticket", [
    new TextEncoder().encode(payload),
  ]);
  return `${payload}.${base64Url(signature)}`;
}

async function connect(ticket: string): Promise<WebSocket> {
  const response = await SELF.fetch(`https://live.example.test/v1/live/${WORKSPACE}`, {
    headers: {
      Upgrade: "websocket",
      "Sec-WebSocket-Protocol": `alphaping.v1, alphaping.ticket.${ticket}`,
    },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  expect(socket).not.toBeNull();
  if (!socket) throw new Error("missing test websocket");
  messageQueues.set(socket, []);
  messageWaiters.set(socket, []);
  socket.addEventListener("message", (event) => {
    const waiter = messageWaiters.get(socket)?.shift();
    if (waiter) waiter(event.data);
    else messageQueues.get(socket)?.push(event.data);
  });
  socket.accept();
  sockets.push(socket);
  return socket;
}

function nextMessage(socket: WebSocket): Promise<string | ArrayBuffer> {
  const queued = messageQueues.get(socket)?.shift();
  if (queued !== undefined) return Promise.resolve(queued);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("message timeout")), 1_000);
    messageWaiters.get(socket)?.push((message) => {
      clearTimeout(timeout);
      resolve(message);
    });
  });
}

function nextClose(socket: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("close timeout")), 1_000);
    socket.addEventListener(
      "close",
      (event) => {
        clearTimeout(timeout);
        resolve(event);
      },
      { once: true },
    );
  });
}

function varint(value: number): number[] {
  let remaining = BigInt(value);
  const result: number[] = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    result.push(byte);
  } while (remaining > 0n);
  return result;
}

async function liveFrame(machinePk: number, sequence: number, observedAt = Date.now()) {
  const values = [observedAt, 420, 2_048, 8_192, 4_096, 16_384, 512, 256, 65_536, 32_768];
  const plaintext = new Uint8Array(
    values.flatMap((value, index) => [((index + 1) << 3) | 0, ...varint(value)]),
  );
  const aad = new Uint8Array(44);
  aad.set([0x41, 0x50, 0x4c, 0x31], 0);
  aad.set(SESSION, 4);
  const view = new DataView(aad.buffer);
  view.setBigUint64(20, BigInt(machinePk), false);
  view.setBigUint64(28, BigInt(sequence), false);
  view.setBigUint64(36, BigInt(observedAt), false);
  const nonce = new Uint8Array(12);
  nonce.set(PREFIX, 0);
  new DataView(nonce.buffer).setBigUint64(4, BigInt(sequence), false);
  const sessionKey = await keyedDigest("alphaping/v1/live-key", [SESSION]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce.buffer, additionalData: aad.buffer, tagLength: 128 },
      await crypto.subtle.importKey("raw", ownedBuffer(sessionKey), "AES-GCM", false, ["encrypt"]),
      ownedBuffer(plaintext),
    ),
  );
  const frame = new Uint8Array(48 + ciphertext.length);
  frame.set(aad, 0);
  new DataView(frame.buffer).setUint32(44, ciphertext.length, false);
  frame.set(ciphertext, 48);
  return frame.buffer;
}

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close(1000, "test complete");
});

describe("LiveHub", () => {
  it("keeps live connection admission bounded", () => {
    expect(liveConnectionAvailable(0, 4)).toBe(true);
    expect(liveConnectionAvailable(3, 4)).toBe(true);
    expect(liveConnectionAvailable(4, 4)).toBe(false);
    expect(liveConnectionAvailable(-1, 4)).toBe(false);
    expect(liveConnectionAvailable(Number.POSITIVE_INFINITY, 4)).toBe(false);
  });

  it("isolates topics, decrypts frames, and rejects replay without storage writes", async () => {
    const agent = await connect(await agentTicket(7));
    const firstDemand = JSON.parse(String(await nextMessage(agent))) as { active: boolean };
    expect(firstDemand.active).toBe(false);

    const otherViewerTicket = await signViewerLiveTicket(
      { workspaceId: WORKSPACE, subjectId: "viewer-2", machinePk: 8 },
      SECRET,
    );
    const otherViewer = await connect(otherViewerTicket.ticket);
    let otherTopicReceived = false;
    otherViewer.addEventListener("message", () => (otherTopicReceived = true));

    const viewerTicket = await signViewerLiveTicket(
      { workspaceId: WORKSPACE, subjectId: "viewer-1", machinePk: 7 },
      SECRET,
    );
    const viewer = await connect(viewerTicket.ticket);
    const activeDemand = JSON.parse(String(await nextMessage(agent))) as { active: boolean };
    expect(activeDemand.active).toBe(true);

    const stub = env.LIVE_HUBS.getByName(WORKSPACE);
    const beforeSize = await runInDurableObject(stub, (_instance, state) =>
      Promise.resolve(state.storage.sql.databaseSize),
    );
    const frame = await liveFrame(7, 1);
    agent.send(frame);
    const snapshot = JSON.parse(String(await nextMessage(viewer))) as {
      topic: string;
      cpuPermille: number;
    };
    expect(snapshot).toMatchObject({ topic: "machine:7", cpuPermille: 420 });
    expect(otherTopicReceived).toBe(false);
    const persistedState = await runInDurableObject(stub, (_instance, state) => {
      const agentSocket = state.getWebSockets("agent")[0];
      const agentAttachment = agentSocket?.deserializeAttachment() as
        | { highestSequence?: unknown }
        | undefined;
      return Promise.resolve({
        databaseSize: state.storage.sql.databaseSize,
        highestSequence: agentAttachment?.highestSequence,
      });
    });
    expect(persistedState).toEqual({ databaseSize: beforeSize, highestSequence: 1 });

    const closed = nextClose(agent);
    agent.send(frame);
    await expect(closed).resolves.toMatchObject({ code: 1008 });
  });

  it("reserves a sequence before asynchronous decryption", async () => {
    const agent = await connect(await agentTicket(10));
    await nextMessage(agent);
    const viewerTicket = await signViewerLiveTicket(
      { workspaceId: WORKSPACE, subjectId: "viewer-1", machinePk: 10 },
      SECRET,
    );
    const viewer = await connect(viewerTicket.ticket);
    await nextMessage(agent);

    const frame = await liveFrame(10, 1);
    const closed = nextClose(agent);
    agent.send(frame);
    agent.send(frame);

    const snapshot = JSON.parse(String(await nextMessage(viewer))) as { topic: string };
    expect(snapshot.topic).toBe("machine:10");
    await expect(closed).resolves.toMatchObject({ code: 1008 });
  });

  it("closes oversized Agent frames and refreshes topic demand", async () => {
    const agent = await connect(await agentTicket(9));
    await nextMessage(agent);
    const viewerTicket = await signViewerLiveTicket(
      { workspaceId: WORKSPACE, subjectId: "viewer-1", machinePk: 9 },
      SECRET,
    );
    const viewer = await connect(viewerTicket.ticket);
    await nextMessage(agent);
    viewer.send(JSON.stringify({ type: "demand_refresh" }));
    const refreshed = JSON.parse(String(await nextMessage(agent))) as { active: boolean };
    expect(refreshed.active).toBe(true);

    const closed = nextClose(agent);
    agent.send(new Uint8Array(16 * 1024 + 1).buffer);
    await expect(closed).resolves.toMatchObject({ code: 1009 });
  });
});
