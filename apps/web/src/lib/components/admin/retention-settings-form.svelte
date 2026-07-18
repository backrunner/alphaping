<script lang="ts">
  import { Save } from "lucide-svelte";

  import type { RetentionSettings } from "$lib/server/workspace-settings";
  import Button from "$components/ui/button/button.svelte";

  let {
    retention,
    estimatedStorageGb,
  }: { retention: RetentionSettings; estimatedStorageGb: number } = $props();
</script>

<section aria-labelledby="retention-title">
  <header>
    <div>
      <h2 id="retention-title">Retention</h2>
      <p>Workspace history windows</p>
    </div>
    <div class="estimate">
      <strong>{estimatedStorageGb.toFixed(2)} GB</strong><span>estimated telemetry storage</span>
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
    padding-top: 24px;
    border-top: 1px solid var(--border);
  }

  header,
  .form-footer {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }

  header {
    margin-bottom: 14px;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 15px;
  }

  p,
  .estimate span,
  .form-footer > span {
    display: block;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 10px;
  }

  .estimate {
    text-align: right;
  }

  .estimate strong {
    font-family: var(--font-mono);
    font-size: 13px;
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(4, minmax(130px, 1fr));
    gap: 12px;
    padding: 12px 0 18px;
    border-top: 1px solid var(--border);
  }

  label > span {
    display: block;
    margin-bottom: 5px;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 650;
  }

  label > div {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
  }

  label > div:focus-within {
    border-color: var(--accent);
    outline: 2px solid var(--focus-ring);
  }

  input {
    min-width: 0;
    height: 32px;
    padding: 0 8px;
    border: 0;
    outline: 0;
    color: var(--text);
    background: transparent;
    font: inherit;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  small {
    padding-right: 8px;
    color: var(--text-faint);
    font-size: 9px;
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
</style>
