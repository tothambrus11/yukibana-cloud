<script lang="ts">
  import type { ActionData } from './$types';
  let { form }: { form: ActionData } = $props();
</script>

<div class="head">
  <h1>Log in</h1>
</div>

{#if form?.error}<p class="error">{form.error}</p>{/if}

<section>
  <h2>Continue with GitHub</h2>
  <p>
    Yukibana uses your GitHub account. The address GitHub reports as your primary, verified email is
    what a teacher enrols, so make sure it is the one your course knows.
  </p>
  <form method="POST"><button>Continue with GitHub</button></form>
</section>
