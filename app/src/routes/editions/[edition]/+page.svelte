<script lang="ts">
  import { page } from '$app/state';
  import Tabs from '#lib/Tabs.svelte';
  import StaffProjects from '#lib/StaffProjects.svelte';
  import StudentProjects from '#lib/StudentProjects.svelte';
  import { actionIn, tabOf, type Tab } from '#lib/tabs.ts';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const tabs = $derived<Tab[]>([
    { id: 'projects', label: 'Projects', count: data.projects.length },
    ...(data.staff ? [{ id: 'roster', label: 'Roster', count: data.roster.length }] : []),
    ...(data.owner ? [{ id: 'settings', label: 'Settings' }] : []),
  ]);
  const tab = $derived(tabOf(page.url, tabs));
</script>

<div class="head">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Courses</a><span>{data.edition.code} {data.edition.label}</span></nav>
  <h1>{data.edition.code} · {data.edition.title}</h1>
  <p>
    <span class="chip">{data.edition.label}</span>
    {#if data.edition.archived_at}<span class="chip">archived</span>{/if}
  </p>
</div>

<Tabs {tabs} current={tab} />

{#if tab === 'projects'}
  {#if !data.staff}
    <section>
      <h2>Projects</h2>
      <StudentProjects rows={data.mine} empty="Nothing is open to you right now." />
    </section>
  {:else}
    <section>
      <h2>Projects</h2>
      <StaffProjects rows={data.projects} editionId={data.edition.edition_id} reorder={data.canEdit} />
    </section>
  {/if}

  {#if data.canEdit}
    <section>
      <h2>New project</h2>
      <form method="POST" action={actionIn('projects', 'createProject')} class="stack">
        <!-- The dash is escaped: browsers compile `pattern` with the v flag, where a bare one is an error and the check is silently dropped. -->
        <label>Slug <input name="slug" pattern="[a-z0-9][a-z0-9\-]*" placeholder="warmup" required /></label>
        <label>Title <input name="title" required /></label>
        <label>Kind
          <select name="kind">{#each data.kinds as k (k)}<option value={k}>{k}</option>{/each}</select>
        </label>
        <button>Create project</button>
      </form>
      <p class="note">A project starts as a draft: students see it once you set its dates on its page.</p>
    </section>
  {/if}
{:else if tab === 'roster'}
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
                    <form method="POST" action={actionIn('roster', 'setRole')} class="inline">
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
                    <form method="POST" action={actionIn('roster', 'unenrol')} class="inline">
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
      <form method="POST" action={actionIn('roster', 'enrol')} class="stack">
        <label>Address <input name="email" type="email" required placeholder="student@school.example" /></label>
        <label>As
          <select name="role"><option value="student">student</option><option value="assistant">assistant</option><option value="owner">owner</option></select>
        </label>
        <button>Enrol</button>
      </form>
      <p class="note">
        An address that has not logged in yet is linked the first time that person proves it: by a
        code mailed to it, or by a GitHub login that reports it as their primary verified email.
      </p>
    </section>
  {/if}
{:else if tab === 'settings'}
  <section>
    <h2>Duplicate</h2>
    <form method="POST" action={actionIn('settings', 'duplicate')} class="stack">
      <label>New edition's label <input name="label" placeholder="2027 autumn" required /></label>
      <button>Duplicate</button>
    </form>
    <p class="note">A duplicate carries the projects and the staff, not the students or the dates.</p>
  </section>

  <section>
    <h2>{data.edition.archived_at ? 'Unarchive' : 'Archive'}</h2>
    <p class="note">
      An archived edition stays readable to everyone in it and moves to the bottom of their lists.
      Archiving can be undone.
    </p>
    <form method="POST" action={actionIn('settings', 'archive')}>
      <input type="hidden" name="archived" value={data.edition.archived_at ? 'false' : 'true'} />
      <button class="quiet">{data.edition.archived_at ? 'Unarchive' : 'Archive'} this edition</button>
    </form>
  </section>
{/if}
