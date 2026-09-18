<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<h1>Connect a repository to {data.slug}</h1>
{#if form?.error}<p class="error">{form.error}</p>{/if}
{#if data.repos.length === 0}
  <p>The app is installed, but on no repository. Add one in GitHub's installation settings, then come back through the project page.</p>
{:else}
  <form method="POST" action="?/choose" class="stack">
    <input type="hidden" name="project" value={data.project} />
    <input type="hidden" name="installation_id" value={data.installationId} />
    {#each data.repos as r (r.id)}
      <label>
        <input type="radio" name="repo_id" value={r.id} required
          onchange={(e) => { const f = e.currentTarget.form; if (f) { (f.elements.namedItem('full_name') as HTMLInputElement).value = r.fullName; (f.elements.namedItem('ref') as HTMLInputElement).value = r.defaultBranch; } }} />
        {r.fullName} <span class="muted">({r.defaultBranch})</span>
      </label>
    {/each}
    <input type="hidden" name="full_name" value="" />
    <input type="hidden" name="ref" value="main" />
    <button>Use this repository</button>
  </form>
  <p class="muted">The first starter is built as soon as you choose; every later push to the branch builds again.</p>
{/if}
