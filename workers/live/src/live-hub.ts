import {
  LIVE_FRESHNESS_MS,
  MAX_LIVE_FRAME_BYTES,
  decryptAgentLiveFrame,
  decodeBase64Url,
  parseAgentLiveFrame,
} from "@alphaping/contracts";
import { DurableObject } from "cloudflare:workers";

interface BaseSocketAttachment {
  version: 1;
  subjectId: string;
  topics: readonly [string];
  expiresAt: number;
}

interface AgentSocketAttachment extends BaseSocketAttachment {
  role: "agent";
  projection: "internal";
  sessionId: string;
  noncePrefix: string;
}

interface ViewerSocketAttachment extends BaseSocketAttachment {
  role: "viewer";
  projection: "machine-summary";
}

type SocketAttachment = AgentSocketAttachment | ViewerSocketAttachment;

const DEMAND_TTL_MS = 30_000;
const MAX_LIVE_SEQUENCE = 1_000_000;
const MAX_SEQUENCE_JUMP = 1_024;

function attachment(socket: WebSocket): SocketAttachment | null {
  const value = socket.deserializeAttachment() as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const data = value as Readonly<Record<string, unknown>>;
  if (
    data.version !== 1 ||
    (data.role !== "agent" && data.role !== "viewer") ||
    typeof data.subjectId !== "string" ||
    !Array.isArray(data.topics) ||
    data.topics.length !== 1 ||
    typeof data.topics[0] !== "string" ||
    typeof data.expiresAt !== "number"
  ) {
    return null;
  }
  const topic = data.topics[0];
  if (typeof topic !== "string" || !Number.isSafeInteger(data.expiresAt)) return null;
  if (
    data.role === "agent" &&
    data.projection === "internal" &&
    typeof data.sessionId === "string" &&
    typeof data.noncePrefix === "string"
  ) {
    return {
      version: 1,
      role: "agent",
      subjectId: data.subjectId,
      topics: [topic],
      projection: "internal",
      expiresAt: data.expiresAt,
      sessionId: data.sessionId,
      noncePrefix: data.noncePrefix,
    };
  }
  if (data.role === "viewer" && data.projection === "machine-summary") {
    return {
      version: 1,
      role: "viewer",
      subjectId: data.subjectId,
      topics: [topic],
      projection: "machine-summary",
      expiresAt: data.expiresAt,
    };
  }
  return null;
}

function topicMachinePk(topic: string): number | null {
  const match = /^machine:([1-9][0-9]{0,19})$/.exec(topic);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

export class LiveHub extends DurableObject<Env> {
  private readonly highestSequences = new Map<string, number>();

  private hasViewer(topic: string, excluded?: WebSocket): boolean {
    const now = Date.now();
    return this.ctx.getWebSockets(`topic:${topic}`).some((socket) => {
      if (socket === excluded) return false;
      const current = attachment(socket);
      return current?.role === "viewer" && current.expiresAt > now;
    });
  }

  private sendDemand(topic: string, excludedViewer?: WebSocket): void {
    const active = this.hasViewer(topic, excludedViewer);
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets(`topic:${topic}`)) {
      const current = attachment(socket);
      if (current?.role !== "agent" || current.expiresAt <= now) continue;
      try {
        socket.send(
          JSON.stringify({
            type: "demand",
            topic,
            sessionId: current.sessionId,
            active,
            expiresAt: active ? now + DEMAND_TTL_MS : now,
          }),
        );
      } catch {
        socket.close(1011, "Demand delivery failed");
      }
    }
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Upgrade required", { status: 426 });
    }
    const role = request.headers.get("x-alphaping-role");
    const subjectId = request.headers.get("x-alphaping-subject");
    const projection = request.headers.get("x-alphaping-projection");
    const protocol = request.headers.get("x-alphaping-protocol");
    const expiresAt = Number(request.headers.get("x-alphaping-expires"));
    let topics: unknown;
    try {
      topics = JSON.parse(request.headers.get("x-alphaping-topics") ?? "null") as unknown;
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }
    if (
      (role !== "agent" && role !== "viewer") ||
      !subjectId ||
      subjectId.length > 128 ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= Date.now() ||
      !Array.isArray(topics) ||
      topics.length !== 1 ||
      typeof topics[0] !== "string" ||
      topicMachinePk(topics[0]) === null ||
      protocol !== "alphaping.v1"
    ) {
      return new Response("Unauthorized", { status: 401 });
    }

    let socketAttachment: SocketAttachment;
    if (role === "agent") {
      const sessionId = request.headers.get("x-alphaping-session");
      const noncePrefix = request.headers.get("x-alphaping-nonce-prefix");
      if (
        projection !== "internal" ||
        !sessionId ||
        decodeBase64Url(sessionId, 16).byteLength !== 16 ||
        !noncePrefix ||
        decodeBase64Url(noncePrefix, 4).byteLength !== 4
      ) {
        return new Response("Unauthorized", { status: 401 });
      }
      socketAttachment = {
        version: 1,
        role,
        subjectId,
        topics: [topics[0]],
        projection: "internal",
        expiresAt,
        sessionId,
        noncePrefix,
      };
    } else {
      if (projection !== "machine-summary") return new Response("Unauthorized", { status: 401 });
      socketAttachment = {
        version: 1,
        role,
        subjectId,
        topics: [topics[0]],
        projection: "machine-summary",
        expiresAt,
      };
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [role, `topic:${topics[0]}`]);
    server.serializeAttachment(socketAttachment);
    this.sendDemand(topics[0]);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": protocol },
    });
  }

  override async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const current = attachment(socket);
    const now = Date.now();
    if (!current || current.expiresAt <= now) {
      socket.close(1008, "Ticket expired");
      return;
    }
    if (current.role === "viewer") {
      if (typeof message !== "string" || message.length > 128) {
        socket.close(1003, "Unsupported viewer message");
        return;
      }
      let refresh: unknown;
      try {
        refresh = JSON.parse(message) as unknown;
      } catch {
        socket.close(1003, "Unsupported viewer message");
        return;
      }
      if (
        typeof refresh !== "object" ||
        refresh === null ||
        Array.isArray(refresh) ||
        (refresh as Readonly<Record<string, unknown>>).type !== "demand_refresh"
      ) {
        socket.close(1003, "Unsupported viewer message");
        return;
      }
      this.sendDemand(current.topics[0]);
      return;
    }
    if (typeof message === "string") {
      socket.close(1003, "Binary live frames required");
      return;
    }
    if (message.byteLength > MAX_LIVE_FRAME_BYTES) {
      socket.close(1009, "Frame too large");
      return;
    }
    if (!this.hasViewer(current.topics[0])) return;

    try {
      const frame = parseAgentLiveFrame(message);
      const machinePk = topicMachinePk(current.topics[0]);
      if (
        machinePk === null ||
        frame.sequence <= 0 ||
        frame.sequence > MAX_LIVE_SEQUENCE ||
        frame.observedAt < now - LIVE_FRESHNESS_MS ||
        frame.observedAt > now + 5_000
      ) {
        throw new Error("invalid_live_frame_bounds");
      }
      const highest = this.highestSequences.get(current.sessionId);
      if (
        highest !== undefined &&
        (frame.sequence <= highest || frame.sequence > highest + MAX_SEQUENCE_JUMP)
      ) {
        throw new Error("live_frame_replay");
      }
      const snapshot = await decryptAgentLiveFrame(frame, this.env.LIVE_TICKET_SECRET, {
        sessionId: current.sessionId,
        noncePrefix: current.noncePrefix,
        machinePk,
      });
      this.highestSequences.set(current.sessionId, frame.sequence);
      const projection = JSON.stringify(snapshot);
      for (const viewer of this.ctx.getWebSockets(`topic:${current.topics[0]}`)) {
        const viewerAttachment = attachment(viewer);
        if (
          viewerAttachment?.role === "viewer" &&
          viewerAttachment.expiresAt > now &&
          viewerAttachment.projection === "machine-summary"
        ) {
          try {
            viewer.send(projection);
          } catch {
            viewer.close(1011, "Snapshot delivery failed");
          }
        }
      }
    } catch {
      socket.close(1008, "Invalid live frame");
    }
  }

  override webSocketClose(socket: WebSocket): void {
    const current = attachment(socket);
    if (current?.role === "viewer") this.sendDemand(current.topics[0], socket);
    if (current?.role === "agent") this.highestSequences.delete(current.sessionId);
  }

  override webSocketError(socket: WebSocket): void {
    this.webSocketClose(socket);
  }
}
