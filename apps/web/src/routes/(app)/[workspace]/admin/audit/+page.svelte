<script lang="ts">
  import { ChevronLeft, ChevronRight, FileClock } from "@lucide/svelte";

  let { data } = $props();

  function digest(value: string | null): string {
    return value === null ? "none" : value.slice(0, 12);
  }

  function timestamp(value: number): string {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(value);
  }
</script>

<svelte:head><title>Audit log · AlphaPing</title></svelte:head>

<main>
  <header class="heading">
    <div>
      <h2>Audit log</h2>
      <p>Immutable workspace configuration and access changes.</p>
    </div>
    <span><FileClock size={13} />{data.audit.total}{data.audit.totalCapped ? "+" : ""} entries</span
    >
  </header>

  <div class="table" role="table" aria-label="Workspace audit log">
    <div class="table__heading" role="row">
      <span role="columnheader">Time</span><span role="columnheader">Action</span><span
        role="columnheader">Resource</span
      ><span role="columnheader">Actor</span><span role="columnheader">Digests</span>
    </div>
    {#each data.audit.entries as entry (entry.id)}
      <div class="table__row" role="row">
        <div role="cell">
          <time title={timestamp(entry.createdAt)}>{timestamp(entry.createdAt)}</time>
        </div>
        <div role="cell"><strong>{entry.action}</strong></div>
        <div class="resource" role="cell">
          <span>{entry.resourceType}</span><code>{entry.resourceId}</code>
        </div>
        <div class="actor" role="cell">
          <span>{entry.actorName}</span>{#if entry.actorEmail}<small>{entry.actorEmail}</small>{/if}
        </div>
        <div role="cell">
          <code class="digests">{digest(entry.beforeDigest)} -> {digest(entry.afterDigest)}</code>
        </div>
      </div>
    {:else}
      <p class="empty">No audited changes have been recorded.</p>
    {/each}
  </div>

  {#if data.audit.pages > 1}
    <nav aria-label="Audit log pages">
      {#if data.audit.page > 1}
        <a href={`?page=${data.audit.page - 1}`}><ChevronLeft size={13} />Newer</a>
      {:else}<span></span>{/if}
      <span>Page {data.audit.page} of {data.audit.pages}</span>
      {#if data.audit.page < data.audit.pages}
        <a href={`?page=${data.audit.page + 1}`}>Older <ChevronRight size={13} /></a>
      {/if}
    </nav>
  {/if}
</main>

<style>
  main {
    min-width: 0;
    padding-bottom: var(--space-8);
  }

  .heading,
  .heading > span,
  nav,
  nav a {
    display: flex;
    align-items: center;
  }

  .heading {
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 14px;
    font-weight: 600;
  }

  .heading p {
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .heading > span {
    gap: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .table {
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .table__heading,
  .table__row {
    display: grid;
    grid-template-columns: 150px minmax(150px, 1fr) minmax(170px, 1.2fr) minmax(140px, 1fr) 180px;
    gap: var(--space-3);
    align-items: center;
    padding: 0 var(--space-3);
  }

  .table__heading {
    min-height: 34px;
    color: var(--text-faint);
    background: var(--surface-subtle);
    font-size: var(--text-xs);
    font-weight: 620;
  }

  .table__row {
    min-height: 52px;
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--border);
    transition: background-color 120ms ease;
  }

  .table__row:hover {
    background: var(--surface-subtle);
  }

  .table__row time,
  .table__row strong,
  .table__row span,
  .table__row small,
  .table__row code {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .table__row time,
  .table__row code,
  .table__row small,
  .resource span {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .table__row time {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .table__row strong,
  .actor span {
    font-size: var(--text-sm);
  }

  .table__row strong {
    font-weight: 620;
  }

  .resource span,
  .resource code,
  .actor span,
  .actor small {
    display: block;
  }

  .resource code,
  .actor small {
    margin-top: var(--space-1);
  }

  .resource code,
  .digests {
    font-family: var(--font-mono);
  }

  .empty {
    padding: var(--space-5) var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  nav {
    justify-content: space-between;
    gap: var(--space-3);
    margin-top: var(--space-3);
    font-size: var(--text-xs);
  }

  nav a {
    height: 32px;
    gap: var(--space-1);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-button);
    color: var(--text);
    background: var(--surface);
    text-decoration: none;
    transition:
      border-color 120ms ease,
      background-color 120ms ease;
  }

  nav a:hover {
    border-color: var(--border-strong);
    background: var(--surface-subtle);
  }

  nav span {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 980px) {
    .table__heading,
    .table__row {
      grid-template-columns: 135px minmax(130px, 1fr) minmax(160px, 1fr) minmax(120px, 1fr);
    }

    .table__heading > :last-child,
    .table__row > :last-child {
      display: none;
    }
  }

  @media (max-width: 640px) {
    .table__heading {
      display: none;
    }

    .table__row {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-1) var(--space-2);
      padding: var(--space-2) var(--space-3);
    }

    .table__row:first-of-type {
      border-top: 0;
    }

    .table__row > :first-child {
      grid-column: 2;
      grid-row: 1;
      max-width: 130px;
    }

    .table__row > :nth-child(2) {
      grid-column: 1;
      grid-row: 1;
    }

    .resource {
      grid-column: 1 / -1;
    }

    .actor {
      grid-column: 1 / -1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .table__row,
    nav a {
      transition: none;
    }
  }
</style>
