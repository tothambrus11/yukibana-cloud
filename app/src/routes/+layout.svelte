<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import Toasts from '#lib/Toasts.svelte';
  import { listen } from '#lib/live.svelte.ts';
  import { toast } from '#lib/toast.svelte.ts';
  import type { LayoutData } from './$types';
  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
  // Every page is live: the layout listens to what the person's enrolments
  // let them hear, and follows them as those change.
  $effect(() => {
    void listen(data.live);
  });
  // A form action that refused says why in `form.error`, on every page
  // alike; it is shown here, once, rather than by each page.
  $effect(() => {
    const why: unknown = (page.form as { error?: unknown } | null)?.error;
    if (typeof why === 'string') toast(why);
  });
</script>

<header class="bar">
  <a href="/" class="brand"><img src="/logo-64.png" alt="" width="28" height="28" />Yukibana</a>
  <nav>
    {#if data.user}
      <span class="muted">{data.user.email ?? 'signed in'}</span>
      <form method="POST" action="/auth/logout"><button class="quiet">Log out</button></form>
    {:else}
      <a href="/auth/login">Log in</a>
    {/if}
  </nav>
</header>
<main>
  {@render children()}
</main>
<Toasts />
