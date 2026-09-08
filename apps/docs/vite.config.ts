import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { svedocs } from "svedocs/vite";
import config from "./svedocs.config.ts";

export default defineConfig({
  build: {
    license: { fileName: "third-party-licenses.txt" },
    rolldownOptions: {
      output: {
        postBanner:
          "/*! Third-party licenses: /third-party-licenses.txt and /third-party-notices.txt */",
      },
    },
  },
  plugins: [
    {
      name: "alphaping-license-notices",
      apply: "build",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "third-party-notices.txt",
          source: readFileSync(new URL("../../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8"),
        });
      },
    },
    svedocs({
      config,
      theme: {
        components: {
          Navbar: "$lib/theme/Navbar.svelte",
          DocsShell: "$lib/theme/DocsShell.svelte",
          Sidebar: "$lib/theme/Sidebar.svelte",
          Footer: "$lib/theme/Footer.svelte",
          ThemeToggle: "$lib/theme/ThemeToggle.svelte",
        },
      },
    }),
    tailwindcss(),
    sveltekit(),
  ],
});
