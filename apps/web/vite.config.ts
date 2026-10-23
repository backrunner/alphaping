import adapter from "@sveltejs/adapter-cloudflare";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter({
        config: "wrangler.web.template.toml",
        platformProxy: { configPath: "wrangler.web.template.toml" },
      }),
      csp: {
        mode: "auto",
        directives: {
          "base-uri": ["self"],
          "connect-src": ["self", "wss:"],
          "default-src": ["self"],
          "font-src": ["self"],
          "form-action": ["self"],
          "frame-ancestors": ["none"],
          // Site administrators may provide a public HTTPS logo image. Images
          // load in the browser; scripts, fonts and other sources stay scoped.
          "img-src": ["self", "data:", "https:"],
          "manifest-src": ["self"],
          "object-src": ["none"],
          // The sha256 hash allowlists the anti-FOUC theme bootstrap inline
          // script in src/app.html. If that script changes, update the hash —
          // src/theme-bootstrap.test.ts enforces the match.
          "script-src": ["self", "sha256-vJnCzb5kEHvLbbccgsqqCkql3PfDBK6JLRuOeu5OHfk="],
          "style-src": ["self", "unsafe-inline"],
          "worker-src": ["self"],
        },
      },
      csrf: {
        trustedOrigins: [],
      },
    }),
  ],
});
