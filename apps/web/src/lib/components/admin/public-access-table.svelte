<script lang="ts">
  import { page } from "$app/state";
  import { ChevronLeft, ChevronRight, ExternalLink, Save, ShieldCheck } from "@lucide/svelte";
  import { SvelteURLSearchParams } from "svelte/reactivity";

  import type { DashboardVisibility, PublicResourceSetting } from "$lib/server/workspace-settings";
  import Button from "$components/ui/button/button.svelte";

  let {
    workspace,
    visibility,
    resources,
    resourcePagination,
  }: {
    workspace: string;
    visibility: DashboardVisibility;
    resources: readonly PublicResourceSetting[];
    resourcePagination: {
      previousCursor: string | null;
      nextCursor: string | null;
    };
  } = $props();

  function resourcePageParams(): SvelteURLSearchParams {
    const params = new SvelteURLSearchParams(page.url.searchParams);
    for (const key of [...params.keys()]) {
      if (key !== "resourceCursor" && key !== "resourceDirection") params.delete(key);
    }
    return params;
  }

  function actionHref(action: string): string {
    const params = resourcePageParams();
    const query = params.toString();
    return `?/${action}${query ? `&${query}` : ""}`;
  }

  function paginationHref(cursor: string, direction: "after" | "before"): string {
    const params = resourcePageParams();
    params.set("resourceCursor", cursor);
    params.set("resourceDirection", direction);
    const query = params.toString();
    return `${page.url.pathname}?${query}`;
  }
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
  <form class="visibility-form" method="POST" action={actionHref("visibility")}>
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
    <span
      >{resources.filter((resource) => resource.effect === "allow").length} visible on this page</span
    >
  </div>
  {#if resources.length === 0}
    <div class="empty" role="status">
      <ShieldCheck size={18} /><strong>No resources on this page</strong><span
        >The resource list changed or this page is empty.</span
      >
    </div>
  {:else}
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
                <form method="POST" action={actionHref("publicResource")}>
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
                  <button aria-label={`Save public access for ${resource.name}`} type="submit"
                    ><Save size={14} /></button
                  >
                </form>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  {#if resourcePagination.previousCursor || resourcePagination.nextCursor}
    <nav class="pagination" aria-label="Public resource pages">
      {#if resourcePagination.previousCursor}
        <a href={paginationHref(resourcePagination.previousCursor, "before")}
          ><ChevronLeft size={13} />Previous</a
        >
      {:else}<span><ChevronLeft size={13} />Previous</span>{/if}
      <strong>Showing {resources.length} resources</strong>
      {#if resourcePagination.nextCursor}
        <a href={paginationHref(resourcePagination.nextCursor, "after")}
          >Next<ChevronRight size={13} /></a
        >
      {:else}<span>Next<ChevronRight size={13} /></span>{/if}
    </nav>
  {/if}
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
    gap: var(--space-3);
  }

  header {
    margin-bottom: var(--space-3);
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    font-size: 14px;
    font-weight: 600;
  }

  h3 {
    font-size: var(--text-base);
    font-weight: 600;
  }

  p {
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .resource-heading span {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  header a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--accent);
    font-size: var(--text-xs);
    text-decoration: none;
  }

  header a:hover {
    color: var(--accent-hover);
  }

  .visibility-form {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) 0 var(--space-5);
    border-top: 1px solid var(--border);
  }

  .visibility-form label {
    display: flex;
    min-height: 46px;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
    cursor: pointer;
    transition:
      border-color 120ms ease,
      background-color 120ms ease;
  }

  .visibility-form label:hover {
    border-color: var(--border-strong);
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
    font-size: var(--text-sm);
    font-weight: 620;
  }

  .visibility-form small {
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .resource-heading {
    padding: var(--space-1) 0 var(--space-2);
  }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .empty {
    display: grid;
    min-height: 120px;
    place-items: center;
    align-content: center;
    gap: var(--space-1);
    color: var(--text-faint);
    text-align: center;
  }

  .empty strong {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .empty span {
    font-size: var(--text-xs);
  }

  .pagination {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    margin-top: var(--space-3);
    font-size: var(--text-xs);
  }

  .pagination a,
  .pagination span {
    display: inline-flex;
    height: 32px;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-button);
  }

  .pagination a {
    color: var(--text);
    background: var(--surface);
    text-decoration: none;
    transition:
      border-color 120ms ease,
      background-color 120ms ease;
  }

  .pagination a:hover {
    border-color: var(--border-strong);
    background: var(--surface-subtle);
  }

  .pagination span {
    color: var(--text-faint);
  }

  .pagination a:last-child,
  .pagination span:last-child {
    justify-self: end;
  }

  .pagination strong {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    height: 44px;
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--border);
    text-align: left;
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  tbody tr {
    transition: background-color 120ms ease;
  }

  tbody tr:hover {
    background: var(--surface-subtle);
  }

  th {
    height: 34px;
    color: var(--text-faint);
    background: var(--surface-subtle);
    font-size: var(--text-xs);
    font-weight: 620;
  }

  td {
    font-size: var(--text-sm);
  }

  td strong {
    font-weight: 620;
  }

  .type {
    padding: 3px var(--space-2);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    background: var(--surface-strong);
    font-size: var(--text-xs);
    text-transform: capitalize;
  }

  td form {
    display: grid;
    grid-template-columns: 110px 110px 32px;
    justify-content: end;
    gap: var(--space-2);
  }

  td select,
  td button {
    height: 32px;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: var(--text-sm);
  }

  td select {
    padding: 0 var(--space-2);
  }

  td button {
    display: grid;
    width: 32px;
    border-radius: var(--radius-button);
    place-items: center;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      border-color 120ms ease,
      background-color 120ms ease,
      color 120ms ease;
  }

  td button:hover {
    color: var(--text);
    border-color: var(--border-strong);
    background: var(--surface-subtle);
  }

  td select:focus,
  td button:focus-visible {
    border-color: var(--accent);
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
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

  @media (max-width: 480px) {
    .table-wrap {
      overflow-x: visible;
    }

    table,
    tbody {
      display: block;
      width: 100%;
    }

    thead {
      display: none;
    }

    tr {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 2px var(--space-2);
      padding: var(--space-2) var(--space-3);
      border-bottom: 1px solid var(--border);
    }

    tbody tr:last-child {
      border-bottom: 0;
    }

    td {
      height: auto;
      padding: 2px 0;
      border: 0;
    }

    td:last-child {
      grid-column: 1 / -1;
    }

    td form {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px;
      justify-content: stretch;
    }

    td select {
      min-width: 0;
      width: 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .visibility-form label,
    tbody tr,
    td button,
    .pagination a {
      transition: none;
    }
  }
</style>
