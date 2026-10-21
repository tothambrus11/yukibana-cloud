<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const account = $derived(data.account);
  const who = $derived(account.name ?? (account.login === null ? null : `@${account.login}`) ?? account.email ?? 'this account');
</script>

<section class="login">
  <img class="mark" src="/logo-64.png" alt="" width="48" height="48" />
  <h1>Log in your IDE</h1>
  <p class="muted">The Yukibana IDE or the <code>yukibana</code> command on this computer asks to log in to Yukibana Cloud.</p>

  <p>
    You are signed in here as <strong>{who}</strong>{#if account.email !== null && who !== account.email}
      &nbsp;<span class="muted">({account.email})</span>{/if}.
  </p>

  <form method="POST" action="?/continue">
    <input type="hidden" name="redirect_uri" value={data.request.redirect_uri} />
    <input type="hidden" name="code_challenge" value={data.request.code_challenge} />
    <input type="hidden" name="state" value={data.request.state} />
    <button>Continue as {who}</button>
  </form>

  <form method="POST" action="?/switch">
    <input type="hidden" name="redirect_uri" value={data.request.redirect_uri} />
    <input type="hidden" name="code_challenge" value={data.request.code_challenge} />
    <input type="hidden" name="state" value={data.request.state} />
    <button class="quiet">Use a different account</button>
  </form>

  <form method="POST" action="?/cancel">
    <input type="hidden" name="redirect_uri" value={data.request.redirect_uri} />
    <input type="hidden" name="code_challenge" value={data.request.code_challenge} />
    <input type="hidden" name="state" value={data.request.state} />
    <button class="quiet">Cancel</button>
  </form>

  <p class="note">
    The IDE gets a session of its own: logging out there does not log you out here, and the other way round.
    If you did not start a login from your IDE or terminal just now, cancel.
    To use a different GitHub account, sign out of github.com first, or log in with an emailed code.
  </p>
</section>
