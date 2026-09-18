<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const when = (d: Date | null): string => (d === null ? '—' : new Date(d).toLocaleString());
</script>

<p><a href="/">← Your courses</a></p>
<h1>{data.edition.code} · {data.edition.title} <span class="muted">{data.edition.label}</span></h1>
{#if data.edition.archived_at}<p class="muted">This edition is archived.</p>{/if}
{#if form?.error}<p class="error">{form.error}</p>{/if}

<h2>Projects</h2>
{#if data.projects.length === 0}
  <p class="muted">{data.staff ? 'No projects yet.' : 'Nothing is available yet.'}</p>
{:else}
  <table>
    <thead><tr><th>Project</th><th>Available after</th><th>Deadline</th><th>{data.staff ? 'Releases' : 'Your submissions'}</th></tr></thead>
    <tbody>
      {#each data.projects as p (p.project_id)}
        <tr>
          <td><a href="/editions/{data.edition.edition_id}/projects/{p.project_id}">{p.title}</a> <span class="muted">{p.slug} · {p.kind}</span>
            {#if !p.ready}<span class="muted"> · no starter yet</span>{/if}</td>
          <td>{when(p.available_after)}{#if data.staff && p.available_after === null}<span class="muted"> (draft)</span>{/if}</td>
          <td>{when(p.deadline)}</td>
          <td>{#if data.staff}{p.releases}{:else}{p.my_submissions}{/if}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

{#if data.owner}
  <h2>New project</h2>
  <form method="POST" action="?/createProject" class="stack">
    <label>Slug <input name="slug" pattern="[a-z0-9][a-z0-9-]*" placeholder="warmup" required /></label>
    <label>Title <input name="title" required /></label>
    <label>Kind
      <select name="kind">{#each data.kinds as k (k)}<option value={k}>{k}</option>{/each}</select>
    </label>
    <button>Create project</button>
  </form>
  <p class="muted">A project starts as a draft: students see it once you set a date on its page.</p>
{/if}

{#if data.staff}
  <h2>Roster</h2>
  <table>
    <thead><tr><th>Address</th><th>Person</th><th>Role</th><th>Status</th>{#if data.owner}<th></th>{/if}</tr></thead>
    <tbody>
      {#each data.roster as r (r.email)}
        <tr>
          <td>{r.email}</td>
          <td>{r.full_name ?? ''} {#if r.github_login}<span class="muted">@{r.github_login}</span>{/if}</td>
          <td>
            {#if data.owner}
              <form method="POST" action="?/setRole" class="inline">
                <input type="hidden" name="email" value={r.email} />
                <select name="role" onchange={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}>
                  {#each ['student', 'assistant', 'owner'] as role (role)}<option value={role} selected={role === r.role}>{role}</option>{/each}
                </select>
              </form>
            {:else}{r.role}{/if}
          </td>
          <td class={r.linked ? 'ok' : 'muted'}>{r.linked ? 'logged in' : 'not yet logged in'}{#if r.source !== 'manual'} · {r.source}{/if}</td>
          {#if data.owner}
            <td><form method="POST" action="?/unenrol" class="inline"><input type="hidden" name="email" value={r.email} /><button>Remove</button></form></td>
          {/if}
        </tr>
      {/each}
    </tbody>
  </table>
  {#if data.owner}
    <form method="POST" action="?/enrol" class="stack">
      <label>Enrol by address <input name="email" type="email" required placeholder="student@school.example" /></label>
      <label>As
        <select name="role"><option value="student">student</option><option value="assistant">assistant</option><option value="owner">owner</option></select>
      </label>
      <button>Enrol</button>
    </form>
    <p class="muted">An address that has not logged in yet is linked at that person's first GitHub login, if GitHub reports it as their primary verified email.</p>

    <h2>This edition</h2>
    <form method="POST" action="?/duplicate" class="stack">
      <label>Duplicate as <input name="label" placeholder="2027 autumn" required /></label>
      <button>Duplicate (projects and staff, not students or dates)</button>
    </form>
    <form method="POST" action="?/archive" class="inline">
      <input type="hidden" name="archived" value={data.edition.archived_at ? 'false' : 'true'} />
      <button>{data.edition.archived_at ? 'Unarchive' : 'Archive'}</button>
    </form>
  {/if}
{/if}
