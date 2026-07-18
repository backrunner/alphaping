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
        "img-src": ["self", "data:"],
        "manifest-src": ["self"],
        "object-src": ["none"],
        "script-src": ["self"],
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
