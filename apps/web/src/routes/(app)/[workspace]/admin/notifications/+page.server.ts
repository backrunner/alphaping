import { error, fail, isHttpError, redirect } from "@sveltejs/kit";

import {
  createNotificationChannel,
  createNotificationRule,
  deleteNotificationChannel,
  deleteNotificationRule,
  loadNotificationPanel,
  updateNotificationChannel,
  type NotificationProvider,
} from "$lib/server/notifications";

import type { Actions, PageServerLoad } from "./$types";

function actionFailure(cause: unknown, kind: string) {
  const status = isHttpError(cause) ? cause.status : 400;
  const message = isHttpError(cause)
    ? cause.body.message
    : "The notification change could not be saved";
  return fail(status, { kind, message });
}

function configFromForm(form: FormData): Record<string, unknown> {
  return {
    apiKey: String(form.get("apiKey") ?? ""),
    from: String(form.get("from") ?? ""),
    recipients: String(form.get("recipients") ?? ""),
    replyTo: String(form.get("replyTo") ?? ""),
    relayUrl: String(form.get("relayUrl") ?? ""),
    relayToken: String(form.get("relayToken") ?? ""),
    webhookUrl: String(form.get("webhookUrl") ?? ""),
    botToken: String(form.get("botToken") ?? ""),
    chatId: String(form.get("chatId") ?? ""),
    endpoint: String(form.get("endpoint") ?? ""),
    deviceKey: String(form.get("deviceKey") ?? ""),
    group: String(form.get("group") ?? ""),
  };
}

export const load: PageServerLoad = async ({ locals, params, platform }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  return {
    workspace: params.workspace,
    notifications: await loadNotificationPanel(
      platform.env.CONTROL_DB,
      params.workspace,
      locals.session.user.id,
    ),
  };
};

export const actions: Actions = {
  createChannel: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "channel", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await createNotificationChannel(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        platform.env.NOTIFICATION_SECRET_WRAPPING_KEY,
        {
          name: String(form.get("name") ?? ""),
          provider: String(form.get("provider") ?? "") as NotificationProvider,
          config: configFromForm(form),
        },
      );
      return { kind: "channel", saved: true };
    } catch (cause) {
      return actionFailure(cause, "channel");
    }
  },
  updateChannel: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "channel", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await updateNotificationChannel(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        {
          channelId: String(form.get("channelId") ?? ""),
          name: String(form.get("name") ?? ""),
          enabled: form.get("enabled") === "on",
        },
      );
      return { kind: "channel", saved: true };
    } catch (cause) {
      return actionFailure(cause, "channel");
    }
  },
  deleteChannel: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "channel", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await deleteNotificationChannel(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        String(form.get("channelId") ?? ""),
      );
      return { kind: "channel", saved: true };
    } catch (cause) {
      return actionFailure(cause, "channel");
    }
  },
  createRule: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform) return fail(401, { kind: "rule", message: "Unauthorized" });
    const form = await request.formData();
    try {
      const resource = String(form.get("resource") ?? "");
      const separator = resource.indexOf("|");
      if (separator <= 0) throw error(400, "A resource is required");
      await createNotificationRule(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        {
          resourceType: resource.slice(0, separator) as "machine" | "service",
          resourceId: resource.slice(separator + 1),
          dimension: String(form.get("dimension") ?? "") as
            | "availability"
            | "resource"
            | "recovery",
          channelId: String(form.get("channelId") ?? ""),
        },
      );
      return { kind: "rule", saved: true };
    } catch (cause) {
      return actionFailure(cause, "rule");
    }
  },
  deleteRule: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform) return fail(401, { kind: "rule", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await deleteNotificationRule(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        String(form.get("ruleId") ?? ""),
      );
      return { kind: "rule", saved: true };
    } catch (cause) {
      return actionFailure(cause, "rule");
    }
  },
};
