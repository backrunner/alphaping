<script lang="ts">
  import { ArrowLeft, Bell, Megaphone, Plus } from "lucide-svelte";

  import AnnouncementCreateForm from "$components/incidents/announcement-create-form.svelte";
  import IncidentCreateForm from "$components/incidents/incident-create-form.svelte";
  import IncidentItem from "$components/incidents/incident-item.svelte";
  import Button from "$components/ui/button/button.svelte";

  let { data, form } = $props();
  let showCreateIncident = $state(false);
  let showCreateAnnouncement = $state(false);

  const timezoneOffsetMinutes = new Date().getTimezoneOffset();
  const localNow = new Date(Date.now() - timezoneOffsetMinutes * 60_000).toISOString().slice(0, 16);
  const localTomorrow = new Date(Date.now() - timezoneOffsetMinutes * 60_000 + 24 * 60 * 60_000)
    .toISOString()
    .slice(0, 16);
  const incidentErrorProps = $derived(
    form?.kind === "incident" && "message" in form ? { error: form.message } : {},
  );
  const announcementErrorProps = $derived(
    form?.kind === "announcement" && "message" in form ? { error: form.message } : {},
  );
</script>

<svelte:head><title>Incidents · {data.workspace.name}</title></svelte:head>

<main>
  <header class="page-header">
    <div>
      <a href={`/${data.workspace.slug}`}><ArrowLeft size={14} />Overview</a>
      <h1>Incidents</h1>
      <p>Operational updates and time-bound announcements</p>
    </div>
    <div class="actions">
      {#if data.canManageAnnouncements}<Button
          variant="secondary"
          onclick={() => (showCreateAnnouncement = !showCreateAnnouncement)}
          ><Megaphone size={14} />Announcement</Button
        >{/if}
      {#if data.canCreateIncident}<Button onclick={() => (showCreateIncident = !showCreateIncident)}
          ><Plus size={14} />New incident</Button
        >{/if}
    </div>
  </header>

  {#if showCreateIncident}
    <IncidentCreateForm
      services={data.services}
      {localNow}
      {timezoneOffsetMinutes}
      {...incidentErrorProps}
      oncancel={() => (showCreateIncident = false)}
    />
  {/if}

  {#if showCreateAnnouncement && data.canManageAnnouncements}
    <AnnouncementCreateForm
      {localNow}
      {localTomorrow}
      {timezoneOffsetMinutes}
      {...announcementErrorProps}
      oncancel={() => (showCreateAnnouncement = false)}
    />
  {/if}

  {#if data.announcements.length > 0}
    <section class="announcements">
      <header>
        <div>
          <h2>Visible announcements</h2>
          <span>{data.announcements.length} active or scheduled</span>
        </div>
      </header>
      {#each data.announcements as announcement (announcement.id)}
        <article>
          <div>
            <strong>{announcement.title}</strong><span
              >{announcement.visibility} · {announcement.severity}</span
            >
          </div>
          <p>{announcement.body}</p>
          <small
            >{new Date(announcement.startsAt).toLocaleString()} → {new Date(
              announcement.expiresAt,
            ).toLocaleString()}</small
          >
        </article>
      {/each}
    </section>
  {/if}

  <section class="incidents">
    <header>
      <div>
        <h2>Incident timeline</h2>
        <span>Newest incidents first</span>
      </div>
    </header>
    {#if data.incidents.length > 0}
      {#each data.incidents as incident (incident.id)}<IncidentItem {incident} />{/each}
    {:else}
      <div class="empty">
        <Bell size={24} />
        <h2>No incidents recorded</h2>
        <p>Service interruptions and progress updates will appear here.</p>
      </div>
    {/if}
  </section>
</main>

<style>
  main {
    width: min(100% - 24px, 1040px);
    margin: 0 auto;
    padding: 24px 0 48px;
  }
  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 18px;
    padding-bottom: 18px;
    border-bottom: 1px solid var(--border);
  }
  .page-header a {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    font-size: 11px;
    text-decoration: none;
  }
  h1,
  h2,
  p {
    margin: 0;
  }
  h1 {
    margin-top: 14px;
    font-size: 22px;
  }
  .page-header p {
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 11px;
  }
  .actions {
    display: flex;
    gap: 7px;
  }
  section {
    margin-top: 24px;
  }
  section > header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  section > header > div {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  section h2 {
    font-size: 14px;
  }
  section header span {
    color: var(--text-faint);
    font-size: 10px;
  }
  .announcements article {
    padding: 10px 0;
    border-top: 1px solid var(--border);
  }
  .announcements article > div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  .announcements strong {
    font-size: 11px;
  }
  .announcements span,
  .announcements small {
    color: var(--text-faint);
    font-size: 9px;
  }
  .announcements p {
    margin: 4px 0;
    color: var(--text-muted);
    font-size: 10px;
    white-space: pre-wrap;
  }
  .empty {
    display: grid;
    justify-items: start;
    gap: 5px;
    padding: 28px 0;
    color: var(--text-faint);
  }
  .empty h2 {
    color: var(--text);
    font-size: 13px;
  }
  .empty p {
    color: var(--text-muted);
    font-size: 10px;
  }
  @media (max-width: 720px) {
    .page-header {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
