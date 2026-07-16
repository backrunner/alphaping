import { loadWorkspaceShell, WorkspaceShellNotFoundError } from "@alphaping/db";
import { error, redirect } from "@sveltejs/kit";

import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals, params, platform }) => {
  if (!locals.session) throw redirect(303, "/login");
  if (!platform) throw error(503, "Cloudflare bindings are unavailable");
  try {
    return {
      shell: await loadWorkspaceShell(
        platform.env.CONTROL_DB,
        params.workspace,
        locals.session.user.id,
      ),
    };
  } catch (cause) {
    if (cause instanceof WorkspaceShellNotFoundError) throw error(404, "Workspace not found");
    throw cause;
  }
};
