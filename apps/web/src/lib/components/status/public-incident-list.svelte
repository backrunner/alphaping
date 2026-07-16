<script lang="ts">
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
    {/each}
  </section>
{/if}

<style>
  section {
    margin-top: 28px;
  }

  section > header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  section > header > div {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  h2 {
    margin: 0;
    font-size: 14px;
  }

  header span {
    color: var(--text-faint);
    font-size: 10px;
  }

  .incident {
    padding: 14px 0;
    border-top: 1px solid var(--border);
  }

  .incident-title {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .incident-title strong,
  .incident-title span {
    display: block;
  }

  .incident-title strong {
    font-size: 12px;
  }

  .incident-title span,
  .incident time {
    margin-top: 2px;
    color: var(--text-faint);
    font-size: 9px;
    text-transform: capitalize;
  }

  .incident > p {
    margin-top: 7px;
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

  ol {
    margin: 14px 0 0;
    padding: 0;
    list-style: none;
  }

  li {
    position: relative;
    display: grid;
    min-height: 55px;
    grid-template-columns: 10px 1fr;
    gap: 9px;
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

  @media (max-width: 560px) {
    .incident-title {
      flex-direction: column;
      gap: 2px;
    }
  }
</style>
