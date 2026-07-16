<script lang="ts">
  import { ArrowRight, Check, KeyRound, UserPlus } from "lucide-svelte";

  import Button from "$components/ui/button/button.svelte";

  let { data, form } = $props();
  const returnTo = $derived(data.invitePath);
</script>

<svelte:head><title>Workspace invitation · AlphaPing</title></svelte:head>

<main class="invite">
  <section aria-labelledby="invite-title">
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
    {:else if data.authenticated}
      <form method="POST">
        {#if form?.message}<p class="form-error" role="alert">{form.message}</p>{/if}
        <div class="invite__state">
          <Check size={16} />
          <div><strong>Signed in</strong><span>{data.authenticatedEmail}</span></div>
        </div>
        <Button type="submit">Accept invitation <ArrowRight size={14} /></Button>
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
    padding: 20px;
  }

  .invite > section {
    width: min(100%, 420px);
  }

  .invite__brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .invite__brand span {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border-radius: 5px;
    color: white;
    background: var(--accent);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .invite__heading {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 28px 0 18px;
    padding-bottom: 18px;
    border-bottom: 1px solid var(--border);
  }

  .invite__heading > :global(svg) {
    margin-top: 2px;
    color: var(--accent);
  }

  h1 {
    margin: 0 0 4px;
    font-size: 22px;
  }

  .invite__heading p,
  .invite__state span {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  form {
    display: grid;
    gap: 14px;
  }

  label span,
  .invite__state strong,
  .invite__state span {
    display: block;
  }

  label span {
    margin-bottom: 6px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 650;
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

  .invite__state {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }

  .invite__state--error {
    border-color: color-mix(in srgb, var(--status-down) 45%, var(--border));
    color: var(--status-down);
    background: var(--status-down-bg);
  }

  .invite__state span {
    margin-top: 2px;
  }

  .invite__signin {
    display: inline-flex;
    height: 32px;
    align-items: center;
    gap: 6px;
    margin-top: 14px;
    color: var(--accent);
    font-size: 12px;
    font-weight: 650;
    text-decoration: none;
  }

  .form-error {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: 11px;
  }
</style>
