<script lang="ts">
  import { page } from '$app/state';
  import { deserialize } from '$app/forms';
  import { tick } from 'svelte';
  import Tabs from '#lib/Tabs.svelte';
  import StudentProjects from '#lib/StudentProjects.svelte';
  import { move } from '#lib/order.ts';
  import { when } from '#lib/format.ts';
  import { actionIn, tabOf, type Tab } from '#lib/tabs.ts';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const tabs = $derived<Tab[]>([
    { id: 'projects', label: 'Projects', count: data.projects.length },
    ...(data.staff ? [{ id: 'roster', label: 'Roster', count: data.roster.length }] : []),
    ...(data.owner ? [{ id: 'settings', label: 'Settings' }] : []),
  ]);
  const tab = $derived(tabOf(page.url, tabs));
  const now = Date.now();
  const past = (d: Date | null): boolean => d !== null && new Date(d).getTime() <= now;

  // Staff see the projects in their order, and rearrange it by
  // dragging a row (or a row's handle with the arrow keys). Each drop is
  // saved at once through the `move` action: the list changes on screen
  // first, and goes back with the reason if the server refuses. Moves are
  // sent one after another, in the order they were made, because each is
  // placed between neighbours as the server has them.
  const byId = $derived(new Map(data.projects.map((p) => [p.project_id, p] as const)));
  let order = $derived(data.projects.map((p) => p.project_id));
  let dragging = $state<number | null>(null);
  let over = $state<number | null>(null);
  let saveNote = $state('');
  let saveError = $state('');
  let queue: Promise<void> = Promise.resolve();

  function commit(from: number, to: number): void {
    const moved = move(order, from, to);
    if (moved === null) return;
    const previous = order;
    const id = moved.items[to] ?? '';
    order = moved.items;
    saveError = '';
    saveNote = 'Saving the new order…';
    queue = queue.then(async () => {
      const body = new FormData();
      body.set('project', id);
      body.set('after', moved.after ?? '');
      body.set('before', moved.before ?? '');
      try {
        const res = await fetch('?tab=projects&/move', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
        const result = deserialize(await res.text());
        if (result.type !== 'success') {
          const why = result.type === 'failure' && typeof result.data?.['error'] === 'string' ? result.data['error'] : 'the server refused it';
          throw new Error(why);
        }
        saveNote = 'Order saved.';
      } catch (e) {
        order = previous;
        saveNote = '';
        saveError = `The order was not saved: ${e instanceof Error ? e.message : String(e)}`;
      }
    });
  }

  async function keyMove(e: KeyboardEvent, i: number): Promise<void> {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : null;
    if (to === null) return;
    e.preventDefault();
    const id = order[i];
    commit(i, to);
    await tick();
    document.querySelector<HTMLButtonElement>(`[data-handle="${id}"]`)?.focus();
  }
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
{#if form?.error}<p class="error">{form.error}</p>{/if}

{#if tab === 'projects'}
  {#if !data.staff}
    <section>
      <h2>Projects</h2>
      <StudentProjects rows={data.mine} empty="Nothing is open to you right now." />
    </section>
  {:else}
  <section>
    <h2>Projects</h2>
    {#if order.length === 0}
      <p class="empty">No projects yet.</p>
    {:else}
      {#if data.staff}<p class="note">Drag a project to change the order students see. Changes are saved as you drop.</p>{/if}
      <div class="scroll">
        <table class="projects">
          <thead>
            <tr>
              {#if data.staff}<th><span class="sr-only">Order</span></th>{/if}
              <th>Project</th><th>Opens</th><th>Deadline</th><th>Closes</th><th>Releases</th>
            </tr>
          </thead>
          <tbody>
            {#each order as id, i (id)}
              {@const p = byId.get(id)}
              {#if p}
                <tr
                  draggable={data.staff}
                  class:dragging={dragging === i}
                  class:over={over === i && dragging !== null && dragging !== i}
                  ondragstart={(e) => { dragging = i; e.dataTransfer?.setData('text/plain', id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}
                  ondragover={(e) => { if (dragging !== null) { e.preventDefault(); over = i; } }}
                  ondrop={(e) => { e.preventDefault(); if (dragging !== null) commit(dragging, i); dragging = null; over = null; }}
                  ondragend={() => { dragging = null; over = null; }}
                >
                  {#if data.staff}
                    <td class="grip">
                      <button type="button" class="handle" data-handle={id} aria-label="Move {p.title}: drag, or use the up and down arrow keys" title="Drag to reorder" onkeydown={(e) => keyMove(e, i)}>⠿</button>
                    </td>
                  {/if}
                  <td>
                    <a href="/editions/{data.edition.edition_id}/projects/{p.project_id}">{p.title}</a>
                    <span class="chip">{p.kind}</span>
                    {#if p.available_after === null}<span class="chip">draft</span>{/if}
                    {#if !p.ready}<span class="chip">no starter yet</span>{/if}
                  </td>
                  <td>{when(p.available_after)}</td>
                  <td>{when(p.deadline)}{#if past(p.deadline) && !past(p.closes_at)} <span class="chip late">late window</span>{/if}</td>
                  <td>{p.closes_at === null ? 'never' : when(p.closes_at)}</td>
                  <td>{p.releases}</td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
      <p class="note" aria-live="polite">{saveNote}</p>
      {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
    {/if}
  </section>
  {/if}

  {#if data.staff}
    <section>
      <h2>New project</h2>
      <form method="POST" action={actionIn('projects', 'createProject')} class="stack">
        <label>Slug <input name="slug" pattern="[a-z0-9][a-z0-9-]*" placeholder="warmup" required /></label>
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
        An address that has not logged in yet is linked at that person's first GitHub login, if
        GitHub reports it as their primary verified email.
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
