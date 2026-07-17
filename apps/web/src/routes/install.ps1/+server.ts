import { installerResponse } from "$lib/server/installers";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () => installerResponse("windows");
