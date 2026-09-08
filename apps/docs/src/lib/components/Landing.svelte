<script lang="ts">
  import {
    ArrowRight,
    ArrowUpRight,
    Check,
    Cloud,
    CodeXml,
    Server,
    Radio,
    ShieldCheck,
    History,
    Container,
  } from "@lucide/svelte";
  import { resolveLocalizedHref } from "svedocs/theme/headless";
  import type { SvedocsThemeContext } from "svedocs/theme/types";
  let { context }: { context: SvedocsThemeContext } = $props();
  const href = (path: string) => resolveLocalizedHref(path, context);
  const guides = [
    { key: "deploy", icon: Cloud, href: "/docs/start/deployment", number: "01" },
    { key: "agent", icon: Server, href: "/docs/start/agent", number: "02" },
    { key: "services", icon: Radio, href: "/docs/guides/services", number: "03" },
  ];
  const details = [
    { key: "machine", icon: Container, href: "/docs/guides/machines" },
    { key: "history", icon: History, href: "/docs/reference/architecture" },
    { key: "access", icon: ShieldCheck, href: "/docs/guides/permissions" },
  ];
</script>

<div class="ap-landing">
  <section class="ap-hero" aria-labelledby="hero-title">
    <div class="ap-hero-copy">
      <p class="ap-eyebrow">
        <span class="ap-signal-dot" aria-hidden="true"></span>{context.t("ap.hero.kicker")}
      </p>
      <h1 id="hero-title">
        {context.t("ap.hero.first")}<br /><span>{context.t("ap.hero.second")}</span>
      </h1>
      <p class="ap-hero-description">{context.t("ap.hero.description")}</p>
      <div class="ap-actions">
        <a class="ap-button ap-button-primary" href={href("/docs/start/deployment")}
          >{context.t("ap.start")}<ArrowRight size={18} /></a
        >
        <a class="ap-button ap-button-secondary" href="https://github.com/BackRunner/alphaping"
          ><CodeXml size={18} />{context.t("ap.source")}</a
        >
      </div>
      <div class="ap-hero-notes">
        <span><Check size={14} />{context.t("ap.hero.platforms")}</span><span
          >{context.t("ap.hero.license")}</span
        >
      </div>
    </div>
    <div class="ap-orbit" aria-hidden="true">
      <div class="ap-orbit-ring ap-orbit-outer"></div>
      <div class="ap-orbit-ring ap-orbit-inner"></div>
      <div class="ap-orbit-center">
        <img src="/alphaping.svg" alt="" width="164" height="164" />
      </div>
      <span class="ap-orbit-node ap-node-one"><Server size={23} /></span>
      <span class="ap-orbit-node ap-node-two"><Cloud size={25} /></span>
      <span class="ap-orbit-node ap-node-three"><Radio size={21} /></span>
      <span class="ap-orbit-dot ap-dot-one"></span><span class="ap-orbit-dot ap-dot-two"></span>
    </div>
  </section>

  <section class="ap-preview-section" aria-labelledby="preview-title">
    <div class="ap-section-heading">
      <div>
        <p class="ap-eyebrow">{context.t("ap.preview.label")}</p>
        <h2 id="preview-title">{context.t("ap.preview.title")}</h2>
        <p>{context.t("ap.preview.description")}</p>
      </div>
      <a class="ap-text-link" href={href("/docs/guides/status-pages")}
        >{context.t("ap.preview.link")}<ArrowUpRight size={16} /></a
      >
    </div>
    <figure class="ap-product-preview">
      <div class="ap-browser-bar">
        <span class="ap-window-dots" aria-hidden="true"><i></i><i></i><i></i></span><span
          >{context.t("ap.preview.caption")}</span
        ><span class="ap-preview-badge">{context.t("ap.preview.note")}</span>
      </div>
      <img
        class="ap-preview-light"
        src="/images/dashboard-light.webp"
        srcset="/images/dashboard-light.webp 1440w, /images/dashboard-light@2x.webp 2880w"
        sizes="(max-width: 560px) calc(100vw - 38px), (max-width: 800px) calc(100vw - 42px), (max-width: 1224px) calc(100vw - 66px), 1158px"
        alt={context.t("ap.preview.alt")}
        width="1440"
        height="1120"
        fetchpriority="high"
      />
      <img
        class="ap-preview-dark"
        src="/images/dashboard-dark.webp"
        srcset="/images/dashboard-dark.webp 1440w, /images/dashboard-dark@2x.webp 2880w"
        sizes="(max-width: 560px) calc(100vw - 38px), (max-width: 800px) calc(100vw - 42px), (max-width: 1224px) calc(100vw - 66px), 1158px"
        alt={context.t("ap.preview.alt")}
        width="1440"
        height="1120"
      />
    </figure>
  </section>

  <section class="ap-guides-section" aria-labelledby="guides-title">
    <div class="ap-section-heading">
      <div>
        <p class="ap-eyebrow">{context.t("ap.guides.kicker")}</p>
        <h2 id="guides-title">{context.t("ap.guides.title")}</h2>
        <p>{context.t("ap.guides.description")}</p>
      </div>
      <span class="ap-development-badge">{context.t("ap.version")}</span>
    </div>
    <div class="ap-guide-grid">
      {#each guides as guide (guide.key)}
        <a class="ap-guide-card" href={href(guide.href)}>
          <div class="ap-guide-top">
            <guide.icon size={25} strokeWidth={1.75} /><span>{guide.number}</span>
          </div>
          <h3>{context.t(`ap.guide.${guide.key}.title`)}</h3>
          <p>{context.t(`ap.guide.${guide.key}.description`)}</p>
          <ArrowRight class="ap-guide-arrow" size={19} />
        </a>
      {/each}
    </div>
  </section>

  <section class="ap-details-section" aria-labelledby="details-title">
    <div>
      <p class="ap-eyebrow">{context.t("ap.details.kicker")}</p>
      <h2 id="details-title">{context.t("ap.details.title")}</h2>
    </div>
    <div class="ap-detail-list">
      {#each details as detail (detail.key)}
        <a href={href(detail.href)}
          ><detail.icon size={23} strokeWidth={1.75} />
          <div>
            <h3>{context.t(`ap.details.${detail.key}.title`)}</h3>
            <p>{context.t(`ap.details.${detail.key}.text`)}</p>
          </div>
          <ArrowUpRight size={17} /></a
        >
      {/each}
    </div>
  </section>

  <section class="ap-cta" aria-labelledby="cta-title">
    <div>
      <h2 id="cta-title">{context.t("ap.cta.title")}</h2>
      <p>{context.t("ap.cta.text")}</p>
    </div>
    <a class="ap-button ap-button-primary" href={href("/docs")}
      >{context.t("nav.docs")}<ArrowRight size={18} /></a
    >
  </section>
</div>
