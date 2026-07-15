<script lang="ts">
  import { Database, KeyRound, ShieldCheck } from "lucide-svelte";

  import Button from "$components/ui/button/button.svelte";

  let { data, form } = $props();
</script>

<svelte:head><title>Initialize · AlphaPing</title></svelte:head>

<main class="setup">
  <header class="setup__brand">
    <span class="setup__mark">A</span>
    <div><strong>AlphaPing</strong><span>System initialization</span></div>
  </header>

  {#if data.installed}
    <section class="setup__installed">
      <ShieldCheck size={28} />
      <h1>Initialization complete</h1>
      <p>This deployment already has an administrator and workspace.</p>
      <Button onclick={() => (window.location.href = "/login")}>Open sign in</Button>
    </section>
  {:else}
    <section class="setup__content">
      <div class="setup__intro">
        <h1>Initialize this AlphaPing deployment</h1>
        <p>Create the first administrator, workspace, and default retention policy.</p>
        <div class="setup__checks">
          <span><KeyRound size={15} /> Protected by deployment setup token</span>
          <span><Database size={15} /> Writes one atomic D1 initialization batch</span>
          <span><ShieldCheck size={15} /> Public registration remains disabled</span>
        </div>
      </div>

      <form method="POST" class="setup__form">
        {#if form?.message}<p class="form-error" role="alert">{form.message}</p>{/if}
        <label>
          <span>Setup token</span>
          <input type="password" name="token" required autocomplete="off" />
        </label>
        <div class="form-grid">
          <label>
            <span>Administrator name</span>
            <input name="name" required autocomplete="name" />
          </label>
          <label>
            <span>Email</span>
            <input type="email" name="email" required autocomplete="email" />
          </label>
        </div>
        <label>
          <span>Password</span>
          <input
            type="password"
            name="password"
            required
            minlength="12"
            autocomplete="new-password"
          />
        </label>
        <div class="form-grid">
          <label>
            <span>Workspace name</span>
            <input name="workspaceName" value="Operations" required />
          </label>
          <label>
            <span>Workspace slug</span>
            <input
              name="workspaceSlug"
              value="operations"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              minlength="3"
              maxlength="48"
              required
            />
          </label>
        </div>
        <label>
          <span>Raw telemetry retention</span>
          <select name="rawDays">
            <option value="7">7 days · recommended</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
          </select>
        </label>
        <Button type="submit">Initialize deployment</Button>
      </form>
    </section>
  {/if}
</main>

<style>
  .setup {
    width: min(100% - 24px, 980px);
    min-height: 100dvh;
    margin: 0 auto;
    padding: 24px 0;
  }

  .setup__brand {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 42px;
    border-bottom: 1px solid var(--border);
  }

  .setup__mark {
    display: grid;
    width: 26px;
    height: 26px;
    place-items: center;
    border-radius: 6px;
    color: white;
    background: var(--accent);
    font-family: var(--font-mono);
    font-weight: 750;
  }

  .setup__brand strong,
  .setup__brand span {
    display: block;
  }

  .setup__brand strong {
    font-size: 13px;
  }

  .setup__brand div > span {
    color: var(--text-faint);
    font-size: 10px;
  }

  .setup__content {
    display: grid;
    grid-template-columns: minmax(0, 0.85fr) minmax(360px, 1fr);
    gap: 56px;
    align-items: start;
    padding: 56px 0;
  }

  h1 {
    max-width: 520px;
    margin: 0 0 10px;
    font-size: clamp(23px, 3vw, 32px);
    line-height: 1.15;
  }

  .setup__intro > p,
  .setup__installed p {
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1.55;
  }

  .setup__checks {
    display: grid;
    gap: 10px;
    margin-top: 28px;
    color: var(--text-muted);
    font-size: 12px;
  }

  .setup__checks span {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .setup__form {
    display: grid;
    gap: 14px;
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  label > span {
    display: block;
    margin-bottom: 6px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
  }

  input,
  select {
    width: 100%;
    height: 36px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    background: var(--bg);
    font: inherit;
  }

  input:focus,
  select:focus {
    border-color: var(--accent);
    outline: 2px solid color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .form-error {
    margin: 0;
    padding: 9px 10px;
    border-radius: 6px;
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: 12px;
  }

  .setup__installed {
    max-width: 480px;
    padding: 64px 0;
  }

  .setup__installed :global(svg) {
    color: var(--status-healthy);
  }

  @media (max-width: 760px) {
    .setup__content {
      grid-template-columns: 1fr;
      gap: 28px;
      padding: 32px 0;
    }
  }

  @media (max-width: 480px) {
    .form-grid {
      grid-template-columns: 1fr;
    }

    .setup__form {
      padding: 14px;
    }
  }
</style>
