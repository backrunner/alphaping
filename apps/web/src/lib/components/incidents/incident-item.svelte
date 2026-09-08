<script lang="ts">
  import { Send } from "@lucide/svelte";

  import Button from "$components/ui/button/button.svelte";

  type Incident = {
    id: string;
    title: string;
    summary: string;
    severity: "minor" | "major" | "critical";
    state: "investigating" | "identified" | "monitoring" | "resolved";
    startsAt: number;
    affectedServices: readonly { id: string; name: string; impact: "degraded" | "down" }[];
    updates: readonly { id: string; state: string; body: string; publishedAt: number }[];
    canManage: boolean;
  };

  let { incident }: { incident: Incident } = $props();
</script>

<article>
  <div class="heading">
    <div><strong>{incident.title}</strong><span>{incident.severity} · {incident.state}</span></div>
    <time>{new Date(incident.startsAt).toLocaleString()}</time>
  </div>
  <p>{incident.summary}</p>
  <div class="affected">
    {#each incident.affectedServices as service}<span>{service.name} · {service.impact}</span
      >{/each}
  </div>
  {#if incident.canManage}
    <form method="POST" action="?/update">
      <input type="hidden" name="incidentId" value={incident.id} />
      <select name="state" value={incident.state} aria-label="Incident state"
        ><option value="investigating">Investigating</option><option value="identified"
          >Identified</option
        ><option value="monitoring">Monitoring</option><option value="resolved">Resolved</option
        ></select
      >
      <input
        name="body"
        required
        maxlength="4000"
        aria-label="Progress update"
        placeholder="Add progress update"
      />
      <Button type="submit" class="icon-submit" aria-label="Publish progress update"
        ><Send size={13} /></Button
      >
    </form>
  {/if}
  <ol>
    {#each incident.updates as update (update.id)}
      <li>
        <span class={`marker marker--${update.state}`}></span>
        <div>
          <strong>{update.state}</strong>
          <p>{update.body}</p>
          <time>{new Date(update.publishedAt).toLocaleString()}</time>
        </div>
      </li>
    {/each}
  </ol>
</article>

<style>
  article {
    padding: var(--space-4) 0;
    border-top: 1px solid var(--border);
  }
  .heading {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .heading strong,
  .heading span {
    display: block;
  }
  .heading strong {
    font-size: var(--text-base);
    font-weight: 620;
  }
  .heading span,
  time {
    margin-top: var(--space-1);
    color: var(--text-faint);
    font-size: var(--text-xs);
    text-transform: capitalize;
  }
  article > p {
    margin: var(--space-2) 0 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .affected {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-2);
  }
  .affected span {
    padding: 3px var(--space-2);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    background: var(--surface-strong);
    font-size: var(--text-xs);
    text-transform: capitalize;
  }
  form {
    display: grid;
    grid-template-columns: 140px 1fr 32px;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  form input,
  form select {
    width: 100%;
    height: 32px;
    min-height: 32px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: var(--text-sm);
  }
  form input:focus,
  form select:focus {
    border-color: var(--accent);
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
  }
  form :global(.icon-submit) {
    width: 32px;
    height: 32px;
    padding: 0;
  }
  ol {
    margin: var(--space-4) 0 0;
    padding: 0;
    list-style: none;
  }
  li {
    position: relative;
    display: grid;
    grid-template-columns: 10px 1fr;
    gap: var(--space-2);
    min-height: 55px;
  }
  .marker {
    z-index: 1;
    width: 9px;
    height: 9px;
    margin-top: 4px;
    border: 2px solid var(--surface);
    border-radius: var(--radius-pill);
    background: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .marker--investigating {
    background: var(--status-down);
    box-shadow: 0 0 0 1px var(--status-down);
  }
  .marker--identified {
    background: var(--status-degraded);
    box-shadow: 0 0 0 1px var(--status-degraded);
  }
  .marker--resolved {
    background: var(--status-healthy);
    box-shadow: 0 0 0 1px var(--status-healthy);
  }
  li::before {
    position: absolute;
    top: 8px;
    bottom: 0;
    left: 4px;
    width: 1px;
    background: var(--border);
    content: "";
  }
  li:last-child::before {
    display: none;
  }
  li strong {
    font-size: var(--text-xs);
    font-weight: 620;
    text-transform: capitalize;
  }
  li p {
    margin: var(--space-1) 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    white-space: pre-wrap;
  }
  li time {
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 720px) {
    .heading {
      flex-direction: column;
      gap: var(--space-1);
    }
    form {
      grid-template-columns: 1fr 32px;
    }
    form select {
      grid-column: 1 / -1;
    }
  }
</style>
