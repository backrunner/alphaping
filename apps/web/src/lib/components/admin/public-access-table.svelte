<script lang="ts">
  import { ExternalLink, Save } from "lucide-svelte";

  import type { DashboardVisibility, PublicResourceSetting } from "$lib/server/workspace-settings";
  import Button from "$components/ui/button/button.svelte";

  let {
    workspace,
    visibility,
    resources,
  }: {
    workspace: string;
    visibility: DashboardVisibility;
    resources: readonly PublicResourceSetting[];
  } = $props();
</script>

<section aria-labelledby="visibility-title">
  <header>
    <div>
      <h2 id="visibility-title">Dashboard visibility</h2>
      <p>Default workspace dashboard</p>
    </div>
    {#if visibility === "public"}<a href={`/status/${workspace}`} target="_blank" rel="noreferrer"
        >Open status page <ExternalLink size={12} /></a
      >{/if}
  </header>
  <form class="visibility-form" method="POST" action="?/visibility">
    <label
      ><input
        type="radio"
        name="visibility"
        value="private"
        checked={visibility === "private"}
      /><span><strong>Private</strong><small>Workspace members only</small></span></label
    >
    <label
      ><input
        type="radio"
        name="visibility"
        value="authenticated"
        checked={visibility === "authenticated"}
      /><span><strong>Authenticated</strong><small>Signed-in users with grants</small></span></label
    >
    <label
      ><input
        type="radio"
        name="visibility"
        value="public"
        checked={visibility === "public"}
      /><span><strong>Public</strong><small>Explicitly allowed resources</small></span></label
    >
    <Button type="submit" variant="secondary"><Save size={14} />Save visibility</Button>
  </form>

  <div class="resource-heading">
    <h3>Public resources</h3>
    <span>{resources.filter((resource) => resource.effect === "allow").length} visible</span>
  </div>
  <div class="table-wrap">
    <table>
      <thead
        ><tr
          ><th>Resource</th><th>Type</th><th>Guest access</th><th>Projection</th><th
            ><span class="sr-only">Action</span></th
          ></tr
        ></thead
      >
      <tbody>
        {#each resources as resource (`${resource.type}:${resource.id}`)}
          <tr>
            <td><strong>{resource.name}</strong></td>
            <td><span class="type">{resource.type}</span></td>
            <td colspan="3">
              <form method="POST" action="?/publicResource">
                <input type="hidden" name="resourceId" value={resource.id} />
                <input type="hidden" name="resourceType" value={resource.type} />
                <select name="effect" aria-label={`Guest access for ${resource.name}`}>
                  <option value="deny" selected={resource.effect === "deny"}>Hidden</option>
                  <option value="allow" selected={resource.effect === "allow"}>Visible</option>
                </select>
                <select name="projectionProfile" aria-label={`Projection for ${resource.name}`}>
                  <option value="summary" selected={resource.projectionProfile === "summary"}
                    >Summary</option
                  >
                  <option value="detailed" selected={resource.projectionProfile === "detailed"}
                    >Detailed</option
                  >
                </select>
                <button aria-label={`Save public access for ${resource.name}`}
                  ><Save size={14} /></button
                >
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  section {
    min-width: 0;
  }

  header,
  .resource-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }

  header {
    margin-bottom: 12px;
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    font-size: 15px;
  }

  h3 {
    font-size: 12px;
  }

  p,
  .resource-heading span {
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 10px;
  }

  header a {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--accent);
    font-size: 10px;
    text-decoration: none;
  }

  .visibility-form {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
    align-items: center;
    gap: 6px;
    padding: 10px 0 18px;
    border-top: 1px solid var(--border);
  }

  .visibility-form label {
    display: flex;
    min-height: 46px;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }

  .visibility-form label:has(input:checked) {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--surface));
  }

  .visibility-form strong,
  .visibility-form small {
    display: block;
  }

  .visibility-form strong {
    font-size: 11px;
  }

  .visibility-form small {
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 9px;
  }

  .resource-heading {
    padding: 6px 0 10px;
  }

  .table-wrap {
    overflow-x: auto;
    border-top: 1px solid var(--border);
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    height: 40px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }

  th {
    height: 30px;
    color: var(--text-muted);
    font-size: 10px;
  }

  td {
    font-size: 11px;
  }

  .type {
    padding: 3px 6px;
    border-radius: 999px;
    color: var(--text-muted);
    background: var(--surface-strong);
    font-size: 9px;
    text-transform: capitalize;
  }

  td form {
    display: grid;
    grid-template-columns: 110px 110px 28px;
    justify-content: end;
    gap: 6px;
  }

  td select,
  td button {
    height: 28px;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: 10px;
  }

  td select {
    padding: 0 7px;
  }

  td button {
    display: grid;
    width: 28px;
    place-items: center;
    color: var(--text-muted);
    cursor: pointer;
  }

  td select:focus,
  td button:focus-visible {
    border-color: var(--accent);
    outline: 2px solid color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }

  @media (max-width: 900px) {
    .visibility-form {
      grid-template-columns: 1fr;
    }

    .visibility-form > :global(button) {
      justify-self: start;
    }
  }
</style>
