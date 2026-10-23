import { env } from "cloudflare:workers";
import { agentReleaseResponse } from "#lib/server/agent-release.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ params }) =>
  agentReleaseResponse(params.target, env.AGENT_RELEASE_MANIFEST_JSON);
