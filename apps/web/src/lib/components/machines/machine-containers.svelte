<script lang="ts">
  import { Boxes, Clock3 } from "lucide-svelte";

  const runtimes = [
    { name: "Docker Engine", detail: "Socket and API negotiation" },
    { name: "Colima", detail: "Profiles and runtime discovery" },
    { name: "Apple container", detail: "Version and availability detection" },
  ];
</script>

<header>
  <div>
    <h2>Runtime inventory</h2>
    <p>Container monitoring is enabled for this machine.</p>
  </div>
  <span class="pending"><Clock3 size={12} />Awaiting Agent inventory</span>
</header>
<div class="runtime-list">
  {#each runtimes as runtime}
    <div>
      <Boxes size={15} />
      <span><strong>{runtime.name}</strong><small>{runtime.detail}</small></span>
      <em>Pending</em>
    </div>
  {/each}
</div>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 11px;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 14px;
  }

  p {
    color: var(--text-muted);
    font-size: 10px;
  }

  .pending {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 7px;
    border-radius: 999px;
    color: var(--status-degraded);
    background: var(--status-degraded-bg);
    font-size: 9px;
  }

  .runtime-list {
    border-block: 1px solid var(--border);
  }

  .runtime-list > div {
    display: grid;
    min-height: 54px;
    grid-template-columns: 20px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
  }

  .runtime-list > div + div {
    border-top: 1px solid var(--border);
  }

  strong,
  small {
    display: block;
  }

  strong {
    font-size: 11px;
  }

  small {
    margin-top: 2px;
    color: var(--text-faint);
    font-size: 9px;
  }

  em {
    color: var(--text-muted);
    font-size: 9px;
    font-style: normal;
  }
</style>
