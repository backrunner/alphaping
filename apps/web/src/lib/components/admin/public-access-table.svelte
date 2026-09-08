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

  .empty {
    display: grid;
    min-height: 120px;
    place-items: center;
    align-content: center;
    gap: 4px;
    color: var(--text-faint);
    text-align: center;
  }

  .empty strong {
    color: var(--text-muted);
    font-size: 11px;
  }

  .empty span {
    font-size: 10px;
  }

  .pagination,
  .pagination a,
  .pagination span {
    display: flex;
    align-items: center;
  }

  .pagination {
    min-height: 36px;
    justify-content: space-between;
    gap: 12px;
    color: var(--text-muted);
    font-size: 10px;
  }

  .pagination a,
  .pagination span {
    min-width: 68px;
    gap: 4px;
  }

  .pagination a:last-child,
  .pagination span:last-child {
    justify-content: flex-end;
  }

  .pagination a {
    color: var(--text-muted);
    text-decoration: none;
  }

  .pagination a:hover {
    color: var(--text);
  }

  .pagination span {
    color: var(--text-faint);
  }

  .pagination strong {
    font-weight: 500;
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
    outline: 2px solid var(--focus-ring);
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
      gap: 2px 8px;
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
    }

    td {
      height: auto;
      padding: 2px 8px;
      border: 0;
    }

    td:last-child {
      grid-column: 1 / -1;
    }

    td form {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 28px;
      justify-content: stretch;
    }

    td select {
      min-width: 0;
      width: 100%;
    }
  }
</style>
