<script lang="ts">
  import Button from "$components/ui/button/button.svelte";

  let {
    services,
    localNow,
    timezoneOffsetMinutes,
    error,
    oncancel,
  }: {
    services: readonly { id: string; name: string; canManage: boolean }[];
    localNow: string;
    timezoneOffsetMinutes: number;
    error?: string;
    oncancel: () => void;
  } = $props();
</script>

<section id="create-incident-panel" class="form-panel" aria-labelledby="create-incident-title">
  <header>
    <div>
      <h2 id="create-incident-title">Create incident</h2>
      <span>The first update is published immediately.</span>
    </div>
  </header>
  <form method="POST" action="?/incident">
    <input type="hidden" name="timezoneOffsetMinutes" value={timezoneOffsetMinutes} />
    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
    <label
      ><span>Title</span><input
        name="title"
        required
        maxlength="120"
        placeholder="API requests failing"
      /></label
    >
    <label class="wide"
      ><span>Initial update</span><textarea
        name="summary"
        required
        maxlength="2000"
        rows="3"
        placeholder="We are investigating elevated errors."
      ></textarea></label
    >
    <label
      ><span>Severity</span><select name="severity"
        ><option value="minor">Minor</option><option value="major">Major</option><option
          value="critical">Critical</option
        ></select
      ></label
    >
    <label
      ><span>Impact</span><select name="impact"
        ><option value="degraded">Degraded</option><option value="down">Down</option></select
      ></label
    >
    <label
      ><span>Started</span><input
        type="datetime-local"
        name="startsAt"
        value={localNow}
        required
      /></label
    >
    <fieldset class="wide">
      <legend>Affected services</legend>
      <div class="service-options">
        {#each services.filter((service) => service.canManage) as service}<label
            ><input type="checkbox" name="serviceIds" value={service.id} /><span
              >{service.name}</span
            ></label
          >{/each}
      </div>
    </fieldset>
    <div class="wide actions">
      <Button type="submit">Create incident</Button><Button
        type="button"
        variant="secondary"
        onclick={oncancel}>Cancel</Button
      >
    </div>
  </form>
</section>

<style>
  .form-panel {
    margin-top: 24px;
    padding-block: 16px;
    border-block: 1px solid var(--border);
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  header > div {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  h2,
  p {
    margin: 0;
  }
  h2 {
    font-size: 14px;
  }
  header span {
    color: var(--text-faint);
    font-size: 10px;
  }
  form {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  label > span,
  legend {
    display: block;
    margin-bottom: 5px;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 620;
  }
  input,
  select,
  textarea {
    width: 100%;
    min-height: 32px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
  }
  textarea {
    padding-block: 7px;
    resize: vertical;
  }
  input:focus,
  select:focus,
  textarea:focus {
    border-color: var(--accent);
    outline: 2px solid var(--focus-ring);
  }
  .wide {
    grid-column: 1 / -1;
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }
  .service-options,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .service-options label {
    display: inline-flex;
    height: 28px;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
  }
  .service-options input {
    width: 13px;
    min-height: 13px;
  }
  .service-options span {
    margin: 0;
  }
  .form-error {
    padding: 8px 10px;
    border-radius: 6px;
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: 11px;
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
