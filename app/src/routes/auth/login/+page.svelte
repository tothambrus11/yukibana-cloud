<script lang="ts">
  import type { ActionData } from './$types';
  let { form }: { form: ActionData } = $props();
</script>

<h1>Log in</h1>
<p>Yukibana uses your GitHub account. The address GitHub reports as your primary, verified email is what a teacher enrols; make sure it is the one your course knows.</p>
{#if form?.error}<p class="error">{form.error}</p>{/if}
<form method="POST"><button>Continue with GitHub</button></form>
