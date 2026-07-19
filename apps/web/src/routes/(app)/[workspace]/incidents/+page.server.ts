import {
  IncidentCenterDataError,
  IncidentCenterNotFoundError,
  loadIncidentCenter,
} from "@alphaping/db";
import { error, fail, isHttpError, redirect } from "@sveltejs/kit";

import {
  appendIncidentUpdate,
  createAnnouncement,
  createIncident,
} from "$lib/server/incident-management";

import type { Actions, PageServerLoad } from "./$types";

function dateValue(
  value: FormDataEntryValue | null,
  timezoneOffsetMinutes: number,
  fallback = Number.NaN,
): number {
  if (typeof value !== "string" || value === "") return fallback;
  if (!Number.isInteger(timezoneOffsetMinutes) || Math.abs(timezoneOffsetMinutes) > 840) {
    throw error(400, "Browser timezone offset is invalid");
  }
  const localWallClock = Date.parse(`${value}Z`);
  if (!Number.isFinite(localWallClock)) throw error(400, "Date and time value is invalid");
  return localWallClock + timezoneOffsetMinutes * 60_000;
}

export const load: PageServerLoad = async ({ locals, params, platform }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  try {
    return await loadIncidentCenter(
      platform.env.CONTROL_DB,
      params.workspace,
      locals.session.user.id,
    );
  } catch (cause) {
    if (cause instanceof IncidentCenterNotFoundError) throw error(404, "Workspace not found");
    if (cause instanceof IncidentCenterDataError) {
      throw error(503, "Incident data exceeds the supported limit");
    }
    throw cause;
  }
};

export const actions: Actions = {
  incident: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform)
      return fail(401, { kind: "incident", message: "Unauthorized" });
    const form = await request.formData();
    const timezoneOffset = Number(form.get("timezoneOffsetMinutes"));
    try {
      await createIncident(platform.env.CONTROL_DB, params.workspace, locals.session.user.id, {
        title: String(form.get("title") ?? ""),
        summary: String(form.get("summary") ?? ""),
        severity: String(form.get("severity")) as "minor" | "major" | "critical",
        serviceIds: form.getAll("serviceIds").map(String),
        impact: String(form.get("impact")) as "degraded" | "down",
        startsAt: dateValue(form.get("startsAt"), timezoneOffset, Date.now()),
      });
      return { kind: "incident", created: true };
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Incident creation failed";
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "incident", message });
    }
  },
  update: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform) return fail(401, { kind: "update", message: "Unauthorized" });
    const form = await request.formData();
    try {
      await appendIncidentUpdate(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
        String(form.get("incidentId") ?? ""),
        {
          state: String(form.get("state")) as
            | "investigating"
            | "identified"
            | "monitoring"
            | "resolved",
          body: String(form.get("body") ?? ""),
        },
      );
      return { kind: "update", updated: true };
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Incident update failed";
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "update", message });
    }
  },
  announcement: async ({ request, locals, params, platform }) => {
    if (!locals.session || !platform) {
      return fail(401, { kind: "announcement", message: "Unauthorized" });
    }
    const form = await request.formData();
    const timezoneOffset = Number(form.get("timezoneOffsetMinutes"));
    try {
      await createAnnouncement(platform.env.CONTROL_DB, params.workspace, locals.session.user.id, {
        title: String(form.get("title") ?? ""),
        body: String(form.get("body") ?? ""),
        severity: String(form.get("severity")) as
          | "info"
          | "maintenance"
          | "minor"
          | "major"
          | "critical",
        visibility: String(form.get("visibility")) as "private" | "authenticated" | "public",
        startsAt: dateValue(form.get("startsAt"), timezoneOffset),
        expiresAt: dateValue(form.get("expiresAt"), timezoneOffset),
      });
      return { kind: "announcement", created: true };
    } catch (cause) {
      const message = isHttpError(cause) ? cause.body.message : "Announcement creation failed";
      return fail(isHttpError(cause) ? cause.status : 400, { kind: "announcement", message });
    }
  },
};
