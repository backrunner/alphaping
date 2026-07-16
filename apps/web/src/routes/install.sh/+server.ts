import installer from "../../../../../scripts/install/install.sh?raw";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () =>
  new Response(installer, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "text/x-shellscript; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
