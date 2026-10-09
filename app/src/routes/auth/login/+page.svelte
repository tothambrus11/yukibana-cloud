<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const sent = $derived(form !== null && 'sent' in form ? form.sent : null);
  const next = $derived(form?.next ?? data.next);
</script>

<div class="head">
  <h1>Log in</h1>
</div>

<section>
  <h2>Continue with GitHub</h2>
  <p>
    The address GitHub reports as your primary, verified email is what a teacher enrols, so make sure
    it is the one your course knows.
  </p>
  <form method="POST" action="?/github">
    <input type="hidden" name="next" value={next} />
    <button>Continue with GitHub</button>
  </form>
</section>

<section>
  <h2>Or with a code by email</h2>
  {#if sent === null}
    <p>Use the address your course enrolled. We mail you a code; no password.</p>
    <form method="POST" action="?/send" class="stack">
      <input type="hidden" name="next" value={next} />
      <label>Address <input name="email" type="email" required autocomplete="email" /></label>
      <button>Send me a code</button>
    </form>
  {:else}
    <p>We sent a code to <strong>{sent}</strong>. It works once, for an hour.</p>
    <form method="POST" action="?/verify" class="stack">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="email" value={sent} />
      <label>Code <input name="code" required inputmode="numeric" autocomplete="one-time-code" /></label>
      <button>Log in</button>
    </form>
    <form method="POST" action="?/send">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="email" value={sent} />
      <button class="quiet">Send another code</button>
    </form>
  {/if}
</section>
