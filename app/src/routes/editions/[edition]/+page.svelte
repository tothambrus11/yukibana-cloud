<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const when = (d: Date | null): string => (d === null ? '—' : new Date(d).toLocaleString());
</script>

<div class="head">
  <a href="/" class="back">← Your courses</a>
  <h1>{data.edition.code} · {data.edition.title}</h1>
  <p>
    <span class="chip">{data.edition.label}</span>
    {#if data.edition.archived_at}<span class="chip">archived</span>{/if}
  </p>
</div>

{#if form?.error}<p class="error">{form.error}</p>{/if}

<section>
  <h2>Projects</h2>
  {#if data.projects.length === 0}
    <p class="empty">{data.staff ? 'No projects yet.' : 'Nothing is available yet.'}</p>
  {:else}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Project</th><th>Available after</th><th>Deadline</th>
            <th>{data.staff ? 'Releases' : 'Your submissions'}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.projects as p (p.project_id)}
            <tr>
              <td>
                <a href="/editions/{data.edition.edition_id}/projects/{p.project_id}">{p.title}</a>
                <span class="muted">{p.slug}</span>
                <span class="chip">{p.kind}</span>
                {#if !p.ready}<span class="chip">no starter yet</span>{/if}
              </td>
              <td>
                {when(p.available_after)}
                {#if data.staff && p.available_after === null}<span class="chip">draft</span>{/if}
              </td>
              <td>{when(p.deadline)}</td>
              <td>{#if data.staff}{p.releases}{:else}{p.my_submissions}{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

{#if data.owner}
  <section>
    <h2>New project</h2>
    <form method="POST" action="?/createProject" class="stack">
      <label>Slug <input name="slug" pattern="[a-z0-9][a-z0-9-]*" placeholder="warmup" required /></label>
      <label>Title <input name="title" required /></label>
      <label>Kind
        <select name="kind">{#each data.kinds as k (k)}<option value={k}>{k}</option>{/each}</select>
      </label>
      <button>Create project</button>
    </form>
    <p class="note">A project starts as a draft: students see it once you set a date on its page.</p>
  </section>
{/if}

{#if data.staff}
  <section>
    <h2>Roster</h2>
    {#if data.roster.length === 0}
      <p class="empty">Nobody is enrolled yet.</p>
    {:else}
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Address</th><th>Person</th><th>Role</th><th>Status</th>{#if data.owner}<th></th>{/if}
            </tr>
          </thead>
          <tbody>
            {#each data.roster as r (r.email)}
              <tr>
                <td>{r.email}</td>
                <td>{r.full_name ?? ''} {#if r.github_login}<span class="muted">@{r.github_login}</span>{/if}</td>
                <td>
                  {#if data.owner}
                    <form method="POST" action="?/setRole" class="inline">
                      <input type="hidden" name="email" value={r.email} />
                      <select name="role" aria-label="Role of {r.email}" onchange={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}>
                        {#each ['student', 'assistant', 'owner'] as role (role)}<option value={role} selected={role === r.role}>{role}</option>{/each}
                      </select>
                    </form>
                  {:else}<span class="chip">{r.role}</span>{/if}
                </td>
                <td>
                  <span class="chip" class:good={r.linked}>{r.linked ? 'logged in' : 'not yet'}</span>
                  {#if r.source !== 'manual'}<span class="chip">{r.source}</span>{/if}
                </td>
                {#if data.owner}
                  <td>
                    <form method="POST" action="?/unenrol" class="inline">
                      <input type="hidden" name="email" value={r.email} />
                      <button>Remove</button>
                    </form>
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  {#if data.owner}
    <section>
      <h2>Enrol somebody</h2>
      <form method="POST" action="?/enrol" class="stack">
        <label>Address <input name="email" type="email" required placeholder="student@school.example" /></label>
        <label>As
          <select name="role"><option value="student">student</option><option value="assistant">assistant</option><option value="owner">owner</option></select>
        </label>
        <button>Enrol</button>
      </form>
      <p class="note">
        An address that has not logged in yet is linked at that person's first GitHub login, if
        GitHub reports it as their primary verified email.
      </p>
    </section>

    <section>
      <h2>This edition</h2>
      <form method="POST" action="?/duplicate" class="stack">
        <label>Duplicate as <input name="label" placeholder="2027 autumn" required /></label>
        <button>Duplicate</button>
      </form>
      <p class="note">A duplicate carries the projects and the staff, not the students or the dates.</p>
      <form method="POST" action="?/archive">
        <input type="hidden" name="archived" value={data.edition.archived_at ? 'false' : 'true'} />
        <button class="quiet">{data.edition.archived_at ? 'Unarchive' : 'Archive'} this edition</button>
      </form>
    </section>
  {/if}
{/if}
