<script lang="ts">
  import { Info, OctagonAlert, TriangleAlert, Wrench } from "@lucide/svelte";
  import type { PublicStatusPage } from "@alphaping/db";

  let { announcements }: { announcements: PublicStatusPage["announcements"] } = $props();
</script>

{#if announcements.length > 0}
  <section class="announcements" aria-label="Announcements">
    {#each announcements as announcement (announcement.id)}
      <article class={`announcement announcement--${announcement.severity}`}>
        <span class="node" aria-hidden="true">
          {#if announcement.severity === "maintenance"}<Wrench size={13} />
          {:else if announcement.severity === "critical"}<OctagonAlert size={13} />
          {:else if announcement.severity === "minor" || announcement.severity === "major"}<TriangleAlert
              size={13}
            />
          {:else}<Info size={13} />{/if}
        </span>
        <div class="content">
          <header>
            <strong>{announcement.title}</strong><span class="severity"
              >{announcement.severity}</span
            >
          </header>
          <p>{announcement.body}</p>
          <small>Visible until {new Date(announcement.expiresAt).toLocaleString()}</small>
        </div>
      </article>
    {/each}
  </section>
{/if}

<style>
  .announcements {
    display: grid;
    margin-bottom: var(--space-6);
  }

  .announcement {
    --announcement-accent: var(--accent);

    position: relative;
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    gap: var(--space-2);
    padding-bottom: var(--space-4);
  }

  .announcement:last-child {
    padding-bottom: 0;
  }

  /* Thin vertical rail connecting the timeline nodes */
  .announcement::before {
    position: absolute;
    top: 22px;
    bottom: 0;
    left: 10px;
    width: 1px;
    background: var(--border);
    content: "";
  }

  .announcement:last-child::before {
    display: none;
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

  .node {
    z-index: 1;
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    color: var(--announcement-accent);
    background: var(--bg);
  }

  .content {
    min-width: 0;
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  strong {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .severity {
    flex: none;
    padding: 1px var(--space-2);
    border-radius: var(--radius-pill);
    color: var(--announcement-accent);
    background: var(--surface-subtle);
    font-size: var(--text-xs);
    text-transform: capitalize;
  }

  p {
    margin: var(--space-1) 0 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    white-space: pre-wrap;
  }

  small {
    display: block;
    margin-top: var(--space-1);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
</style>
