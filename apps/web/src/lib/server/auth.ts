import { authSchema } from "@alphaping/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { sveltekitCookies } from "better-auth/svelte-kit";
import { drizzle } from "drizzle-orm/d1";
import { getRequestEvent } from "$app/server";

export function createAuth(db: D1Database, secret: string, baseURL: string) {
  return betterAuth({
    appName: "AlphaPing",
    baseURL,
    secret,
    database: drizzleAdapter(drizzle(db, { schema: authSchema }), {
      provider: "sqlite",
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    advanced: {
      cookiePrefix: "alphaping",
      useSecureCookies: baseURL.startsWith("https://"),
    },
    plugins: [sveltekitCookies(getRequestEvent)],
  });
}

export type Auth = ReturnType<typeof createAuth>;
