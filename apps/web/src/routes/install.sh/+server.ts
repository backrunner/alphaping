import { installerResponse } from "#lib/server/installers.ts";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () => installerResponse("unix");
