import type { Auth } from "$lib/server/auth";

declare global {
  namespace App {
    interface Locals {
      auth: Auth | null;
      session: Awaited<ReturnType<Auth["api"]["getSession"]>>;
    }

    interface Platform {
      env: Env;
      ctx: ExecutionContext;
      caches: CacheStorage;
    }
  }
}

export {};
