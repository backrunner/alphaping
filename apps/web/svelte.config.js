import adapter from "@sveltejs/adapter-cloudflare";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      $components: "src/lib/components",
    },
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
  },
};

export default config;
