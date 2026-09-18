<script lang="ts">
  import type { LayoutData } from './$types';
  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<header>
  <a href="/" class="brand">Yukibana</a>
  <nav>
    {#if data.user}
      <span class="muted">{data.user.email ?? 'signed in'}</span>
      <form method="POST" action="/auth/logout"><button>Log out</button></form>
    {:else}
      <a href="/auth/login">Log in</a>
    {/if}
  </nav>
</header>
<main>
  {@render children()}
</main>

<style>
  :global(body) { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #1a1a1a; background: #fafafa; }
  :global(main) { max-width: 60rem; margin: 0 auto; padding: 1rem; }
  :global(h1) { font-size: 1.5rem; }
  :global(h2) { font-size: 1.15rem; margin-top: 2rem; }
  :global(table) { border-collapse: collapse; width: 100%; }
  :global(th), :global(td) { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
  :global(form.inline) { display: inline; }
  :global(form.stack) { display: grid; gap: .5rem; max-width: 28rem; margin: .5rem 0 1rem; }
  :global(form.stack label) { display: grid; gap: .15rem; }
  :global(input), :global(select), :global(button) { font: inherit; padding: .3rem .5rem; }
  :global(button) { cursor: pointer; }
  :global(.muted) { color: #666; }
  :global(.error) { color: #a40000; }
  :global(.ok) { color: #1a7f37; }
  :global(pre) { background: #f0f0f0; padding: .5rem; overflow: auto; font-size: .85rem; }
  header { display: flex; justify-content: space-between; align-items: center; padding: .75rem 1rem; border-bottom: 1px solid #e5e5e5; background: white; }
  nav { display: flex; gap: 1rem; align-items: center; }
  .brand { font-weight: 600; text-decoration: none; color: inherit; }
</style>
