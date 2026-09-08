<script lang="ts">
  import { page } from "$app/state";
  import { ArrowLeft, Bell, Megaphone, Plus } from "@lucide/svelte";

  import AnnouncementCreateForm from "$components/incidents/announcement-create-form.svelte";
  import IncidentCreateForm from "$components/incidents/incident-create-form.svelte";
  import IncidentItem from "$components/incidents/incident-item.svelte";
  import Button from "$components/ui/button/button.svelte";
  import EmptyState from "$components/ui/empty-state/empty-state.svelte";

  let { data, form } = $props();
  let incidentFormOpen = $state<boolean | null>(null);
  let announcementFormOpen = $state<boolean | null>(null);
  const incidentFormError = $derived(form?.kind === "incident" && "message" in form);
  const announcementFormError = $derived(form?.kind === "announcement" && "message" in form);
  const showCreateIncident = $derived(incidentFormOpen ?? incidentFormError);
  const showCreateAnnouncement = $derived(announcementFormOpen ?? announcementFormError);
  const activeOnly = $derived(page.url.searchParams.get("state") === "active");
  const visibleIncidents = $derived(
    activeOnly
      ? data.incidents.filter((incident) => incident.state !== "resolved")
      : data.incidents,
  );

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
  const updateError = $derived(form?.kind === "update" && "message" in form ? form.message : null);

  function toggleIncidentForm(): void {
    incidentFormOpen = !showCreateIncident;
    if (incidentFormOpen) announcementFormOpen = false;
  }

  function toggleAnnouncementForm(): void {
    announcementFormOpen = !showCreateAnnouncement;
    if (announcementFormOpen) incidentFormOpen = false;
  }
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
          aria-controls="create-announcement-panel"
          aria-expanded={showCreateAnnouncement}
          onclick={toggleAnnouncementForm}><Megaphone size={14} />Announcement</Button
        >{/if}
      {#if data.canCreateIncident}<Button
          aria-controls="create-incident-panel"
          aria-expanded={showCreateIncident}
          onclick={toggleIncidentForm}><Plus size={14} />New incident</Button
        >{/if}
    </div>
  </header>

  {#if showCreateIncident}
    <IncidentCreateForm
      services={data.services}
      {localNow}
      {timezoneOffsetMinutes}
      {...incidentErrorProps}
      oncancel={() => (incidentFormOpen = false)}
    />
  {/if}

  {#if showCreateAnnouncement && data.canManageAnnouncements}
    <AnnouncementCreateForm
      {localNow}
      {localTomorrow}
      {timezoneOffsetMinutes}
      {...announcementErrorProps}
      oncancel={() => (announcementFormOpen = false)}
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
        <span>{activeOnly ? "Active incidents" : "Newest incidents first"}</span>
      </div>
      <nav aria-label="Filter incidents">
        <a class:active={!activeOnly} href={`/${data.workspace.slug}/incidents`}>All</a>
        <a class:active={activeOnly} href={`/${data.workspace.slug}/incidents?state=active`}
          >Active</a
        >
      </nav>
    </header>
    {#if updateError}<p class="form-error" role="alert">{updateError}</p>{/if}
    {#if visibleIncidents.length > 0}
      {#each visibleIncidents as incident (incident.id)}<IncidentItem {incident} />{/each}
    {:else}
      <EmptyState
        icon={Bell}
        title="No incidents recorded"
        description="Service interruptions and progress updates will appear here."
        compact
      />
    {/if}
  </section>
</main>

<style>
  main {
    width: min(100% - 24px, var(--content-wide));
    margin: 0 auto;
    padding: var(--space-6) 0 var(--space-8);
  }
  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--border);
  }
  .page-header a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-decoration: none;
  }
  .page-header a:hover {
    color: var(--accent);
  }
  h1,
  h2,
  p {
    margin: 0;
  }
  h1 {
    margin-top: var(--space-2);
    font-size: var(--text-xl);
    font-weight: 600;
    line-height: var(--leading-xl);
  }
  .page-header p {
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
  }
  section {
    margin-top: var(--space-6);
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
  section h2 {
    font-size: 14px;
    font-weight: 600;
  }
  section header span {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  section header nav {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-pill);
    background: var(--surface-subtle);
  }
  section header nav a {
    display: inline-flex;
    height: 26px;
    align-items: center;
    padding: 0 var(--space-3);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-decoration: none;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }
  section header nav a:hover {
    color: var(--text);
  }
  section header nav a.active {
    color: var(--text);
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--border);
    font-weight: 620;
  }
  .announcements article {
    padding: var(--space-3) 0;
    border-top: 1px solid var(--border);
  }
  .announcements article > div {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .announcements strong {
    font-size: var(--text-base);
    font-weight: 620;
  }
  .announcements span,
  .announcements small {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  .announcements p {
    margin: var(--space-1) 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    white-space: pre-wrap;
  }
  .form-error {
    margin: 0 0 var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: var(--text-sm);
  }
  @media (max-width: 720px) {
    .page-header {
      align-items: flex-start;
      flex-direction: column;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    section header nav a {
      transition: none;
    }
  }
</style>
