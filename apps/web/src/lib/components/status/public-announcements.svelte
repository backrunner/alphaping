<script lang="ts">
  import type { PublicStatusPage } from "@alphaping/db";

  let { announcements }: { announcements: PublicStatusPage["announcements"] } = $props();
</script>

{#if announcements.length > 0}
  <section class="announcements" aria-label="Announcements">
    {#each announcements as announcement (announcement.id)}
      <article class={`announcement announcement--${announcement.severity}`}>
        <div><strong>{announcement.title}</strong><span>{announcement.severity}</span></div>
        <p>{announcement.body}</p>
        <small>Visible until {new Date(announcement.expiresAt).toLocaleString()}</small>
      </article>
    {/each}
  </section>
{/if}

<style>
  .announcements {
    display: grid;
    gap: 8px;
    margin-bottom: 24px;
  }

  .announcement {
    padding: 11px 12px;
    border-left: 3px solid var(--accent);
    background: var(--surface);
  }

  .announcement--maintenance {
    border-color: var(--status-maintenance);
  }

  .announcement--minor,
  .announcement--major {
    border-color: var(--status-degraded);
  }

  .announcement--critical {
    border-color: var(--status-down);
  }

  .announcement > div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .announcement strong {
    font-size: 12px;
  }

  .announcement span,
  .announcement small {
    color: var(--text-faint);
    font-size: 9px;
    text-transform: capitalize;
  }

  .announcement p {
    margin: 5px 0;
    color: var(--text-muted);
    font-size: 11px;
    white-space: pre-wrap;
  }
</style>
