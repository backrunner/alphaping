<script lang="ts">
  import { Activity } from "@lucide/svelte";

  import Button from "$components/ui/button/button.svelte";

  let { data, form } = $props();
</script>

<svelte:head><title>Sign in · AlphaPing</title></svelte:head>

<main class="login">
  <section class="login__card">
    <div class="login__brand"><Activity size={18} /><strong>AlphaPing</strong></div>
    <h1>Sign in</h1>
    <form method="POST">
      <input type="hidden" name="returnTo" value={data.returnTo} />
      {#if form?.message}<p class="login__error" role="alert">{form.message}</p>{/if}
      <label
        ><span>Email</span><input
          type="email"
          name="email"
          maxlength="254"
          autocomplete="email"
          required
        /></label
      >
      <label
        ><span>Password</span><input
          type="password"
          name="password"
          maxlength="128"
          autocomplete="current-password"
          required
        /></label
      >
      <Button type="submit">Sign in</Button>
    </form>
  </section>
</main>

<style>
  .login {
    display: grid;
    min-height: 100dvh;
    place-items: center;
    padding: 24px;
    background: var(--bg);
  }

  .login__card {
    width: min(100%, 420px);
    padding: 32px;
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    background: var(--surface);
    box-shadow: var(--shadow-panel);
  }

  .login__brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--accent);
  }

  .login__brand strong {
    font-size: var(--text-base);
  }

  h1 {
    margin: 28px 0 24px;
    font-size: var(--text-xl);
    font-weight: 600;
    line-height: var(--leading-xl);
  }

  form {
    display: grid;
    gap: var(--space-4);
  }

  label span {
    display: block;
    margin-bottom: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  input {
    width: 100%;
    height: 44px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text);
    background: var(--surface);
    font: inherit;
  }

  form > :global(button) {
    width: 100%;
    height: 44px;
  }

  .login__error {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-button);
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }
</style>
