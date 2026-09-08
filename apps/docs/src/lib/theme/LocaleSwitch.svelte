<script lang="ts">
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { Languages } from "@lucide/svelte";
  import { resolveSvedocsHref } from "svedocs/routes";
  import type { SvedocsPage } from "svedocs/core";
  import type { SvedocsThemeContext } from "svedocs/theme/types";
  import pageLoaders from "virtual:svedocs/page-loaders";

  let { context }: { context: SvedocsThemeContext } = $props();
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });
  const target = $derived(
    context.config.i18n.locales.find((locale) => locale.code !== context.localeCode),
  );
  const translation = $derived(
    target
      ? resolveSvedocsHref({
          href: context.page?.scopePath ?? "/",
          pages: context.pages,
          config: context.config,
          localeCode: target.code,
        })
      : undefined,
  );
  const available = $derived(translation?.page?.locale === target?.code && !translation?.fallback);
  let translatedPage = $state<SvedocsPage>();

  // Only load the other article's headings when switching from a section link.
  $effect(() => {
    const targetPage = translation?.page;
    let cancelled = false;
    translatedPage = undefined;
    if (page.url.hash && available && targetPage) {
      pageLoaders[targetPage.id]?.()
        .then((module) => {
          if (!cancelled) translatedPage = module.default;
        })
        .catch(() => {
          // The article link remains usable if section metadata cannot be loaded.
        });
    }
    return () => {
      cancelled = true;
    };
  });

  const hash = $derived.by(() => {
    if (!mounted || !page.url.hash || !context.page) return "";
    // Custom landing sections use the same IDs in both languages.
    if (context.page.scopePath === "/") return page.url.hash;
    if (translatedPage?.id !== translation?.page?.id) return "";
    let id: string;
    try {
      id = decodeURIComponent(page.url.hash.slice(1));
    } catch {
      return "";
    }
    const headings = translatedPage?.headings ?? [];
    const shared = headings.find((heading) => heading.id === id);
    if (shared) return `#${encodeURIComponent(shared.id)}`;
    const current = context.page.headings;
    // Paired translations keep the same section structure and order.
    if (
      headings.length !== current.length ||
      current.some((heading, index) => heading.depth !== headings[index]?.depth)
    )
      return "";
    const heading = headings[current.findIndex((item) => item.id === id)];
    return heading ? `#${encodeURIComponent(heading.id)}` : "";
  });
  const href = $derived(`${translation?.href ?? "/"}${mounted ? page.url.search : ""}${hash}`);
  const label = $derived(
    context.t(
      !available ? "ap.locale.unavailable" : context.page ? "ap.locale.switch" : "ap.locale.home",
      { language: target?.label ?? "" },
    ),
  );
</script>

{#if target}
  <a
    class="ap-locale-switch"
    href={available ? href : undefined}
    hreflang={target.hreflang ?? target.code}
    aria-label={label}
    aria-disabled={!available || undefined}
    title={label}
  >
    <Languages size={17} aria-hidden="true" />
    <span lang={target.hreflang ?? target.code}>{target.code === "en" ? "EN" : "中"}</span>
  </a>
{/if}
