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
    --announcement-accent: var(--accent);

    padding: 11px 12px;
    border: 1px solid var(--border);
    background: var(--surface);
  }

  .announcement--maintenance {
    --announcement-accent: var(--status-maintenance);
  }

  .announcement--minor,
  .announcement--major {
    --announcement-accent: var(--status-degraded);
  }

  .announcement--critical {
    --announcement-accent: var(--status-down);
  }

  .announcement > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .announcement strong {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
  }

  .announcement strong::before {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 2px;
    background: var(--announcement-accent);
    content: "";
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
