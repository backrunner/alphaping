<script lang="ts">
  import { Menu, X, Search, CodeXml, ArrowUpRight } from "@lucide/svelte";
  import { SearchDialog } from "svedocs/theme";
  import { resolveLocalizedHref, resolveLocalizedText } from "svedocs/theme/headless";
  import type { SvedocsNavbarProps } from "svedocs/theme/types";
  import Sidebar from "./Sidebar.svelte";
  import ThemeToggle from "./ThemeToggle.svelte";
  import LocaleSwitch from "./LocaleSwitch.svelte";

  let {
    context,
    mobileTree = [],
    mobileCurrentPath = "",
    mobileMenuId = "ap-mobile-menu",
    mobileMenuOpen = false,
    onToggleMobileMenu,
    onCloseMobileMenu,
  }: SvedocsNavbarProps = $props();
  const href = (path: string) => resolveLocalizedHref(path, context);
</script>

<header class="ap-header">
  <div class="ap-navbar">
    <a href={href("/")} class="ap-brand" aria-label={context.t("ap.brand.home")}>
      <img src="/alphaping.svg" alt="" width="38" height="38" />
      <span>AlphaPing</span><span class="ap-brand-label">{context.t("ap.brand.docs")}</span>
    </a>
    <nav class="ap-topnav" aria-label={context.t("nav.primary")}>
      {#each context.config.theme.nav as item (item.href)}
        <a
          href={href(item.href)}
          aria-current={context.activeNavHref === href(item.href) ? "page" : undefined}
          >{resolveLocalizedText(item.label, item.labelKey, context)}</a
        >
      {/each}
    </nav>
    <div class="ap-nav-tools">
      <div class="ap-search">
        <SearchDialog
          records={context.search}
          loadRecords={context.loadSearch}
          scope={context.config.search.scope === "current"
            ? { ...context.searchScope, locale: context.localeCode }
            : context.searchScope}
          provider={context.config.search.provider}
          buildMode={context.config.build.mode}
          {context}
        />
      </div>
      <button
        class="ap-icon-button ap-mobile-search"
        type="button"
        aria-label={context.t("search.dialog")}
        aria-haspopup="dialog"
        onclick={() => window.dispatchEvent(new Event("svedocs:open-search"))}
        ><Search size={19} /></button
      >
      <LocaleSwitch {context} />
      <ThemeToggle {context} />
      <a
        class="ap-icon-button ap-github"
        href="https://github.com/BackRunner/alphaping"
        aria-label="GitHub"
        title="GitHub"><CodeXml size={19} /></a
      >
      <button
        class="ap-icon-button ap-menu-button"
        type="button"
        aria-controls={mobileMenuId}
        aria-expanded={mobileMenuOpen}
        aria-label={context.t(mobileMenuOpen ? "nav.mobile.close" : "nav.mobile.open")}
        onclick={onToggleMobileMenu}
      >
        {#if mobileMenuOpen}<X size={21} />{:else}<Menu size={21} />{/if}
      </button>
    </div>
  </div>
  <div id={mobileMenuId} class="ap-mobile-menu" class:ap-open={mobileMenuOpen}>
    <nav aria-label={context.t("nav.primary")}>
      {#each context.config.theme.nav as item (item.href)}
        <a href={href(item.href)} onclick={onCloseMobileMenu}
          >{resolveLocalizedText(item.label, item.labelKey, context)}<ArrowUpRight size={16} /></a
        >
      {/each}
    </nav>
    {#if context.isDocsPage}
      <nav class="ap-mobile-docs" aria-label={context.t("nav.documentation")}>
        <Sidebar
          items={mobileTree.length ? mobileTree : context.tree}
          currentPath={mobileCurrentPath || context.page?.routePath || ""}
        />
      </nav>
    {/if}
  </div>
</header>
