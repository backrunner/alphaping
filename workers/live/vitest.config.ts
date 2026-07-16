import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.live.template.toml" },
        miniflare: {
          bindings: {
            LIVE_TICKET_SECRET: "0123456789abcdef0123456789abcdef",
          },
        },
      },
    },
  },
});
