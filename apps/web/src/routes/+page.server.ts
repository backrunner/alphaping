import { redirect } from "@sveltejs/kit";

import { listUserWorkspaces } from "$lib/server/workspace-lifecycle";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, platform }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) throw redirect(303, "/login");
  const workspaces = await listUserWorkspaces(platform.env.CONTROL_DB, locals.session.user.id);
  const active = workspaces.filter((workspace) => workspace.deletedAt === null);
  if (active.length === 1 && active[0]) throw redirect(303, `/${active[0].slug}`);
  throw redirect(303, "/workspaces");
};
