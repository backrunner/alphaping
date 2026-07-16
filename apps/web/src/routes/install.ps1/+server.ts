import installer from "../../../../../scripts/install/install.ps1?raw";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () =>
  new Response(installer, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
