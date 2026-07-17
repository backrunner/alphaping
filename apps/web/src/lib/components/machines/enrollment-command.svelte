<script lang="ts">
  import { AppWindow, Copy, ExternalLink, KeyRound, Terminal } from "lucide-svelte";

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
  let installMode = $state<"unix" | "windows">("unix");
  const installCommand = $derived(
    installMode === "windows"
      ? `& ([scriptblock]::Create((irm ${installOrigin}/install.ps1))) -Endpoint '${ingestOrigin}' -ManifestOrigin '${installOrigin}' -Machine '${machineId}' -Token '${token}'`
      : `curl -fsSL ${installOrigin}/install.sh | sudo sh -s -- --endpoint ${ingestOrigin} --manifest-origin ${installOrigin} --machine ${machineId} --token ${token}`,
  );
  const scriptPath = $derived(installMode === "windows" ? "/install.ps1" : "/install.sh");

  function formatExpiry(timestamp: number): string {
    return `${new Date(timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }

  async function copyInstallCommand() {
    await navigator.clipboard.writeText(installCommand);
    copied = true;
    setTimeout(() => (copied = false), 1_500);
  }
</script>

<section class="enrollment" aria-live="polite">
  <header>
    <strong>Enrollment command ready</strong>
    <span>Token {tokenId}</span>
    <span>Expires {formatExpiry(expiresAt)}</span>
  </header>
  <div class="command">
    <div class="modes" role="tablist" aria-label="Installation platform">
      <button
        type="button"
        role="tab"
        aria-selected={installMode === "unix"}
        class:active={installMode === "unix"}
        onclick={() => (installMode = "unix")}
      >
        <Terminal size={12} />Shell
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={installMode === "windows"}
        class:active={installMode === "windows"}
        onclick={() => (installMode = "windows")}
      >
        <AppWindow size={12} />PowerShell
      </button>
    </div>
    <code>{installCommand}</code>
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
    gap: 12px;
    margin-block: 18px;
    padding: 12px;
    border: 1px solid var(--status-healthy);
    border-radius: 6px;
    background: var(--status-healthy-bg);
  }

  header strong,
  header span {
    display: block;
  }

  header span {
    max-width: 210px;
    overflow: hidden;
    margin-top: 2px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 9px;
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
    margin-bottom: 6px;
  }

  .modes button {
    display: inline-flex;
    height: 24px;
    align-items: center;
    gap: 5px;
    padding: 0 7px;
    border: 0;
    border-radius: 4px;
    color: var(--text-muted);
    background: transparent;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .modes button.active {
    color: var(--text);
    background: var(--surface-strong);
  }

  .command > code {
    display: block;
    overflow: hidden;
    padding: 7px 8px;
    border-radius: 4px;
    color: var(--text);
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .script-meta {
    min-width: 0;
    gap: 10px;
    margin-top: 6px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 9px;
  }

  .script-meta a {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
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
      gap: 5px;
    }

    .script-meta span {
      width: 100%;
    }
  }
</style>
