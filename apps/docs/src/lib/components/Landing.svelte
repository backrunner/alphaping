<script lang="ts">
  import { ArrowRight } from "@lucide/svelte";
  import { resolveLocalizedHref } from "svedocs/theme/headless";
  import type { SvedocsThemeContext } from "svedocs/theme/types";
  let { context }: { context: SvedocsThemeContext } = $props();
  const href = (path: string) => resolveLocalizedHref(path, context);
  const guides = [
    { key: "deploy", href: "/docs/start/deployment" },
    { key: "agent", href: "/docs/start/agent" },
    { key: "services", href: "/docs/guides/services" },
  ];
  const details = [
    { key: "machine", href: "/docs/guides/machines" },
    { key: "history", href: "/docs/reference/architecture" },
    { key: "access", href: "/docs/guides/permissions" },
  ];
</script>

<div class="ap-landing">
  <section class="ap-hero" aria-labelledby="hero-title">
    <div class="ap-hero-copy">
      <h1 id="hero-title">{context.t("ap.hero.title")}</h1>
      <p class="ap-hero-description">{context.t("ap.hero.description")}</p>
      <div class="ap-actions">
        <a class="ap-button ap-button-primary" href={href("/docs/start/deployment")}
          >{context.t("ap.start")}<ArrowRight size={18} aria-hidden="true" /></a
        >
        <a class="ap-button ap-button-secondary" href="https://github.com/BackRunner/alphaping"
          >{context.t("ap.source")}</a
        >
      </div>
      <p class="ap-hero-note">{context.t("ap.hero.license")}</p>
    </div>
    <img class="ap-hero-mark" src="/alphaping.svg" alt="" width="196" height="196" />
  </section>

  <section class="ap-preview-section" aria-labelledby="preview-title">
    <div class="ap-section-heading">
      <div>
        <h2 id="preview-title">{context.t("ap.preview.title")}</h2>
        <p>{context.t("ap.preview.description")}</p>
      </div>
      <a class="ap-text-link" href={href("/docs/guides/status-pages")}
        >{context.t("ap.preview.link")}<ArrowRight size={16} aria-hidden="true" /></a
      >
    </div>
    <figure class="ap-product-preview">
      <div class="ap-preview-frame">
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
      </div>
      <figcaption>{context.t("ap.preview.note")}</figcaption>
    </figure>
  </section>

  <section class="ap-guides-section" aria-labelledby="guides-title">
    <div class="ap-section-heading">
      <div>
        <h2 id="guides-title">{context.t("ap.guides.title")}</h2>
        <p>{context.t("ap.guides.description")}</p>
      </div>
    </div>
    <div class="ap-guide-grid">
      {#each guides as guide (guide.key)}
        <a class="ap-guide-card" href={href(guide.href)}>
          <h3>
            {context.t(`ap.guide.${guide.key}.title`)}<ArrowRight size={18} aria-hidden="true" />
          </h3>
          <p>{context.t(`ap.guide.${guide.key}.description`)}</p>
        </a>
      {/each}
    </div>
    <p class="ap-development-note">{context.t("ap.version")}</p>
  </section>

  <section class="ap-details-section" aria-labelledby="details-title">
    <div>
      <h2 id="details-title">{context.t("ap.details.title")}</h2>
    </div>
    <div class="ap-detail-list">
      {#each details as detail (detail.key)}
        <a href={href(detail.href)}>
          <div>
            <h3>{context.t(`ap.details.${detail.key}.title`)}</h3>
            <p>{context.t(`ap.details.${detail.key}.text`)}</p>
          </div>
          <ArrowRight size={17} aria-hidden="true" /></a
        >
      {/each}
    </div>
  </section>
</div>
