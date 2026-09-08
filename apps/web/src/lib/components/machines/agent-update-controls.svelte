<script lang="ts">
  import type { MachineDetail } from "@alphaping/db";
  import { Boxes, Download, RefreshCw } from "@lucide/svelte";

  import Button from "$components/ui/button/button.svelte";
  import { formatRelativeTime } from "$lib/utils/format";

  let {
    agent,
    commands,
    result,
    canInstall,
  }: {
    agent: NonNullable<MachineDetail["agent"]>;
    commands: MachineDetail["agentCommands"];
    result?: { command?: string; queued?: boolean; message?: string } | null;
    canInstall: boolean;
  } = $props();

  const commandNames: Record<MachineDetail["agentCommands"][number]["type"], string> = {
    check_update: "Update check",
    install_version: "Version install",
    redetect_runtimes: "Runtime scan",
    refresh_config: "Config refresh",
  };
</script>

<section class="updates">
  <header>
    <div>
      <h2>Agent lifecycle</h2>
      <p>Installed {agent.version}</p>
    </div>
    <div class="quick-actions">
      {#if canInstall}
        <form method="POST" action="?/checkUpdate">
          <Button type="submit" variant="secondary"><RefreshCw size={13} />Check now</Button>
        </form>
      {/if}
      <form method="POST" action="?/redetectRuntimes">
        <Button type="submit" variant="secondary"><Boxes size={13} />Scan runtimes</Button>
      </form>
    </div>
  </header>

  {#if canInstall}
    <form class="install" method="POST" action="?/installVersion">
      <label>
        <span>Exact version</span>
        <input
          name="version"
          required
          pattern="[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.\-]+)?(\+[0-9A-Za-z.\-]+)?"
          placeholder="0.2.0"
        />
      </label>
      <label class="checkbox">
        <input type="checkbox" name="bypassRollout" />
        <span>Bypass rollout</span>
      </label>
      <Button type="submit"><Download size={13} />Install</Button>
    </form>
  {/if}

  {#if result?.message}
    <p class="feedback error" role="alert">{result.message}</p>
  {:else if result?.queued}
    <p class="feedback" role="status">Command queued</p>
  {/if}

  <div class="history">
    <div class="history__heading"><span>Recent commands</span><span>Status</span></div>
    {#each commands as command (command.id)}
      <div class="history__row">
        <div>
          <strong>{commandNames[command.type]}</strong>
          <time>{formatRelativeTime(command.createdAt)}</time>
        </div>
        <span class:failed={command.state === "failed"}>{command.resultCode ?? command.state}</span>
      </div>
    {:else}
      <p class="empty">No commands issued</p>
    {/each}
  </div>
</section>

<style>
  .updates {
    margin-top: var(--space-6);
    padding-top: var(--space-5);
    border-top: 1px solid var(--border);
  }

  header,
  .quick-actions,
  .install,
  .history__heading,
  .history__row,
  .history__row > div {
    display: flex;
    align-items: center;
  }

  header {
    justify-content: space-between;
    gap: var(--space-3);
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: var(--text-base);
    font-weight: 600;
  }

  header p,
  .history time,
  .empty {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .quick-actions {
    gap: var(--space-2);
  }

  .install {
    min-height: 58px;
    gap: var(--space-3);
    margin-top: var(--space-3);
    padding-block: var(--space-3);
    border-block: 1px solid var(--border);
  }

  .install label:first-child {
    width: min(220px, 100%);
  }

  label > span {
    display: block;
    margin-bottom: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  input {
    height: 32px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .checkbox {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
  }

  .checkbox input {
    width: 14px;
    height: 14px;
  }

  .checkbox span {
    margin: 0;
  }

  .feedback {
    margin-top: var(--space-2);
    color: var(--status-healthy);
    font-size: var(--text-sm);
  }

  .feedback.error,
  .history__row > span.failed {
    color: var(--status-down);
  }

  .history {
    margin-top: var(--space-4);
  }

  .history__heading,
  .history__row {
    min-height: 36px;
    justify-content: space-between;
    gap: var(--space-4);
    border-bottom: 1px solid var(--border);
  }

  .history__heading {
    color: var(--text-faint);
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  .history__row > div {
    gap: var(--space-2);
  }

  .history__row strong {
    font-size: var(--text-sm);
  }

  .history__row > span {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .empty {
    padding: var(--space-3) 0;
  }

  @media (max-width: 620px) {
    header,
    .install {
      align-items: stretch;
      flex-direction: column;
    }

    .quick-actions {
      flex-wrap: wrap;
    }

    .checkbox {
      margin-left: 0;
    }
  }
</style>
