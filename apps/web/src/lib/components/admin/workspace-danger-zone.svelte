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
    padding-top: 20px;
    border-top: 1px solid var(--border-strong);
  }

  header,
  .content,
  form {
    display: flex;
  }

  header {
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  header span {
    color: var(--status-down);
    font-size: 9px;
    font-weight: 650;
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
    margin-top: 3px;
    font-size: 14px;
  }

  .content {
    align-items: flex-end;
    justify-content: space-between;
    gap: 18px;
  }

  .content > div {
    max-width: 52ch;
  }

  .content strong {
    font-size: 11px;
  }

  .content p {
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 10px;
  }

  form {
    flex: none;
    align-items: flex-end;
    gap: 8px;
  }

  label > span {
    display: block;
    margin-bottom: 4px;
    color: var(--text-muted);
    font-size: 9px;
  }

  input {
    width: 190px;
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-family: var(--font-mono);
    font-size: 10px;
  }

  input:focus {
    border-color: var(--status-down);
    outline: 2px solid var(--focus-ring);
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
