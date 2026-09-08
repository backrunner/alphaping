<script lang="ts">
  import { page } from "$app/state";
  import { ArrowLeft, FileQuestion, RefreshCw, TriangleAlert } from "@lucide/svelte";

  import Button from "$components/ui/button/button.svelte";

  const unavailable = $derived(page.status === 404 || page.status === 403);
  const title = $derived(unavailable ? "Page unavailable" : "This page couldn't load");
</script>

<svelte:head><title>{page.status} · AlphaPing</title></svelte:head>

<main>
  <a class="brand" href="/"><span aria-hidden="true">A</span>AlphaPing</a>
  <section aria-labelledby="error-title">
    <div class="error-code">
      {#if unavailable}<FileQuestion size={18} />{:else}<TriangleAlert size={18} />{/if}
      <span>Error {page.status}</span>
    </div>
    <h1 id="error-title">{title}</h1>
    <p>
      {unavailable
        ? "Check the address or return to the start page to continue."
        : "Try again in a moment. If the problem continues, contact the workspace administrator."}
    </p>
    <div class="actions">
      {#if !unavailable}
        <Button onclick={() => window.location.reload()}><RefreshCw size={14} />Try again</Button>
      {/if}
      <a href="/"><ArrowLeft size={14} />Return to start</a>
    </div>
  </section>
</main>

<style>
  main {
    width: min(100% - 32px, 440px);
    margin: 0 auto;
    padding: var(--space-8) 0;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text);
    font-weight: 650;
    text-decoration: none;
  }

  .brand > span {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border-radius: var(--radius-button);
    color: var(--accent-ink);
    background: var(--accent);
    font-size: var(--text-xs);
  }

  section {
    margin-top: var(--space-8);
    padding-top: var(--space-6);
    border-top: 1px solid var(--border);
  }

  .error-code {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  h1 {
    margin: var(--space-3) 0 var(--space-2);
    font-size: 22px;
    font-weight: 650;
  }

  p {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.6;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-5);
  }

  .actions a {
    display: inline-flex;
    min-height: 32px;
    align-items: center;
    gap: var(--space-1);
    color: var(--accent);
    font-size: var(--text-sm);
    text-decoration: none;
  }

  .actions a:hover {
    text-decoration: underline;
  }
</style>
