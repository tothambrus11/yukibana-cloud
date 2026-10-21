<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const account = $derived(data.account);
  const who = $derived(account.name ?? (account.login === null ? null : `@${account.login}`) ?? account.email ?? 'this account');
</script>

<section class="login">
  <img class="mark" src="/logo-64.png" alt="" width="48" height="48" />
  <h1>Log in your IDE</h1>
  <p class="muted">
    If you just ran <code>yukibana login</code> or clicked “Log in” in the Yukibana IDE, check that it shows
    <strong>{data.code}</strong>. If you did not, cancel.
  </p>

  <p>
    You are signed in here as <strong>{who}</strong>{#if account.email !== null && who !== account.email}
      &nbsp;<span class="muted">({account.email})</span>{/if}.
  </p>

  <form method="POST" class="stack">
    <input type="hidden" name="redirect_uri" value={data.request.redirect_uri} />
    <input type="hidden" name="code_challenge" value={data.request.code_challenge} />
    <input type="hidden" name="state" value={data.request.state} />
    <button formaction="?/continue">Continue as {who}</button>
    <button class="quiet" formaction="?/switch">Use a different account</button>
    <button class="quiet" formaction="?/cancel">Cancel</button>
  </form>

  <p class="note">
    The IDE gets a session of its own: logging out there does not log you out here, and the other way round.
    To use a different GitHub account, sign out of github.com first, or log in with an emailed code.
  </p>
</section>
