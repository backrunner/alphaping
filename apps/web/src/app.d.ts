import type { Auth } from "$lib/server/auth";
import type { DomainRoute } from "$lib/server/domain-routing";

declare global {
  namespace App {
    interface Locals {
      auth: Auth | null;
      domainRoute: DomainRoute | null;
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
