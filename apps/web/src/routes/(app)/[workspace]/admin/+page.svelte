<script lang="ts">
  import { ArrowLeft, Copy, Server, Terminal, AppWindow } from "lucide-svelte";

  import ServiceMonitorForm from "$components/admin/service-monitor-form.svelte";
  import Button from "$components/ui/button/button.svelte";

  let { data, form } = $props();
  let copied = $state(false);
  let installMode = $state<"unix" | "windows">("unix");

  const unixInstallCommand = $derived(
    form?.kind === "machine" && form.machine
      ? `curl -fsSL https://github.com/alkinum/alphaping/releases/latest/download/install.sh | sudo sh -s -- --endpoint ${data.ingestOrigin} --machine ${form.machine.machineId} --token ${form.machine.token}`
      : "",
  );
  const windowsInstallCommand = $derived(
    form?.kind === "machine" && form.machine
      ? `& ([scriptblock]::Create((irm https://github.com/alkinum/alphaping/releases/latest/download/install.ps1))) -Endpoint '${data.ingestOrigin}' -Machine '${form.machine.machineId}' -Token '${form.machine.token}'`
      : "",
  );
  const installCommand = $derived(
    installMode === "windows" ? windowsInstallCommand : unixInstallCommand,
  );

  async function copyInstallCommand() {
    if (!installCommand) return;
    await navigator.clipboard.writeText(installCommand);
    copied = true;
    setTimeout(() => (copied = false), 1_500);
  }
</script>

<svelte:head><title>Developer · AlphaPing</title></svelte:head>

<main class="admin">
  <header class="admin__header">
    <div>
      <a href={`/${data.workspace}`}><ArrowLeft size={14} />Overview</a>
      <h1>Developer</h1>
      <p>Configure resources and generate enrollment credentials.</p>
    </div>
  </header>

  {#if form?.kind === "machine" && form.machine}
    <section class="enrollment" aria-live="polite">
      <div>
        <strong>Enrollment command ready</strong>
        <span>Expires {new Date(form.machine.expiresAt).toLocaleTimeString()}</span>
      </div>
      <div class="enrollment__command">
        <div class="enrollment__modes" role="tablist" aria-label="Installation platform">
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
      </div>
      <Button variant="secondary" onclick={copyInstallCommand}
        ><Copy size={14} />{copied ? "Copied" : "Copy"}</Button
      >
    </section>
  {/if}

  <div class="admin__grid">
    <section>
      <header>
        <Server size={18} />
        <div>
          <h2>Add machine</h2>
          <p>Creates a 15 minute one-time enrollment token.</p>
        </div>
      </header>
      <form method="POST" action="?/machine">
        {#if form?.kind === "machine" && form.message}<p class="form-error" role="alert">
            {form.message}
          </p>{/if}
        <label
          ><span>Name</span><input
            name="name"
            required
            maxlength="80"
            placeholder="edge-01"
          /></label
        >
        <label
          ><span>Expected host or IP</span><input
            name="expectedHost"
            maxlength="253"
            placeholder="10.0.0.12"
          /></label
        >
        <label class="checkbox"
          ><input type="checkbox" name="containersEnabled" /><span>Enable container monitoring</span
          ></label
        >
        <Button type="submit">Create machine</Button>
      </form>
    </section>

    <div class="service-monitor"><ServiceMonitorForm agents={data.agents} result={form} /></div>
  </div>
</main>

<style>
  .admin {
    width: min(100% - 24px, 1040px);
    margin: 0 auto;
    padding: 24px 0 48px;
  }

  .admin__header {
    padding-bottom: 18px;
    border-bottom: 1px solid var(--border);
  }

  .admin__header a {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
    font-size: 11px;
    text-decoration: none;
  }

  h1 {
    margin: 18px 0 4px;
    font-size: 22px;
  }

  .admin__header p,
  section header p {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .admin__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 28px;
    padding-top: 28px;
  }

  .admin__grid > .service-monitor {
    padding-left: 28px;
    border-left: 1px solid var(--border);
  }

  section header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 18px;
  }

  section header > :global(svg) {
    color: var(--accent);
  }

  h2 {
    margin: 0 0 3px;
    font-size: 15px;
  }

  form {
    display: grid;
    gap: 14px;
  }

  label > span {
    display: block;
    margin-bottom: 6px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
  }

  input {
    width: 100%;
    height: 36px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
  }

  input:focus {
    border-color: var(--accent);
    outline: 2px solid color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .checkbox {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .checkbox input {
    width: 15px;
    height: 15px;
  }

  .checkbox span {
    margin: 0;
  }

  .form-error {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 11px;
  }

  .form-error {
    color: var(--status-down);
    background: var(--status-down-bg);
  }

  .enrollment {
    display: grid;
    grid-template-columns: minmax(160px, auto) minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    margin-top: 18px;
    padding: 12px;
    border: 1px solid var(--status-healthy);
    border-radius: 6px;
    background: var(--status-healthy-bg);
  }

  .enrollment strong,
  .enrollment span {
    display: block;
  }

  .enrollment span {
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 10px;
  }

  .enrollment__command {
    min-width: 0;
  }

  .enrollment__modes {
    display: flex;
    gap: 2px;
    margin-bottom: 6px;
  }

  .enrollment__modes button {
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

  .enrollment__modes button.active {
    color: var(--text);
    background: var(--surface-strong);
  }

  .enrollment code {
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

  @media (max-width: 760px) {
    .admin__grid {
      grid-template-columns: 1fr;
    }

    .admin__grid > .service-monitor {
      padding-top: 28px;
      padding-left: 0;
      border-top: 1px solid var(--border);
      border-left: 0;
    }

    .enrollment {
      grid-template-columns: 1fr auto;
    }

    .enrollment code {
      grid-column: 1 / -1;
    }

    .enrollment__command {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }
</style>
