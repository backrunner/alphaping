<script lang="ts">
  import { Save } from "@lucide/svelte";

  import type { RetentionSettings } from "$lib/server/workspace-settings";
  import Button from "$components/ui/button/button.svelte";

  let {
    retention,
    estimatedStorageGb,
    estimatedStorageCapped,
  }: {
    retention: RetentionSettings;
    estimatedStorageGb: number;
    estimatedStorageCapped: boolean;
  } = $props();
</script>

<section aria-labelledby="retention-title">
  <header>
    <div>
      <h2 id="retention-title">Retention</h2>
      <p>Workspace history windows</p>
    </div>
    <div class="estimate">
      <strong
        >{#if estimatedStorageCapped}&ge;
        {/if}{estimatedStorageGb.toFixed(2)} GB</strong
      ><span
        >{estimatedStorageCapped
          ? "minimum estimated telemetry storage"
          : "estimated telemetry storage"}</span
      >
    </div>
  </header>
  <form method="POST" action="?/retention">
    <div class="fields">
      <label
        ><span>Raw blocks</span>
        <div>
          <input
            type="number"
            name="rawDays"
            min="1"
            max="90"
            value={retention.rawDays}
            required
          /><small>days</small>
        </div></label
      >
      <label
        ><span>5-minute rollups</span>
        <div>
          <input
            type="number"
            name="rollup5mDays"
            min="7"
            max="365"
            value={retention.rollup5mDays}
            required
          /><small>days</small>
        </div></label
      >
      <label
        ><span>Hourly rollups</span>
        <div>
          <input
            type="number"
            name="rollup1hDays"
            min="30"
            max="3650"
            value={retention.rollup1hDays}
            required
          /><small>days</small>
        </div></label
      >
      <label
        ><span>State events</span>
        <div>
          <input
            type="number"
            name="eventDays"
            min="30"
            max="3650"
            value={retention.eventDays}
            required
          /><small>days</small>
        </div></label
      >
      <label
        ><span>Audit log</span>
        <div>
          <input
            type="number"
            name="auditLogDays"
            min="30"
            max="3650"
            value={retention.auditLogDays}
            required
          /><small>days</small>
        </div></label
      >
      <label
        ><span>Expired announcements</span>
        <div>
          <input
            type="number"
            name="expiredAnnouncementGraceDays"
            min="1"
            max="90"
            value={retention.expiredAnnouncementGraceDays}
            required
          /><small>days</small>
        </div></label
      >
      <label
        ><span>Soft-delete grace</span>
        <div>
          <input
            type="number"
            name="softDeleteGraceDays"
            min="1"
            max="90"
            value={retention.softDeleteGraceDays}
            required
          /><small>days</small>
        </div></label
      >
    </div>
    <div class="form-footer">
      <span>D1 write rate is unchanged by retention length.</span><Button type="submit"
        ><Save size={14} />Save retention</Button
      >
    </div>
  </form>
</section>

<style>
  section {
    padding-top: var(--space-6);
    border-top: 1px solid var(--border);
  }

  header,
  .form-footer {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-3);
  }

  header {
    margin-bottom: var(--space-4);
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 14px;
    font-weight: 600;
  }

  p {
    display: block;
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .estimate span,
  .form-footer > span {
    display: block;
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .estimate {
    text-align: right;
  }

  .estimate strong {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(4, minmax(130px, 1fr));
    gap: var(--space-3);
    padding: var(--space-3) 0 var(--space-5);
    border-top: 1px solid var(--border);
  }

  label > span {
    display: block;
    margin-bottom: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 620;
  }

  label > div {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  label > div:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
  }

  input {
    min-width: 0;
    height: 32px;
    padding: 0 var(--space-2);
    border: 0;
    outline: 0;
    color: var(--text);
    background: transparent;
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  small {
    padding-right: var(--space-2);
    color: var(--text-faint);
    font-size: var(--text-xs);
  }

  .form-footer {
    align-items: center;
  }

  @media (max-width: 1000px) {
    .fields {
      grid-template-columns: repeat(2, minmax(130px, 1fr));
    }
  }

  @media (max-width: 520px) {
    .fields {
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    label > div {
      transition: none;
    }
  }
</style>
