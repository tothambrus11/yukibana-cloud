<script lang="ts">
  import '../app.css';
  import { listen } from '#lib/live.svelte.ts';
  import type { LayoutData } from './$types';
  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
  // Every page is live: the layout listens to what the person's enrolments
  // let them hear, and follows them as those change.
  $effect(() => {
    void listen(data.live);
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
