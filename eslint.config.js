import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import ts from "typescript-eslint";

import svelteConfig from "./apps/web/svelte.config.js";

export default defineConfig([
  {
    ignores: [
      "**/.svelte-kit/**",
      "**/.turbo/**",
      "**/.wrangler/**",
      "**/build/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/output/**",
      "**/target/**",
      "**/worker-configuration.d.ts",
      "apps/web/src/worker-env.d.ts",
      "workers/*/src/env.d.ts",
      "workers/*/src/test-env.d.ts",
    ],
  },
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  svelte.configs.prettier,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        extraFileExtensions: [".svelte"],
        parser: ts.parser,
        svelteConfig,
      },
    },
  },
  {
    files: ["**/*.{ts,svelte}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "svelte/no-navigation-without-resolve": "off",
      "svelte/require-each-key": "off",
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
]);
