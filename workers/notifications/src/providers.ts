import type {
  DeliveryResult,
  NotificationPayload,
  NotificationProvider,
} from "./types.js";

const REQUEST_TIMEOUT_MS = 10_000;

interface RequestTarget {
  url: string;
  init: RequestInit;
}

function requiredString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`invalid_notification_config:${key}`);
  }
  return value.trim();
}

function optionalString(config: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = config[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`invalid_notification_config:${key}`);
  return value.trim();
}

function recipients(config: Readonly<Record<string, unknown>>): string[] {
  const value = config.recipients;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 20 ||
    value.some((entry) => typeof entry !== "string" || !entry.includes("@"))
  ) {
    throw new Error("invalid_notification_config:recipients");
  }
  return value.map((entry) => String(entry).trim());
}

function httpsUrl(value: string, allowedHost?: (host: string, path: string) => boolean): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (allowedHost && !allowedHost(url.hostname.toLowerCase(), url.pathname))
  ) {
    throw new Error("invalid_notification_config:url");
  }
  return url;
}

function message(payload: NotificationPayload): { subject: string; text: string } {
  const subject = `[AlphaPing] ${payload.resourceName}: ${payload.currentState}`;
  const text = [
    `${payload.resourceType === "machine" ? "Machine" : "Service"}: ${payload.resourceName}`,
    `Workspace: ${payload.workspace}`,
    `State: ${payload.previousState} -> ${payload.currentState}`,
    `Dimension: ${payload.dimension}`,
    `Reason: ${payload.reasonCode}`,
    `Time: ${new Date(payload.occurredAt).toISOString()}`,
  ].join("\n");
  return { subject, text };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] ?? character,
  );
}

function jsonRequest(url: URL | string, body: unknown, headers: HeadersInit = {}): RequestTarget {
  return {
    url: String(url),
    init: {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
  };
}

function buildRequest(
  provider: NotificationProvider,
  config: Readonly<Record<string, unknown>>,
  payload: NotificationPayload,
): RequestTarget {
  const content = message(payload);
  const html = `<pre style="font:14px/1.55 ui-monospace,monospace">${escapeHtml(content.text)}</pre>`;
  if (provider === "resend") {
    const replyTo = optionalString(config, "replyTo");
    return jsonRequest(
      "https://api.resend.com/emails",
      {
        from: requiredString(config, "from"),
        to: recipients(config),
        subject: content.subject,
        text: content.text,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      },
      { authorization: `Bearer ${requiredString(config, "apiKey")}` },
    );
  }
  if (provider === "smtp") {
    const relayUrl = httpsUrl(requiredString(config, "relayUrl"));
    const token = optionalString(config, "relayToken");
    return jsonRequest(
      relayUrl,
      {
        from: requiredString(config, "from"),
        to: recipients(config),
        subject: content.subject,
        text: content.text,
        html,
      },
      token ? { authorization: `Bearer ${token}` } : {},
    );
  }
  if (provider === "discord") {
    const webhook = httpsUrl(
      requiredString(config, "webhookUrl"),
      (host, path) =>
        (host === "discord.com" || host === "discordapp.com") &&
        path.startsWith("/api/webhooks/"),
    );
    return jsonRequest(webhook, { content: `${content.subject}\n\n${content.text}`.slice(0, 2_000) });
  }
  if (provider === "slack") {
    const webhook = httpsUrl(
      requiredString(config, "webhookUrl"),
      (host, path) => host === "hooks.slack.com" && path.startsWith("/services/"),
    );
    return jsonRequest(webhook, { text: `*${content.subject}*\n${content.text}`.slice(0, 4_000) });
  }
  if (provider === "telegram") {
    const botToken = requiredString(config, "botToken");
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
      throw new Error("invalid_notification_config:botToken");
    }
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    return jsonRequest(url, {
      chat_id: requiredString(config, "chatId"),
      text: `${content.subject}\n\n${content.text}`.slice(0, 4_096),
      disable_web_page_preview: true,
    });
  }
  const endpoint = httpsUrl(optionalString(config, "endpoint") ?? "https://api.day.app");
  const deviceKey = requiredString(config, "deviceKey");
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/${encodeURIComponent(deviceKey)}`;
  return jsonRequest(endpoint, {
    title: content.subject,
    body: content.text,
    group: optionalString(config, "group") ?? "AlphaPing",
    isArchive: "1",
  });
}

function resultForResponse(response: Response): DeliveryResult {
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  return {
    ok: response.ok,
    retryable,
    status: response.status,
    error: response.ok ? null : retryable ? "provider_temporarily_unavailable" : "provider_rejected",
  };
}

export async function sendNotification(
  provider: NotificationProvider,
  config: Readonly<Record<string, unknown>>,
  payload: NotificationPayload,
  fetcher: typeof fetch = fetch,
): Promise<DeliveryResult> {
  let target: RequestTarget;
  try {
    target = buildRequest(provider, config, payload);
  } catch (cause) {
    return {
      ok: false,
      retryable: false,
      status: null,
      error: cause instanceof Error ? cause.message.slice(0, 160) : "invalid_notification_config",
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return resultForResponse(
      await fetcher(target.url, { ...target.init, signal: controller.signal }),
    );
  } catch (cause) {
    return {
      ok: false,
      retryable: true,
      status: null,
      error:
        cause instanceof DOMException && cause.name === "AbortError"
          ? "provider_timeout"
          : "provider_network_error",
    };
  } finally {
    clearTimeout(timeout);
  }
}
