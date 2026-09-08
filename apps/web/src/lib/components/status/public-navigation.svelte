<script lang="ts">
  import { page } from "$app/state";
  import SiteLogo from "$components/layout/site-logo.svelte";
  import AppearancePicker from "$components/layout/appearance-picker.svelte";
  let {
    workspace,
    title = "",
    logoUrl = "",
  }: {
    workspace: { name: string; slug: string };
    title?: string | undefined;
    logoUrl?: string | undefined;
  } = $props();
</script>

<nav class="public-nav" aria-label="Status navigation">
  <a class="brand" href={`/status/${workspace.slug}`}>
    <SiteLogo {logoUrl} />
    <span>{title || workspace.name}</span>
  </a>
  <div class="nav-actions">
    <a
      class="overview-link"
      class:active={page.url.pathname === `/status/${workspace.slug}`}
      href={`/status/${workspace.slug}`}>Overview</a
    >
    <AppearancePicker />
  </div>
</nav>

<style>
  .public-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 24px 0;
  }
  .brand {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 12px;
    color: var(--text);
    text-decoration: none;
    font-size: 16px;
    font-weight: 620;
  }
  .brand > span:last-child {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .nav-actions {
    display: flex;
    align-items: center;
    gap: 24px;
    flex: none;
  }
  .overview-link {
    color: var(--text-muted);
    font-size: 13px;
    text-decoration: none;
  }
  .overview-link.active,
  .overview-link:hover {
    color: var(--accent);
  }
  @media (max-width: 560px) {
    .public-nav {
      padding: 20px 0;
      gap: 12px;
    }
    .brand {
      font-size: 15px;
      gap: 10px;
    }
    .overview-link {
      display: none;
    }
  }
</style>
