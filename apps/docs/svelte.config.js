import adapter from "@sveltejs/adapter-cloudflare";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { svedocsPreprocess, svedocsSvelteExtensions } from "svedocs/svelte";

export default {
  extensions: svedocsSvelteExtensions,
  preprocess: [vitePreprocess(), svedocsPreprocess()],
  kit: {
    adapter: adapter({
      config: "wrangler.docs.template.toml",
      platformProxy: { configPath: "wrangler.docs.template.toml", persist: false },
    }),
  },
};
