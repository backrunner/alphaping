<script lang="ts">
  import {
    LIVE_PROTOCOL,
    LIVE_TICKET_PROTOCOL_PREFIX,
    parseLiveViewerMessage,
    type LiveViewerSnapshot,
  } from "@alphaping/contracts";
  import type { DashboardMachine } from "@alphaping/db";
  import { Radio } from "lucide-svelte";
  import { onMount } from "svelte";

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
  let abortController: AbortController | null = null;
  let lifecycle = 0;
  let reconnectAttempt = 0;
  let cachedTicket: MachineLiveTicket | null = null;
  function initialObservation() {
    return initialObservedAt ?? 0;
  }

  let newestObservedAt = initialObservation();
  let fallbackEtag: string | null = null;
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
    try {
      const headers = new Headers();
      if (fallbackEtag) headers.set("if-none-match", fallbackEtag);
      const response = await fetch(fallbackEndpoint, { headers, cache: "no-store" });
      if (response.status === 304) return;
      if (!response.ok) throw new Error("fallback_failed");
      fallbackEtag = response.headers.get("etag");
      const latest = parseMachineLiveFallback(await response.json());
      if ((latest.observedAt ?? 0) >= newestObservedAt) {
        newestObservedAt = latest.observedAt ?? newestObservedAt;
        onFallback(latest);
      }
    } catch {
      // The existing durable snapshot remains visible until a later poll succeeds.
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
    cachedTicket = parseMachineLiveTicket(ticketBody);
    return cachedTicket;
  }

  async function connect() {
    if (!active || document.visibilityState !== "visible" || socket) return;
    const generation = lifecycle;
    state = "connecting";
    abortController?.abort();
    abortController = new AbortController();
    try {
      const ticket = await currentTicket(abortController.signal);
      if (generation !== lifecycle || !active || document.visibilityState !== "visible") return;
      const connected = new WebSocket(ticket.url, [
        LIVE_PROTOCOL,
        `${LIVE_TICKET_PROTOCOL_PREFIX}${ticket.ticket}`,
      ]);
      socket = connected;
      connected.binaryType = "arraybuffer";
      connected.onopen = () => {
        if (generation !== lifecycle || connected.protocol !== LIVE_PROTOCOL) {
          connected.close(1002, "Protocol mismatch");
          return;
        }
        reconnectAttempt = 0;
        state = "waiting";
        const refreshDemand = () => {
          if (connected.readyState === WebSocket.OPEN) {
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
        state = "degraded";
      };
      connected.onclose = () => {
        if (socket === connected) socket = null;
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
    } catch (cause) {
      if (
        generation !== lifecycle ||
        (cause instanceof DOMException && cause.name === "AbortError")
      )
        return;
      state = "degraded";
      startFallback();
      scheduleReconnect(generation);
    }
  }

  function stop() {
    lifecycle += 1;
    abortController?.abort();
    abortController = null;
    clearTimers();
    socket?.close(1000, "Live metrics paused");
    socket = null;
    state = "idle";
  }

  $effect(() => {
    if (active) void connect();
    else stop();
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
    gap: 5px;
    color: var(--text-muted);
    font-size: 10px;
  }

  .live-state[data-state="healthy"] {
    color: var(--status-healthy);
  }

  .live-state[data-state="degraded"] {
    color: var(--status-degraded);
  }
</style>
