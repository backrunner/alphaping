import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.live.template.toml" },
      miniflare: { bindings: { LIVE_TICKET_SECRET: "0123456789abcdef0123456789abcdef" } },
    }),
  ],
});
