<script lang="ts">
  import '../app.css';
  import type { LayoutData } from './$types';
  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<header class="bar">
  <a href="/" class="brand">Yukibana</a>
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
