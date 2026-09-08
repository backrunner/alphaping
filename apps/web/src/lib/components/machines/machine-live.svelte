<script lang="ts">
  import {
    LIVE_PROTOCOL,
    LIVE_TICKET_PROTOCOL_PREFIX,
    parseLiveViewerMessage,
    type LiveViewerSnapshot,
  } from "@alphaping/contracts";
  import type { DashboardMachine } from "@alphaping/db";
  import { Radio } from "@lucide/svelte";
  import { onMount, untrack } from "svelte";
  import { createRequestScope } from "$lib/state/request-scope";

  import {
    liveReconnectCeiling,
    parseMachineLiveFallback,
    parseMachineLiveTicket,
    type MachineLiveTicket,
  } from "$lib/state/machine-live";

  type LiveState = "idle" | "connecting" | "waiting" | "healthy" | "degraded";
  type Timer = ReturnType<typeof setTimeout>;

  interface Props {
    active: boolean;
    ticketEndpoint: string;
    fallbackEndpoint: string;
    initialObservedAt: number | null;
    onSnapshot: (snapshot: LiveViewerSnapshot) => void;
    onFallback: (latest: DashboardMachine) => void;
  }

  let {
    active,
    ticketEndpoint,
    fallbackEndpoint,
    initialObservedAt,
    onSnapshot,
    onFallback,
  }: Props = $props();

  let state = $state<LiveState>("idle");
  let socket: WebSocket | null = null;
  let ticketRequest: ReturnType<typeof createRequestScope> | null = null;
  let fallbackRequest: ReturnType<typeof createRequestScope> | null = null;
  let resourceKey = "";
  let lifecycle = 0;
  let reconnectAttempt = 0;
  let cachedTicket: MachineLiveTicket | null = null;
  function initialObservation() {
    return initialObservedAt ?? 0;
  }

  let newestObservedAt = initialObservation();
  let fallbackEtag: string | null = null;
  let handshakeTimer: Timer | undefined;
  let staleTimer: Timer | undefined;
  let demandTimer: Timer | undefined;
  let reconnectTimer: Timer | undefined;
  let credentialTimer: Timer | undefined;
  let fallbackTimer: Timer | undefined;

  const stateText = $derived.by(() => {
    if (state === "healthy") return "Live metrics connected";
    if (state === "degraded") return "Live unavailable. Durable data shown";
    if (state === "waiting") return "Waiting for live metrics";
    if (state === "connecting") return "Connecting live metrics";
    return "Durable metrics";
  });

  function clearTimers() {
    if (handshakeTimer !== undefined) clearTimeout(handshakeTimer);
    handshakeTimer = undefined;
    if (staleTimer !== undefined) clearTimeout(staleTimer);
    if (demandTimer !== undefined) clearInterval(demandTimer);
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
    if (credentialTimer !== undefined) clearTimeout(credentialTimer);
    if (fallbackTimer !== undefined) clearInterval(fallbackTimer);
    staleTimer = undefined;
    demandTimer = undefined;
    reconnectTimer = undefined;
    credentialTimer = undefined;
    fallbackTimer = undefined;
  }

  async function pollFallback() {
    if (fallbackRequest || !active || document.visibilityState !== "visible") return;
    const generation = lifecycle;
    const request = createRequestScope();
    fallbackRequest = request;
    try {
      const headers = new Headers();
      if (fallbackEtag) headers.set("if-none-match", fallbackEtag);
      const response = await fetch(fallbackEndpoint, {
        headers,
        cache: "no-store",
        signal: request.signal,
      });
      if (response.status === 304) return;
      if (!response.ok) throw new Error("fallback_failed");
      const latest = parseMachineLiveFallback(await response.json());
      if (request.signal.aborted || generation !== lifecycle || fallbackRequest !== request) return;
      fallbackEtag = response.headers.get("etag");
      if ((latest.observedAt ?? 0) >= newestObservedAt) {
        newestObservedAt = latest.observedAt ?? newestObservedAt;
        onFallback(latest);
      }
    } catch {
      // The existing durable snapshot remains visible until a later poll succeeds.
    } finally {
      request.dispose();
      if (fallbackRequest === request) fallbackRequest = null;
    }
  }

  function startFallback() {
    if (fallbackTimer !== undefined) return;
    void pollFallback();
    fallbackTimer = setInterval(() => void pollFallback(), 30_000);
  }

  function stopFallback() {
    if (fallbackTimer !== undefined) clearInterval(fallbackTimer);
    fallbackTimer = undefined;
    fallbackRequest?.cancel();
    fallbackRequest = null;
  }

  function markStale() {
    if (staleTimer !== undefined) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      state = "degraded";
      startFallback();
    }, 20_000);
  }

  function scheduleReconnect(generation: number) {
    if (!active || document.visibilityState !== "visible" || generation !== lifecycle) return;
    const ceiling = liveReconnectCeiling(reconnectAttempt);
    const delay = Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => void connect(), delay);
  }

  async function currentTicket(signal: AbortSignal): Promise<MachineLiveTicket> {
    if (cachedTicket && cachedTicket.expiresAt > Date.now() + 10_000) return cachedTicket;
    const response = await fetch(ticketEndpoint, { cache: "no-store", signal });
    if (!response.ok) throw new Error("live_ticket_failed");
    const ticketBody: unknown = await response.json();
    if (
      typeof ticketBody === "object" &&
      ticketBody !== null &&
      "available" in ticketBody &&
      ticketBody.available === false
    ) {
      throw new Error("live_unavailable");
    }
    signal.throwIfAborted();
    return parseMachineLiveTicket(ticketBody);
  }

  async function connect() {
    if (!active || document.visibilityState !== "visible" || socket || ticketRequest) return;
    const generation = lifecycle;
    state = "connecting";
    const request = createRequestScope();
    ticketRequest = request;
    try {
      const ticket = await currentTicket(request.signal);
      if (generation !== lifecycle || !active || document.visibilityState !== "visible") return;
      request.signal.throwIfAborted();
      cachedTicket = ticket;
      const connected = new WebSocket(ticket.url, [
        LIVE_PROTOCOL,
        `${LIVE_TICKET_PROTOCOL_PREFIX}${ticket.ticket}`,
      ]);
      socket = connected;
      connected.binaryType = "arraybuffer";
      const isCurrent = () => generation === lifecycle && socket === connected;
      handshakeTimer = setTimeout(() => {
        if (!isCurrent()) return;
        state = "degraded";
        startFallback();
        connected.close(1000, "Connection timed out");
      }, 15_000);
      connected.onopen = () => {
        if (!isCurrent() || connected.protocol !== LIVE_PROTOCOL) {
          connected.close(1002, "Protocol mismatch");
          return;
        }
        if (handshakeTimer !== undefined) clearTimeout(handshakeTimer);
        handshakeTimer = undefined;
        reconnectAttempt = 0;
        state = "waiting";
        const refreshDemand = () => {
          if (isCurrent() && connected.readyState === WebSocket.OPEN) {
            connected.send(JSON.stringify({ type: "demand_refresh" }));
          }
        };
        refreshDemand();
        demandTimer = setInterval(refreshDemand, 15_000);
        credentialTimer = setTimeout(
          () => connected.close(1000, "Ticket refresh"),
          Math.max(1_000, ticket.expiresAt - Date.now() - 10_000),
        );
        markStale();
      };
      connected.onmessage = (event) => {
        if (!isCurrent()) return;
        try {
          if (typeof event.data !== "string") throw new Error("invalid_live_projection");
          const snapshot = parseLiveViewerMessage(event.data);
          if (snapshot.topic !== ticket.topic || snapshot.observedAt <= newestObservedAt) return;
          newestObservedAt = snapshot.observedAt;
          state = "healthy";
          stopFallback();
          markStale();
          onSnapshot(snapshot);
        } catch {
          connected.close(1008, "Invalid live projection");
        }
      };
      connected.onerror = () => {
        if (!isCurrent()) return;
        state = "degraded";
        connected.close();
      };
      connected.onclose = () => {
        if (!isCurrent()) return;
        socket = null;
        if (handshakeTimer !== undefined) clearTimeout(handshakeTimer);
        if (staleTimer !== undefined) clearTimeout(staleTimer);
        handshakeTimer = undefined;
        staleTimer = undefined;
        if (cachedTicket && cachedTicket.expiresAt <= Date.now() + 10_000) cachedTicket = null;
        if (demandTimer !== undefined) clearInterval(demandTimer);
        if (credentialTimer !== undefined) clearTimeout(credentialTimer);
        demandTimer = undefined;
        credentialTimer = undefined;
        if (generation === lifecycle && active && document.visibilityState === "visible") {
          state = "degraded";
          startFallback();
          scheduleReconnect(generation);
        }
      };
    } catch {
      if (generation !== lifecycle) return;
      state = "degraded";
      startFallback();
      scheduleReconnect(generation);
    } finally {
      request.dispose();
      if (ticketRequest === request) ticketRequest = null;
    }
  }

  function stop() {
    lifecycle += 1;
    ticketRequest?.cancel();
    ticketRequest = null;
    stopFallback();
    clearTimers();
    socket?.close(1000, "Live metrics paused");
    socket = null;
    state = "idle";
  }

  $effect(() => {
    const key = `${ticketEndpoint}\n${fallbackEndpoint}`;
    const enabled = active;
    untrack(() => {
      if (resourceKey !== key) {
        resourceKey = key;
        cachedTicket = null;
        fallbackEtag = null;
        newestObservedAt = initialObservation();
        reconnectAttempt = 0;
      }
      if (enabled) void connect();
      else stop();
    });
    return stop;
  });

  onMount(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") stop();
      else if (active) void connect();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  });
</script>

{#if active}
  <div class="live-state" data-state={state} aria-live="polite" aria-atomic="true">
    <Radio size={12} aria-hidden="true" />
    <span>{stateText}</span>
  </div>
{/if}

<style>
  .live-state {
    display: inline-flex;
    min-height: 20px;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .live-state[data-state="healthy"] {
    color: var(--status-healthy);
  }

  .live-state[data-state="degraded"] {
    color: var(--status-degraded);
  }
</style>
