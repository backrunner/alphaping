import { redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, platform }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) throw redirect(303, "/login");
  const workspace = await platform.env.CONTROL_DB.prepare(
    `SELECT w.slug FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
     WHERE m.user_id = ? AND m.status = 'active' AND w.deleted_at IS NULL
     ORDER BY w.created_at LIMIT 1`,
  )
    .bind(locals.session.user.id)
    .first<{ slug: string }>();
  if (!workspace) throw redirect(303, "/setup");
  throw redirect(303, `/${workspace.slug}`);
};
