<script lang="ts">
  import {
    Building2,
    CheckCircle2,
    CircleAlert,
    Clock3,
    Database,
    KeyRound,
    Radio,
    Server,
    ShieldCheck,
    UserRound,
  } from "lucide-svelte";

  import Button from "$components/ui/button/button.svelte";

  import "./setup.css";

  type SetupStep = 1 | 2 | 3 | 4 | 5;

  let { data, form } = $props();
  let step = $state<SetupStep>(1);
  let setupForm = $state<HTMLFormElement>();
  let administratorName = $state("");
  let administratorEmail = $state("");
  let workspaceName = $state("Operations");
  let workspaceSlug = $state("operations");
  let rawDays = $state("7");

  const steps: ReadonlyArray<{ number: SetupStep; label: string }> = [
    { number: 1, label: "Environment" },
    { number: 2, label: "Verification" },
    { number: 3, label: "Administrator" },
    { number: 4, label: "Workspace" },
    { number: 5, label: "Retention" },
  ];

  $effect(() => {
    const submittedStep = Number(form?.step ?? 1);
    if (submittedStep >= 1 && submittedStep <= 5) step = submittedStep as SetupStep;
  });

  function nextStep() {
    if (!setupForm || (step === 1 && !data.environment?.ready)) return;
    const panel = setupForm.querySelector<HTMLElement>(`[data-step="${step}"]`);
    const fields: Array<HTMLInputElement | HTMLSelectElement> = panel
      ? [...panel.querySelectorAll("input"), ...panel.querySelectorAll("select")]
      : [];
    const invalid = fields.find((field) => !field.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      return;
    }
    if (step < 5) step = (step + 1) as SetupStep;
  }

  function loginPath(returnTo: string): string {
    return `/login?returnTo=${encodeURIComponent(returnTo)}`;
  }
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
      <p>The administrator and private workspace are ready. Choose what to monitor first.</p>
      {#if data.workspaceSlug}
        <div class="setup__next-actions">
          <a class="primary" href={loginPath(`/${data.workspaceSlug}/admin`)}>
            <Server size={15} /> Add first machine
          </a>
          <a href={loginPath(`/${data.workspaceSlug}/services`)}>
            <Radio size={15} /> Add service monitor
          </a>
        </div>
      {:else}
        <Button onclick={() => (window.location.href = "/login")}>Open sign in</Button>
      {/if}
    </section>
  {:else}
    <nav class="setup__stepper" aria-label="Initialization progress">
      <ol>
        {#each steps as item}
          <li class:active={item.number === step} class:complete={item.number < step}>
            <span aria-hidden="true">
              {#if item.number < step}<CheckCircle2 size={14} />{:else}{item.number}{/if}
            </span>
            <strong aria-current={item.number === step ? "step" : undefined}>{item.label}</strong>
          </li>
        {/each}
      </ol>
    </nav>

    <section class="setup__content">
      <aside class="setup__intro">
        <h1>Initialize this AlphaPing deployment</h1>
        <p>Verify the deployment, then create the first administrator and workspace.</p>
        <div class="setup__principles">
          <span><KeyRound size={15} /> Setup token is verified only on submit</span>
          <span><Database size={15} /> Initialization uses one D1 batch</span>
          <span><ShieldCheck size={15} /> Public registration remains disabled</span>
        </div>
      </aside>

      <form method="POST" class="setup__form" bind:this={setupForm}>
        {#if form?.message}<p class="form-error" role="alert">{form.message}</p>{/if}

        <section class="step-panel" data-step="1" hidden={step !== 1}>
          <header>
            <Database size={18} />
            <div>
              <h2>Environment</h2>
              <p>Bindings, migrations, secrets, and service origins</p>
            </div>
          </header>
          <div class="environment-list">
            {#each data.environment?.checks ?? [] as check}
              <div class:failed={!check.ready}>
                {#if check.ready}
                  <CheckCircle2 size={16} aria-hidden="true" />
                {:else}
                  <CircleAlert size={16} aria-hidden="true" />
                {/if}
                <span><strong>{check.label}</strong><small>{check.detail}</small></span>
              </div>
            {/each}
          </div>
          {#if !data.environment?.ready}
            <p class="environment-note" role="status">
              Apply both D1 migration chains and configure Worker secrets before continuing.
            </p>
          {/if}
        </section>

        <section class="step-panel" data-step="2" hidden={step !== 2}>
          <header>
            <KeyRound size={18} />
            <div>
              <h2>Deployment verification</h2>
              <p>Enter the secret configured as SETUP_TOKEN</p>
            </div>
          </header>
          <label>
            <span>Setup token</span>
            <input type="password" name="token" required minlength="20" autocomplete="off" />
          </label>
          <p class="field-note">The token is never stored in the database or browser storage.</p>
        </section>

        <section class="step-panel" data-step="3" hidden={step !== 3}>
          <header>
            <UserRound size={18} />
            <div>
              <h2>Administrator</h2>
              <p>Create the first local account</p>
            </div>
          </header>
          <label>
            <span>Administrator name</span>
            <input name="name" required autocomplete="name" bind:value={administratorName} />
          </label>
          <label>
            <span>Email</span>
            <input
              type="email"
              name="email"
              required
              autocomplete="email"
              bind:value={administratorEmail}
            />
          </label>
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
        </section>

        <section class="step-panel" data-step="4" hidden={step !== 4}>
          <header>
            <Building2 size={18} />
            <div>
              <h2>Workspace</h2>
              <p>Set the name and stable URL slug</p>
            </div>
          </header>
          <label>
            <span>Workspace name</span>
            <input name="workspaceName" required bind:value={workspaceName} />
          </label>
          <label>
            <span>Workspace slug</span>
            <input
              name="workspaceSlug"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              minlength="3"
              maxlength="48"
              required
              bind:value={workspaceSlug}
            />
          </label>
          <p class="field-note">Dashboard URL: /{workspaceSlug || "workspace"}</p>
        </section>

        <section class="step-panel" data-step="5" hidden={step !== 5}>
          <header>
            <Clock3 size={18} />
            <div>
              <h2>Retention and review</h2>
              <p>Choose raw history retention and confirm the installation</p>
            </div>
          </header>
          <label>
            <span>Raw telemetry retention</span>
            <select name="rawDays" bind:value={rawDays}>
              <option value="7">7 days · recommended</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </select>
          </label>
          <dl class="review-list">
            <div>
              <dt>Administrator</dt>
              <dd>{administratorName || "Not set"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{administratorEmail || "Not set"}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>{workspaceName} / {workspaceSlug}</dd>
            </div>
            <div>
              <dt>Raw history</dt>
              <dd>{rawDays} days</dd>
            </div>
            <div>
              <dt>Dashboard access</dt>
              <dd>Private by default</dd>
            </div>
          </dl>
        </section>

        <footer class="setup__actions">
          {#if step > 1}
            <Button variant="secondary" onclick={() => (step = (step - 1) as SetupStep)}
              >Back</Button
            >
          {/if}
          {#if step < 5}
            <Button
              class="next"
              disabled={step === 1 && !data.environment?.ready}
              onclick={nextStep}>Continue</Button
            >
          {:else}
            <Button class="next" type="submit">Initialize deployment</Button>
          {/if}
        </footer>
      </form>
    </section>
  {/if}
</main>
