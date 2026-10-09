<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const sent = $derived(form !== null && 'sent' in form ? form.sent : null);
  const next = $derived(form?.next ?? data.next);
  // Back to the first step, keeping where the person was going.
  const restart = $derived(next === '/' ? '/auth/login' : `/auth/login?next=${encodeURIComponent(next)}`);
</script>

<section class="login">
  <img class="mark" src="/logo-64.png" alt="" width="48" height="48" />

  {#if sent === null}
    <h1>Log in to Yukibana</h1>
    <p class="muted">Use the address your course enrolled you with.</p>

    <form method="POST" action="?/github">
      <input type="hidden" name="next" value={next} />
      <button class="github">
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        Continue with GitHub
      </button>
    </form>

    <p class="or"><span>or</span></p>

    <form method="POST" action="?/send" class="stack">
      <input type="hidden" name="next" value={next} />
      <label>Email address
        <input name="email" type="email" required autocomplete="email" placeholder="you@school.example" />
      </label>
      <button>Email me a code</button>
    </form>

    <p class="note">
      With GitHub, the address that counts is the one GitHub reports as your primary, verified email.
    </p>
  {:else}
    <h1>Check your email</h1>
    <p class="muted">We sent a six-digit code to <strong>{sent}</strong>. It works once, within an hour.</p>

    <form method="POST" action="?/verify" class="stack">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="email" value={sent} />
      <label>Code
        <!-- svelte-ignore a11y_autofocus: the one thing this step asks for -->
        <input class="code" name="code" required inputmode="numeric" autocomplete="one-time-code" maxlength="12" autofocus />
      </label>
      <button>Log in</button>
    </form>

    <div class="again">
      <form method="POST" action="?/send">
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="email" value={sent} />
        <button class="quiet">Send another code</button>
      </form>
      <a href={restart}>Use a different address</a>
    </div>
  {/if}
</section>
