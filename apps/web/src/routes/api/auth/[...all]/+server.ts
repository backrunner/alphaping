import type { RequestHandler } from "./$types";

const handle: RequestHandler = async ({ request, locals }) => {
  if (!locals.auth) return new Response("Unavailable", { status: 503 });
  return locals.auth.handler(request);
};

export const GET = handle;
export const POST = handle;
