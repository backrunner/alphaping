import { defineConfig } from "svedocs/config";
import { enMessages, zhMessages } from "./src/lib/messages.ts";
import { focusableCode } from "./src/lib/markdown.ts";

const siteUrl = process.env.DOCS_SITE_URL;

export default defineConfig({
  site: {
    name: "AlphaPing",
    title: "AlphaPing",
    description: "部署自己的基础设施监控，连接机器与服务，分享清晰的公开状态页。",
    ...(siteUrl ? { url: siteUrl } : {}),
  },
  build: { mode: "edge" },
  theme: {
    defaultMode: "system",
    readingStyle: "plain",
    palette: { accent: "#6550d5" },
    fonts: {
      sans: '"Geist Variable", system-ui, sans-serif',
      mono: '"Geist Mono Variable", ui-monospace, monospace',
      display: '"Geist Variable", system-ui, sans-serif',
    },
    radius: "24px",
    codeTheme: { light: "github-light", dark: "github-dark" },
    code: { copyButton: true, lineNumbers: false, wrap: false },
    brand: { label: "AlphaPing", href: "/", logo: "/alphaping.svg" },
    nav: [
      { label: "文档", labelKey: "nav.docs", href: "/docs" },
      { label: "部署指南", labelKey: "ap.nav.deploy", href: "/docs/start/deployment" },
      { label: "关于项目", labelKey: "ap.nav.about", href: "/about" },
    ],
    social: [{ label: "GitHub", href: "https://github.com/BackRunner/alphaping", external: true }],
    footer: { text: "AlphaPing · Apache-2.0" },
  },
  search: { provider: "local", scope: "current" },
  markdown: { shiki: { transformers: [focusableCode] } },
  ai: false,
  agent: { negotiation: false },
  seo: { ogImage: false, sitemap: Boolean(siteUrl), robots: true },
  source: { editBaseUrl: "https://github.com/BackRunner/alphaping/edit/main/apps/docs" },
  checks: { translations: true },
  i18n: {
    defaultLocale: "zh",
    locales: [
      { code: "zh", label: "简体中文", hreflang: "zh-CN" },
      { code: "en", label: "English", hreflang: "en" },
    ],
    prefixDefaultLocale: false,
    messages: { zh: zhMessages, en: enMessages },
  },
});
