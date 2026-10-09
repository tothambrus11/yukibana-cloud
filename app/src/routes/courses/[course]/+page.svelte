<script lang="ts">
  import { page } from '$app/state';
  import Tabs from '#lib/Tabs.svelte';
  import DeleteForm from '#lib/DeleteForm.svelte';
  import { actionIn, tabOf, type Tab } from '#lib/tabs.ts';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const c = $derived(data.course);
  const owned = $derived(data.editions.filter((e) => e.role === 'owner'));
  const live = $derived(data.editions.filter((e) => e.archived_at === null));
  const archived = $derived(data.editions.filter((e) => e.archived_at !== null));
  const tabs = $derived<Tab[]>([
    { id: 'editions', label: 'Editions', count: live.length },
    ...(archived.length > 0 ? [{ id: 'archived', label: 'Archived', count: archived.length }] : []),
    ...(c.teacher ? [{ id: 'new', label: 'New edition' }, { id: 'settings', label: 'Settings' }] : []),
  ]);
  const tab = $derived(tabOf(page.url, tabs));
  const shown = $derived(tab === 'archived' ? archived : live);
  // Copying the newest edition one owns is what a new year usually is.
  const suggested = $derived(owned.find((e) => e.archived_at === null) ?? owned[0]);
  const staffOf = (role: string | null): boolean => role === 'owner' || role === 'assistant';
  const blocked = $derived(
    !c.may_delete
      ? data.editions.length > 0
        ? 'Only a teacher who owns every edition of this course may delete it. Delete the editions you own one by one, or ask the owners of the others.'
        : 'Only the teacher who made this course, or an admin, may delete it.'
      : data.submissions > 0
        ? `Students have handed in ${data.submissions} ${data.submissions === 1 ? 'submission' : 'submissions'} here, and submissions are kept. Archive the editions instead.`
        : null,
  );
</script>

<div class="head">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Courses</a><span>{c.code}</span></nav>
  <h1>{c.code} · {c.title}</h1>
  <p>{data.editions.length} {data.editions.length === 1 ? 'edition' : 'editions'}</p>
</div>

<Tabs {tabs} current={tab} />

{#if tab === 'new'}
  <section>
    <h2>New edition</h2>
    <form method="POST" action={actionIn('new', 'createEdition')} class="stack">
      <label>Label <input name="label" placeholder="2026 autumn" required /></label>
      <label>Start from
        <select name="from">
          <option value="" selected={suggested === undefined}>Nothing: an empty edition</option>
          {#each owned as e (e.edition_id)}
            <option value={e.edition_id} selected={e === suggested}>A copy of {e.label}</option>
          {/each}
        </select>
      </label>
      <button>Create edition</button>
    </form>
    <p class="note">
      A copy carries the projects and the staff of the edition it is made from, not the students,
      the releases or the dates. You become an owner of the new edition either way.
    </p>
  </section>
{:else if tab === 'settings'}
  <DeleteForm
    action={actionIn('settings', 'delete')}
    what="course"
    name={c.code}
    consequences="Deletes the course, every edition of it, their rosters, projects, releases and tokens. It cannot be undone."
    {blocked}
  />
{:else}
  <section>
    <h2>{tab === 'archived' ? 'Archived editions' : 'Editions'}</h2>
    {#if shown.length === 0}
      <p class="empty">
        {#if tab === 'archived'}Nothing archived.
        {:else if c.teacher}No running edition. <a href="?tab=new">Make one</a>.
        {:else}Nothing running.{/if}
      </p>
    {:else}
      <div class="scroll">
        <table>
          <thead><tr><th>Edition</th><th>You are</th><th>Projects</th><th>Students</th></tr></thead>
          <tbody>
            {#each shown as e (e.edition_id)}
              <tr>
                {#if e.role === null}
                  <td>{e.label}</td>
                  <td colspan="3" class="muted small">
                    Not in this edition{#if e.owners.length > 0}; ask {e.owners.join(', ')} to add you{/if}.
                  </td>
                {:else}
                  <td><a href="/editions/{e.edition_id}">{e.label}</a></td>
                  <td><span class="chip" class:live={e.role === 'owner'}>{e.role}</span></td>
                  <td>{staffOf(e.role) ? e.projects : ''}</td>
                  <td>{staffOf(e.role) ? e.students : ''}</td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{/if}
