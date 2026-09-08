<script lang="ts">
  import { enhance } from "$app/forms";
  import { ArrowUpRight, Check, Save } from "@lucide/svelte";
  import {
    appearancePalettes,
    validateSiteLogoUrl,
    type SiteAppearance,
  } from "@alphaping/contracts";
  import Button from "$components/ui/button/button.svelte";
  import SiteLogo from "$components/layout/site-logo.svelte";
  let { data, form } = $props();
  // Form state intentionally starts from the saved dashboard settings.
  // svelte-ignore state_referenced_locally
  let draft = $state<SiteAppearance>({ ...data.appearance });
  // svelte-ignore state_referenced_locally
  let draftWorkspace = $state(data.shell.workspace.slug);
  $effect(() => {
    if (draftWorkspace !== data.shell.workspace.slug) {
      draft = { ...data.appearance };
      draftWorkspace = data.shell.workspace.slug;
    }
  });
  let saving = $state(false);
  let failedLogoUrl = $state("");
  // svelte-ignore state_referenced_locally
  let previewLogoUrl = $state(data.appearance.logoUrl);
  $effect(() => {
    const url = draft.logoUrl;
    const timer = setTimeout(() => {
      previewLogoUrl = url;
    }, 400);
    return () => clearTimeout(timer);
  });
  const logoValidation = $derived.by(() => {
    try {
      validateSiteLogoUrl(draft.logoUrl);
      return "";
    } catch (cause) {
      return cause instanceof Error ? cause.message : "Enter a public logo image address";
    }
  });
  const names = { iris: "Iris", ocean: "Ocean", mint: "Mint", sunset: "Sunset", rose: "Rose" };
  const colors = {
    iris: "#8975ed",
    ocean: "#4386dc",
    mint: "#39b494",
    sunset: "#e2925a",
    rose: "#d36d9d",
  };
</script>

<svelte:head><title>Appearance · {data.shell.workspace.name}</title></svelte:head>
<main>
  <header class="page-intro">
    <div>
      <h2>Public page appearance</h2>
      <p>Set the identity, colors and layout of your public pages.</p>
    </div>
  </header>
  {#if form?.message}<p class="message error" role="alert">{form.message}</p>{/if}
  {#if form?.saved}<p class="message success" role="status">
      <Check size={16} />Appearance saved. Public pages update within 30 seconds.
    </p>{/if}
  <div class="appearance-editor">
    <form
      method="POST"
      use:enhance={() => {
        saving = true;
        return async ({ update }) => {
          try {
            await update({ reset: false });
          } finally {
            saving = false;
          }
        };
      }}
    >
      <fieldset>
        <legend>Site identity</legend>
        <label
          >Logo image address<input
            name="logoUrl"
            inputmode="url"
            maxlength="512"
            autocomplete="off"
            spellcheck="false"
            placeholder="https://example.com/logo.svg"
            aria-describedby="logo-help logo-feedback"
            aria-invalid={logoValidation ? true : undefined}
            bind:value={draft.logoUrl}
          /><small id="logo-help"
            >Use a public HTTPS image or a path on this site, such as /logo.svg. Leave blank for
            AlphaPing.</small
          ></label
        >
        <div class="logo-feedback" id="logo-feedback" aria-live="polite">
          {#if logoValidation}<p class="error">{logoValidation}</p>
          {:else if draft.logoUrl && failedLogoUrl === draft.logoUrl}<p>
              The logo could not be loaded. AlphaPing will be used instead.
            </p>{/if}
        </div>
        {#if draft.logoUrl}<button
            class="reset-logo"
            type="button"
            onclick={() => {
              draft.logoUrl = "";
            }}>Use default logo</button
          >{/if}
        <label
          >Site title<input
            name="title"
            maxlength="80"
            placeholder={data.shell.workspace.name}
            bind:value={draft.title}
          /><small>Leave blank to use the workspace name.</small></label
        >
        <label
          >Introduction<textarea
            name="description"
            rows="3"
            maxlength="240"
            placeholder="A little about the infrastructure you're sharing."
            bind:value={draft.description}></textarea><small class="character-count"
            >{draft.description.length}/240 characters</small
          ></label
        >
      </fieldset>
      <fieldset>
        <legend>Colors</legend>
        <div class="palettes">
          {#each appearancePalettes as palette}
            <label class:chosen={draft.palette === palette}
              ><input type="radio" name="palette" value={palette} bind:group={draft.palette} /><span
                class="swatch"
                style:--swatch={colors[palette]}
                >{#if draft.palette === palette}<Check size={18} />{/if}</span
              ><strong>{names[palette]}</strong></label
            >
          {/each}
        </div>
      </fieldset>
      <fieldset>
        <legend>Display defaults</legend>
        <div class="two-fields">
          <label
            >Color mode<select name="mode" bind:value={draft.mode}
              ><option value="system">Follow device</option><option value="light">Light</option
              ><option value="dark">Dark</option></select
            ></label
          >
          <label
            >Layout<select name="density" bind:value={draft.density}
              ><option value="comfortable">Comfortable</option><option value="compact"
                >Compact</option
              ></select
            ></label
          >
        </div>
        <p class="hint">
          Visitors can personalize their own view without changing your site defaults.
        </p>
      </fieldset>
      <div class="form-footer">
        <Button type="submit" disabled={saving}
          ><Save size={15} />{saving ? "Saving…" : "Save appearance"}</Button
        ><a href={`/status/${data.shell.workspace.slug}`} target="_blank" rel="noreferrer"
          >View public page<ArrowUpRight size={14} /></a
        >
      </div>
    </form>
    <aside aria-label="Appearance preview">
      <div class="preview-label">
        Preview<span>Example data</span>
      </div>
      <div
        class="preview appearance-surface"
        data-palette={draft.palette}
        data-mode={draft.mode}
        data-density={draft.density}
      >
        <div class="preview-brand">
          <SiteLogo
            logoUrl={logoValidation ? "" : previewLogoUrl}
            size={32}
            onStatus={(status) => {
              failedLogoUrl = status === "error" ? previewLogoUrl : "";
            }}
          />{draft.title || data.shell.workspace.name}
        </div>
        <div class="preview-hero">
          <h3>All systems operational</h3>
          {#if draft.description}<p>{draft.description}</p>{/if}
        </div>
        <div class="preview-cards">
          {#each [1, 2] as n}<div>
              <strong>Example machine {n}</strong>
              <div class="sample-metrics"><span>CPU<b>—</b></span><span>Memory<b>—</b></span></div>
              <div class="sample-track"></div>
            </div>{/each}
        </div>
        <div class="preview-service">
          <strong>Example service</strong>
          <div>
            {#each Array(20) as _}<i></i>{/each}
          </div>
        </div>
      </div>
      <p class="preview-note">
        Preview data is illustrative. Only explicitly published resources appear on the real status
        page.
      </p>
    </aside>
  </div>
</main>

<style>
  main {
    min-width: 0;
  }
  .page-intro {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 28px;
  }
  h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
  }
  .page-intro p {
    margin: 6px 0 0;
    line-height: 1.6;
    font-size: 13px;
    color: var(--text-muted);
  }
  .appearance-editor {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 32px;
    align-items: start;
  }
  form {
    min-width: 0;
  }
  fieldset {
    min-width: 0;
    border: 0;
    margin: 0 0 26px;
    padding: 0;
  }
  legend {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 18px;
  }
  label:not(.palettes label) {
    display: grid;
    gap: 8px;
    margin-bottom: 16px;
    font-size: 12px;
    font-weight: 600;
  }
  input:not([type="radio"]),
  textarea,
  select {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--text);
    padding: 10px 12px;
    font-size: 13px;
    font-weight: 400;
  }
  textarea {
    resize: vertical;
  }
  .logo-feedback p {
    margin: -6px 0 12px;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.6;
  }
  .logo-feedback .error {
    color: var(--status-down);
  }
  .reset-logo {
    min-height: 36px;
    margin: 0 0 20px;
    padding: 7px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-button);
    background: var(--surface);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }
  .reset-logo:hover {
    background: var(--surface-subtle);
  }
  small,
  .hint {
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 400;
    line-height: 1.6;
  }
  .character-count {
    text-align: right;
  }
  .palettes {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
  }
  .palettes label {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 10px;
    padding: 12px 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    cursor: pointer;
    background: var(--surface);
  }
  .palettes label.chosen {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .palettes input {
    position: absolute;
    width: 1px;
    height: 1px;
    clip-path: inset(50%);
    overflow: hidden;
  }
  .palettes label:has(input:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 3px;
  }
  .swatch {
    display: grid;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    place-items: center;
    background: var(--swatch);
    color: #171a28;
  }
  .palettes strong {
    font-size: 11px;
    font-weight: 500;
  }
  .two-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .hint {
    margin: 0;
  }
  .form-footer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
  }
  .form-footer a {
    display: inline-flex;
    gap: 5px;
    align-items: center;
    color: var(--accent);
    font-size: 12px;
    text-decoration: none;
  }
  aside {
    position: sticky;
    top: 84px;
    min-width: 0;
  }
  .preview-label {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 12px;
  }
  .preview-label > span {
    margin-left: auto;
    color: var(--text-faint);
    letter-spacing: 0;
    font-weight: 400;
  }
  .preview {
    min-height: 0;
    padding: 22px;
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    box-shadow: var(--shadow-panel);
  }
  .preview-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .preview-hero {
    margin: 22px 0;
    padding: 26px 20px;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: linear-gradient(
      120deg,
      var(--surface),
      color-mix(in srgb, var(--palette-companion) 14%, var(--surface))
    );
    box-shadow: var(--shadow-card);
  }
  h3 {
    font-size: 22px;
    line-height: 1.3;
    margin: 10px 0;
    overflow-wrap: anywhere;
  }
  .preview-hero p {
    font-size: 11px;
    line-height: 1.65;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .preview-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .preview-cards > div {
    min-width: 0;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }
  .preview-cards strong {
    display: block;
    margin: 12px 0;
    font-size: 10px;
  }
  .sample-metrics {
    display: flex;
    gap: 14px;
    color: var(--text-faint);
    font-size: 9px;
  }
  .sample-metrics b {
    display: block;
    margin-top: 5px;
    color: var(--text);
    font-size: 14px;
  }
  .sample-track {
    height: 4px;
    border-radius: 4px;
    background: var(--surface-strong);
    margin-top: 12px;
  }
  .preview-service {
    margin-top: 18px;
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-card);
    font-size: 11px;
  }
  .preview-service > div {
    display: flex;
    gap: 3px;
    margin-top: 12px;
  }
  .preview-service i {
    height: 16px;
    flex: 1;
    border-radius: 3px;
    background: var(--status-healthy);
  }
  .preview[data-density="compact"] .preview-cards > div {
    padding: 10px;
  }
  .preview-note {
    margin: 14px 4px 0;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.7;
  }
  .message {
    padding: 12px 16px;
    border-radius: var(--radius-control);
    font-size: 13px;
    margin-bottom: 20px;
  }
  .error {
    color: var(--status-down);
    background: var(--status-down-bg);
  }
  .success {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--status-healthy);
    background: var(--status-healthy-bg);
  }
  @media (max-width: 1100px) {
    .appearance-editor {
      grid-template-columns: 1fr;
    }
    aside {
      position: static;
      max-width: 520px;
    }
    .page-intro {
      align-items: flex-start;
    }
  }
  @media (max-width: 480px) {
    h2 {
      font-size: 20px;
    }
    .preview {
      padding: 16px;
    }
    .preview-cards > div {
      padding: 12px;
    }
  }
</style>
