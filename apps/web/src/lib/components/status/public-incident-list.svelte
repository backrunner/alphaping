<script lang="ts">
  import { Activity, Check, Crosshair, Search } from "@lucide/svelte";
  import type { PublicStatusPage } from "@alphaping/db";

  let { incidents }: { incidents: PublicStatusPage["incidents"] } = $props();
</script>

{#if incidents.length > 0}
  <section aria-labelledby="incidents-title">
    <header>
      <div>
        <h2 id="incidents-title">Incident history</h2>
        <span>Active and recently resolved</span>
      </div>
    </header>
    {#each incidents as incident (incident.id)}
      <article class="incident">
        <div class="incident-title">
          <div>
            <strong>{incident.title}</strong><span>{incident.severity} · {incident.state}</span>
          </div>
          <time>{new Date(incident.startsAt).toLocaleString()}</time>
        </div>
        <p>{incident.summary}</p>
        <div class="affected">
          {#each incident.affectedServices as service}<span>{service.name} · {service.impact}</span
            >{/each}
        </div>
        <ol>
          {#each incident.updates as update (update.id)}
            <li>
              <span class={`node node--${update.state}`} aria-hidden="true">
                {#if update.state === "resolved"}<Check size={12} strokeWidth={2.2} />
                {:else if update.state === "monitoring"}<Activity size={12} />
                {:else if update.state === "identified"}<Crosshair size={12} />
                {:else}<Search size={12} />{/if}
              </span>
              <div>
                <strong>{update.state}</strong>
                <p>{update.body}</p>
                <time>{new Date(update.publishedAt).toLocaleString()}</time>
              </div>
            </li>
          {/each}
        </ol>
      </article>
    {/each}
  </section>
{/if}

<style>
  section {
    margin-top: var(--space-8);
  }

  section > header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  section > header > div {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  h2 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
  }

  header span {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .incident {
    padding: var(--space-4) 0;
    border-top: 1px solid var(--border);
  }

  .incident-title {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .incident-title strong,
  .incident-title span {
    display: block;
  }

  .incident-title strong {
    font-size: var(--text-base);
    font-weight: 600;
  }

  .incident-title span,
  .incident time {
    margin-top: var(--space-1);
    color: var(--text-faint);
    font-size: var(--text-xs);
    text-transform: capitalize;
  }

  .incident-title > time {
    flex: none;
    margin-top: 0;
    text-transform: none;
  }

  .incident > p {
    margin: var(--space-2) 0 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }

  .affected {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-2);
  }

  .affected span {
    padding: 2px var(--space-2);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    background: var(--surface-subtle);
    font-size: var(--text-xs);
  }

  ol {
    margin: var(--space-4) 0 0;
    padding: 0;
    list-style: none;
  }

  li {
    position: relative;
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    gap: var(--space-2);
    padding-bottom: var(--space-4);
  }

  li:last-child {
    padding-bottom: 0;
  }

  /* Thin vertical rail connecting the update nodes */
  li::before {
    position: absolute;
    top: 22px;
    bottom: 0;
    left: 10px;
    width: 1px;
    background: var(--border);
    content: "";
  }

  li:last-child::before {
    display: none;
  }

  .node {
    z-index: 1;
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    background: var(--surface-subtle);
  }

  .node--resolved {
    color: var(--status-healthy);
    background: var(--status-healthy-bg);
  }

  .node--monitoring {
    color: var(--accent);
    background: var(--surface-subtle);
  }

  .node--identified,
  .node--investigating {
    color: var(--status-degraded);
    background: var(--status-degraded-bg);
  }

  li strong {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: capitalize;
  }

  li p {
    margin: var(--space-1) 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: var(--leading-xs);
    white-space: pre-wrap;
  }

  li time {
    font-size: var(--text-xs);
  }

  @media (max-width: 560px) {
    .incident-title {
      flex-direction: column;
      gap: var(--space-1);
    }
  }
</style>
