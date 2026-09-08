<script lang="ts">
  import { Trash2, TriangleAlert } from "@lucide/svelte";

  import Button from "$components/ui/button/button.svelte";

  let { name, slug }: { name: string; slug: string } = $props();
  let confirmation = $state("");
</script>

<section>
  <header>
    <div>
      <span>Workspace lifecycle</span>
      <h2>Delete workspace</h2>
    </div>
    <TriangleAlert size={17} />
  </header>
  <div class="content">
    <div>
      <strong>{name}</strong>
      <p>Monitoring stops immediately. Administrators can restore it during the recovery window.</p>
    </div>
    <form method="POST" action="?/deleteWorkspace">
      <label
        ><span>Type {slug} to confirm</span><input
          name="confirmation"
          bind:value={confirmation}
          autocomplete="off"
          spellcheck="false"
          required
        /></label
      >
      <Button type="submit" variant="secondary" disabled={confirmation !== slug}
        ><Trash2 size={13} />Delete workspace</Button
      >
    </form>
  </div>
</section>

<style>
  section {
    padding-top: var(--space-5);
    border-top: 1px solid color-mix(in srgb, var(--status-down) 35%, var(--border));
  }

  header,
  .content,
  form {
    display: flex;
  }

  header {
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  header span {
    color: var(--status-down);
    font-size: var(--text-xs);
    font-weight: 620;
    text-transform: uppercase;
  }

  header :global(svg) {
    color: var(--status-down);
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    margin-top: var(--space-1);
    font-size: 14px;
    font-weight: 600;
  }

  .content {
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-5);
  }

  .content > div {
    max-width: 52ch;
  }

  .content strong {
    font-size: var(--text-base);
    font-weight: 620;
  }

  .content p {
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  form {
    flex: none;
    align-items: flex-end;
    gap: var(--space-2);
  }

  label > span {
    display: block;
    margin-bottom: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  input {
    width: 200px;
    height: 32px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  input:focus {
    border-color: var(--status-down);
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--status-down) 16%, transparent);
  }

  @media (max-width: 720px) {
    .content,
    form {
      align-items: stretch;
      flex-direction: column;
    }

    input {
      width: 100%;
    }
  }
</style>
