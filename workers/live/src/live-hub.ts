import { DurableObject } from "cloudflare:workers";

interface SocketAttachment {
  role: "agent" | "viewer";
  subjectId: string;
  topics: readonly string[];
  expiresAt: number;
}

const MAX_LIVE_FRAME_BYTES = 64 * 1024;
const DEMAND_TTL_MS = 30_000;

export class LiveHub extends DurableObject<Env> {
  private sendDemand(): void {
    const active = this.ctx.getWebSockets("viewer").length > 0;
    const message = JSON.stringify({
      type: "demand",
      active,
      expiresAt: active ? Date.now() + DEMAND_TTL_MS : Date.now(),
    });
    for (const socket of this.ctx.getWebSockets("agent")) {
      socket.send(message);
    }
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Upgrade required", { status: 426 });
    }
    const role = request.headers.get("x-alphaping-role");
    const subjectId = request.headers.get("x-alphaping-subject");
    const expiresAt = Number(request.headers.get("x-alphaping-expires"));
    const topics = JSON.parse(request.headers.get("x-alphaping-topics") ?? "[]") as unknown;
    if (
      (role !== "agent" && role !== "viewer") ||
      !subjectId ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() ||
      !Array.isArray(topics) ||
      !topics.every((topic) => typeof topic === "string")
    ) {
      return new Response("Unauthorized", { status: 401 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, subjectId, topics, expiresAt } satisfies SocketAttachment);
    if (role === "viewer") this.sendDemand();
    if (role === "agent" && this.ctx.getWebSockets("viewer").length > 0) this.sendDemand();
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): void {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment || attachment.expiresAt <= Date.now()) {
      socket.close(1008, "Ticket expired");
      return;
    }
    if (attachment.role !== "agent") return;
    const bytes =
      typeof message === "string"
        ? new TextEncoder().encode(message).byteLength
        : message.byteLength;
    if (bytes > MAX_LIVE_FRAME_BYTES) {
      socket.close(1009, "Frame too large");
      return;
    }
    for (const viewer of this.ctx.getWebSockets("viewer")) {
      const viewerAttachment = viewer.deserializeAttachment() as SocketAttachment | null;
      if (
        viewerAttachment &&
        viewerAttachment.expiresAt > Date.now() &&
        viewerAttachment.topics.some((topic) => attachment.topics.includes(topic))
      ) {
        viewer.send(message);
      }
    }
  }

  override webSocketClose(): void {
    this.sendDemand();
  }

  override webSocketError(): void {
    this.sendDemand();
  }
}
