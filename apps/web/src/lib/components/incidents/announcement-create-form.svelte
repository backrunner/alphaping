<script lang="ts">
  import Button from "$components/ui/button/button.svelte";

  let {
    localNow,
    localTomorrow,
    timezoneOffsetMinutes,
    error,
    oncancel,
  }: {
    localNow: string;
    localTomorrow: string;
    timezoneOffsetMinutes: number;
    error?: string;
    oncancel: () => void;
  } = $props();
</script>

<section
  id="create-announcement-panel"
  class="form-panel"
  aria-labelledby="create-announcement-title"
>
  <header>
    <div>
      <h2 id="create-announcement-title">Publish announcement</h2>
      <span>It disappears immediately at the expiry time.</span>
    </div>
  </header>
  <form method="POST" action="?/announcement">
    <input type="hidden" name="timezoneOffsetMinutes" value={timezoneOffsetMinutes} />
    {#if error}<p class="form-error wide" role="alert">{error}</p>{/if}
    <label
      ><span>Title</span><input
        name="title"
        required
        maxlength="120"
        placeholder="Scheduled database maintenance"
      /></label
    >
    <label
      ><span>Visibility</span><select name="visibility"
        ><option value="public">Public</option><option value="authenticated">Signed-in users</option
        ><option value="private">Administrators</option></select
      ></label
    >
    <label class="wide"
      ><span>Message</span><textarea name="body" required maxlength="4000" rows="3"
      ></textarea></label
    >
    <label
      ><span>Severity</span><select name="severity"
        ><option value="info">Information</option><option value="maintenance">Maintenance</option
        ><option value="minor">Minor</option><option value="major">Major</option><option
          value="critical">Critical</option
        ></select
      ></label
    >
    <label
      ><span>Starts</span><input
        type="datetime-local"
        name="startsAt"
        value={localNow}
        required
      /></label
    >
    <label
      ><span>Expires</span><input
        type="datetime-local"
        name="expiresAt"
        value={localTomorrow}
        required
      /></label
    >
    <div class="wide actions">
      <Button type="submit">Publish announcement</Button><Button
        type="button"
        variant="secondary"
        onclick={oncancel}>Cancel</Button
      >
    </div>
  </form>
</section>

<style>
  .form-panel {
    margin-top: var(--space-6);
    padding-block: var(--space-4);
    border-block: 1px solid var(--border);
  }
  header {
    margin-bottom: var(--space-3);
  }
  header > div {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  h2,
  p {
    margin: 0;
  }
  h2 {
    font-size: 14px;
    font-weight: 600;
  }
  header span {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  form {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
  }
  label > span {
    display: block;
    margin-bottom: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 620;
  }
  input,
  select,
  textarea {
    width: 100%;
    min-height: 32px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: var(--text-sm);
  }
  textarea {
    padding-block: var(--space-2);
    resize: vertical;
  }
  input:focus,
  select:focus,
  textarea:focus {
    border-color: var(--accent);
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .wide {
    grid-column: 1 / -1;
  }
  .actions {
    display: flex;
    gap: var(--space-2);
  }
  .form-error {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: var(--text-sm);
  }
  @media (max-width: 720px) {
    form {
      grid-template-columns: 1fr;
    }
    .wide {
      grid-column: auto;
    }
  }
</style>
