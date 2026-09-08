<script lang="ts">
  import { AppWindow, Copy, ExternalLink, KeyRound, Terminal } from "@lucide/svelte";
  import { onDestroy } from "svelte";
  import { installCommand as buildInstallCommand } from "$lib/install-command";

  import Button from "$components/ui/button/button.svelte";

  let {
    machineId,
    tokenId,
    token,
    expiresAt,
    ingestOrigin,
    installOrigin,
    checksums,
    manageHref,
  }: {
    machineId: string;
    tokenId: string;
    token: string;
    expiresAt: number;
    ingestOrigin: string;
    installOrigin: string;
    checksums: Record<"unix" | "windows", string>;
    manageHref: string;
  } = $props();

  let copied = $state(false);
  let copyError = $state("");
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let installMode = $state<"unix" | "windows">("unix");
  const installCommand = $derived(
    buildInstallCommand(installMode, {
      machineId,
      token,
      ingestOrigin,
      installOrigin,
      checksum: checksums[installMode],
    }),
  );
  const scriptPath = $derived(installMode === "windows" ? "/install.ps1" : "/install.sh");

  function formatExpiry(timestamp: number): string {
    return `${new Date(timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }

  function selectInstallMode(mode: "unix" | "windows") {
    installMode = mode;
    copied = false;
    copyError = "";
    clearTimeout(copyTimer);
  }

  async function copyInstallCommand() {
    const command = installCommand;
    copied = false;
    copyError = "";
    clearTimeout(copyTimer);
    try {
      await navigator.clipboard.writeText(command);
      if (command !== installCommand) return;
      copied = true;
      copyTimer = setTimeout(() => (copied = false), 1_500);
    } catch {
      if (command !== installCommand) return;
      copyError = "Clipboard unavailable. Select and copy the command below.";
    }
  }
  onDestroy(() => clearTimeout(copyTimer));
</script>

<section class="enrollment" aria-live="polite">
  <header>
    <strong>Enrollment command ready</strong>
    <span>Token {tokenId}</span>
    <span>Expires {formatExpiry(expiresAt)}</span>
  </header>
  <div class="command">
    <div class="modes" role="group" aria-label="Installation platform">
      <button
        type="button"
        aria-pressed={installMode === "unix"}
        class:active={installMode === "unix"}
        onclick={() => selectInstallMode("unix")}
      >
        <Terminal size={12} />Shell
      </button>
      <button
        type="button"
        aria-pressed={installMode === "windows"}
        class:active={installMode === "windows"}
        onclick={() => selectInstallMode("windows")}
      >
        <AppWindow size={12} />PowerShell
      </button>
    </div>
    <p class="platform-help">
      {installMode === "windows"
        ? "Windows 10/Server 2016+ · x64 or ARM64 · Run PowerShell 5.1+ as Administrator."
        : "Linux (systemd or OpenRC) and macOS 11+ · x64 or ARM64 · Root or sudo required."}
    </p>
    {#if copyError}<p class="copy-error" role="alert">{copyError}</p>{/if}
    <textarea
      readonly
      aria-label="Verified Agent installation command"
      value={installCommand}
      spellcheck="false"
      rows={8}></textarea>
    <div class="script-meta">
      <a href={`${installOrigin}${scriptPath}`} target="_blank" rel="noreferrer"
        ><ExternalLink size={12} />View script</a
      >
      <span title={checksums[installMode]}>SHA-256 {checksums[installMode]}</span>
      <a href={manageHref}><KeyRound size={12} />Manage token</a>
    </div>
  </div>
  <Button variant="secondary" onclick={copyInstallCommand}
    ><Copy size={14} />{copied ? "Copied" : "Copy"}</Button
  >
</section>

<style>
  .enrollment {
    display: grid;
    grid-template-columns: minmax(190px, auto) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    margin-block: var(--space-5);
    padding: var(--space-3);
    border: 1px solid var(--status-healthy);
    border-radius: var(--radius-card);
    background: var(--status-healthy-bg);
  }

  header strong,
  header span {
    display: block;
  }

  header strong {
    font-size: var(--text-base);
    font-weight: 600;
  }

  header span {
    max-width: 210px;
    overflow: hidden;
    margin-top: 2px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command {
    min-width: 0;
  }

  .modes,
  .script-meta {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .modes {
    margin-bottom: var(--space-2);
  }

  .modes button {
    display: inline-flex;
    height: 24px;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-button);
    color: var(--text-muted);
    background: transparent;
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
    transition:
      background-color 140ms ease,
      color 140ms ease;
  }

  .modes button.active {
    color: var(--text);
    background: var(--surface-strong);
  }

  .command > textarea {
    display: block;
    overflow: auto;
    width: 100%;
    min-height: 120px;
    max-height: 320px;
    resize: vertical;
    border: 0;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    color: var(--text);
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.7;
    white-space: pre;
  }

  .platform-help,
  .copy-error {
    margin: var(--space-2) 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .copy-error {
    color: var(--status-down);
  }

  .script-meta {
    min-width: 0;
    gap: var(--space-3);
    margin-top: var(--space-2);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .script-meta a {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-muted);
  }

  .script-meta span {
    min-width: 0;
    overflow: hidden;
    flex: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 760px) {
    .enrollment {
      grid-template-columns: 1fr auto;
    }

    .command {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }

  @media (max-width: 460px) {
    .script-meta {
      align-items: flex-start;
      flex-direction: column;
      gap: var(--space-1);
    }

    .script-meta span {
      width: 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .modes button {
      transition: none;
    }
  }
</style>
