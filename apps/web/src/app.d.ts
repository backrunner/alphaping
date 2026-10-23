import type { Auth } from "#lib/server/auth.ts";
import type { DomainRoute } from "#lib/server/domain-routing.ts";

declare global {
  namespace App {
    interface Locals {
      auth: Auth | null;
      domainRoute: DomainRoute | null;
      session: Awaited<ReturnType<Auth["api"]["getSession"]>>;
    }
  }
}

export {};
