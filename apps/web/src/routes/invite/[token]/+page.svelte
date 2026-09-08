<script lang="ts">
  import { ArrowRight, Check, KeyRound, LogIn, UserPlus } from "@lucide/svelte";

  import Button from "$components/ui/button/button.svelte";

  let { data, form } = $props();
  const returnTo = $derived(data.invitePath);
</script>

<svelte:head><title>Workspace invitation · AlphaPing</title></svelte:head>

<main class="invite">
  <section class="invite__card" aria-labelledby="invite-title">
    <div class="invite__brand"><span>A</span><strong>AlphaPing</strong></div>
    <div class="invite__heading">
      <UserPlus size={20} />
      <div>
        <h1 id="invite-title">Join {data.invitation.workspaceName}</h1>
        <p>{data.invitation.emailHint} · {data.invitation.role}</p>
      </div>
    </div>

    {#if data.invitation.expired}
      <div class="invite__state invite__state--error" role="alert">
        <KeyRound size={16} />
        <div>
          <strong>Invitation expired</strong><span
            >Ask a workspace administrator for a new link.</span
          >
        </div>
      </div>
    {:else if data.authenticated && data.invitation.recipientMatchesAuthenticatedEmail}
      <form method="POST">
        {#if form?.message}<p class="form-error" role="alert">{form.message}</p>{/if}
        <div class="invite__state invite__state--ok">
          <Check size={16} />
          <div><strong>Signed in</strong><span>{data.authenticatedEmail}</span></div>
        </div>
        <Button type="submit">Accept invitation <ArrowRight size={14} /></Button>
      </form>
    {:else if data.authenticated}
      <form method="POST">
        <input type="hidden" name="intent" value="switch-account" />
        <div class="invite__state invite__state--error">
          <KeyRound size={16} />
          <div>
            <strong>Different account signed in</strong>
            <span>{data.authenticatedEmail}</span>
            <span>Sign in with the invited email to continue.</span>
          </div>
        </div>
        <Button type="submit" variant="secondary"><LogIn size={14} /> Switch account</Button>
      </form>
    {:else if data.invitation.existingAccount}
      <div class="invite__state">
        <KeyRound size={16} />
        <div>
          <strong>Account found</strong><span>Sign in with the invited email to continue.</span>
        </div>
      </div>
      <a class="invite__signin" href={`/login?returnTo=${encodeURIComponent(returnTo)}`}
        >Sign in <ArrowRight size={14} /></a
      >
    {:else}
      <form method="POST">
        {#if form?.message}<p class="form-error" role="alert">{form.message}</p>{/if}
        <label
          ><span>Name</span><input
            name="name"
            required
            minlength="2"
            maxlength="80"
            autocomplete="name"
          /></label
        >
        <label
          ><span>Password</span><input
            type="password"
            name="password"
            required
            minlength="12"
            maxlength="128"
            autocomplete="new-password"
          /></label
        >
        <Button type="submit">Create account <ArrowRight size={14} /></Button>
      </form>
    {/if}
  </section>
</main>

<style>
  .invite {
    display: grid;
    min-height: 100dvh;
    place-items: center;
    padding: var(--space-3);
  }

  .invite__card {
    width: min(100%, 400px);
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: var(--shadow-panel);
  }

  .invite__brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .invite__brand span {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border-radius: var(--radius-button);
    color: var(--accent-ink);
    background: var(--accent);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 750;
  }

  .invite__brand strong {
    font-size: var(--text-base);
  }

  .invite__heading {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    margin: var(--space-5) 0;
    padding-bottom: var(--space-5);
    border-bottom: 1px solid var(--border);
  }

  .invite__heading > :global(svg) {
    flex: none;
    margin-top: 2px;
    color: var(--accent);
  }

  h1 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-xl);
    font-weight: 600;
    line-height: var(--leading-xl);
  }

  .invite__heading p,
  .invite__state span {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }

  form {
    display: grid;
    gap: var(--space-4);
  }

  label span,
  .invite__state strong,
  .invite__state span {
    display: block;
  }

  label span {
    margin-bottom: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  input {
    width: 100%;
    height: 36px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text);
    background: var(--surface);
    font: inherit;
  }

  form > :global(button) {
    width: 100%;
    height: 36px;
  }

  .invite__state {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface-subtle);
  }

  .invite__state > :global(svg) {
    flex: none;
    margin-top: 1px;
    color: var(--accent);
  }

  .invite__state strong {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .invite__state span {
    margin-top: var(--space-1);
  }

  .invite__state--ok {
    border-color: color-mix(in srgb, var(--status-healthy) 45%, var(--border));
    background: var(--status-healthy-bg);
  }

  .invite__state--ok > :global(svg) {
    color: var(--status-healthy);
  }

  .invite__state--error {
    border-color: color-mix(in srgb, var(--status-down) 45%, var(--border));
    background: var(--status-down-bg);
  }

  .invite__state--error > :global(svg),
  .invite__state--error strong {
    color: var(--status-down);
  }

  .invite__signin {
    display: flex;
    height: 36px;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin-top: var(--space-4);
    border-radius: var(--radius-button);
    color: var(--accent-ink);
    background: var(--accent);
    font-size: var(--text-base);
    font-weight: 600;
    text-decoration: none;
    transition: background-color 140ms ease;
  }

  .invite__signin:hover {
    background: var(--accent-hover);
  }

  .form-error {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-button);
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }
</style>
