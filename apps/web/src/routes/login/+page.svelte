<script lang="ts">
  import { Activity } from "lucide-svelte";

  import Button from "$components/ui/button/button.svelte";

  let { data, form } = $props();
</script>

<svelte:head><title>Sign in · AlphaPing</title></svelte:head>

<main class="login">
  <section>
    <div class="login__brand"><Activity size={18} /><strong>AlphaPing</strong></div>
    <h1>Sign in to your monitors</h1>
    <p>Use the account created during deployment setup.</p>
    <form method="POST">
      <input type="hidden" name="returnTo" value={data.returnTo} />
      {#if form?.message}<p class="login__error" role="alert">{form.message}</p>{/if}
      <label
        ><span>Email</span><input type="email" name="email" autocomplete="email" required /></label
      >
      <label
        ><span>Password</span><input
          type="password"
          name="password"
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
    padding: 20px;
  }

  .login section {
    width: min(100%, 360px);
  }

  .login__brand {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--accent);
  }

  h1 {
    margin: 22px 0 7px;
    font-size: 24px;
  }

  section > p {
    margin: 0 0 22px;
    color: var(--text-muted);
  }

  form {
    display: grid;
    gap: 14px;
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }

  label span {
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
    background: var(--bg);
    font: inherit;
  }

  input:focus {
    border-color: var(--accent);
    outline: 2px solid var(--focus-ring);
  }

  .login__error {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: 12px;
  }
</style>
