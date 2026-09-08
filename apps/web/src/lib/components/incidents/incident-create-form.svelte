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
        placeholder="We are investigating elevated errors."></textarea></label
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
    margin-top: var(--space-6);
    padding-block: var(--space-4);
    border-block: 1px solid var(--border);
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
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
  label > span,
  legend {
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
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }
  .service-options,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .service-options label {
    display: inline-flex;
    height: 28px;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--surface);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .service-options label:has(input:checked) {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--surface));
  }
  .service-options input {
    width: 14px;
    min-height: 14px;
  }
  .service-options span {
    margin: 0;
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
