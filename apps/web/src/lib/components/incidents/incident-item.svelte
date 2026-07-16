<script lang="ts">
  import { Send } from "lucide-svelte";

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
        <span></span>
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
    padding: 15px 0;
    border-top: 1px solid var(--border);
  }
  .heading {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .heading strong,
  .heading span {
    display: block;
  }
  .heading strong {
    font-size: 12px;
  }
  .heading span,
  time {
    margin-top: 2px;
    color: var(--text-faint);
    font-size: 9px;
    text-transform: capitalize;
  }
  article > p {
    margin: 6px 0 0;
    color: var(--text-muted);
    font-size: 11px;
  }
  .affected {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 8px;
  }
  .affected span {
    padding: 3px 6px;
    border-radius: 999px;
    color: var(--text-muted);
    background: var(--surface-strong);
    font-size: 9px;
  }
  form {
    display: grid;
    grid-template-columns: 130px 1fr 28px;
    gap: 6px;
    margin-top: 12px;
  }
  form input,
  form select {
    width: 100%;
    height: 28px;
    min-height: 28px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: 10px;
  }
  form input:focus,
  form select:focus {
    border-color: var(--accent);
    outline: 2px solid color-mix(in srgb, var(--accent) 22%, transparent);
  }
  form :global(.icon-submit) {
    width: 28px;
    height: 28px;
    padding: 0;
  }
  ol {
    margin: 14px 0 0;
    padding: 0;
    list-style: none;
  }
  li {
    position: relative;
    display: grid;
    grid-template-columns: 10px 1fr;
    gap: 9px;
    min-height: 55px;
  }
  li > span {
    z-index: 1;
    width: 8px;
    height: 8px;
    margin-top: 4px;
    border-radius: 999px;
    background: var(--accent);
  }
  li::before {
    position: absolute;
    top: 8px;
    bottom: 0;
    left: 3px;
    width: 1px;
    background: var(--border);
    content: "";
  }
  li:last-child::before {
    display: none;
  }
  li strong {
    font-size: 10px;
    text-transform: capitalize;
  }
  li p {
    margin: 2px 0;
    color: var(--text-muted);
    font-size: 10px;
    white-space: pre-wrap;
  }
  @media (max-width: 720px) {
    .heading {
      flex-direction: column;
      gap: 2px;
    }
    form {
      grid-template-columns: 1fr 28px;
    }
    form select {
      grid-column: 1 / -1;
    }
  }
</style>
