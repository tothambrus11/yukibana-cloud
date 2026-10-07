<script lang="ts">
  import { page } from '$app/state';
  import Tabs from '$lib/Tabs.svelte';
  import { actionIn, tabOf, type Tab } from '$lib/tabs';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const staff = $derived(data.platformRole === 'teacher' || data.platformRole === 'admin');
  const active = $derived(data.editions.filter((e) => e.archived_at === null));
  const archived = $derived(data.editions.filter((e) => e.archived_at !== null));
  const tabs = $derived<Tab[]>([
    { id: 'active', label: 'Active', count: active.length },
    ...(archived.length > 0 ? [{ id: 'archived', label: 'Archived', count: archived.length }] : []),
    ...(staff ? [{ id: 'create', label: 'Create' }] : []),
  ]);
  const tab = $derived(tabOf(page.url, tabs));
  const shown = $derived(tab === 'archived' ? archived : active);
</script>

<div class="head">
  <h1>Your courses</h1>
  <p>
    Course projects, and the work students submit for them.
    {#if data.platformRole === 'admin'}<a href="/admin">Administration</a>{/if}
  </p>
</div>

{#if data.user === null}
  <section>
    <h2>Welcome</h2>
    <p>
      Yukibana holds course projects and the work students submit for them. A teacher publishes a
      starter archive; students download it, solve it in their own editor, and submit as many
      versions as they like.
    </p>
    <p><a href="/auth/login">Log in with GitHub</a> to see yours.</p>
  </section>
{:else}
  <Tabs {tabs} current={tab} />
  {#if form?.error}<p class="error">{form.error}</p>{/if}

  {#if tab === 'create'}
    {#if data.courses.length > 0}
      <section>
        <h2>New edition</h2>
        <form method="POST" action={actionIn('create', 'createEdition')} class="stack">
          <label>Course
            <select name="course_id">
              {#each data.courses as c (c.course_id)}<option value={c.course_id}>{c.code} · {c.title}</option>{/each}
            </select>
          </label>
          <label>Label <input name="label" placeholder="2026 autumn" required /></label>
          <button>Create edition</button>
        </form>
        <p class="note">To reuse last year's projects and staff, open that edition and duplicate it instead.</p>
      </section>
    {/if}
    <section>
      <h2>New course</h2>
      <form method="POST" action={actionIn('create', 'createCourse')} class="stack">
        <label>Code <input name="code" placeholder="CS-101" required /></label>
        <label>Title <input name="title" placeholder="Introduction to Programming" required /></label>
        <button>Create course</button>
      </form>
      <p class="note">A course groups its editions; the work lives in an edition.</p>
    </section>
  {:else}
    <section>
      <h2>{tab === 'archived' ? 'Archived editions' : 'Editions you are in'}</h2>
      {#if shown.length === 0}
        <p class="empty">
          Nothing yet. Enrolment is by address: once a teacher enrols the address you logged in with,
          the edition appears here.
        </p>
      {:else}
        <div class="scroll">
          <table>
            <thead><tr><th>Course</th><th>Edition</th><th>You are</th></tr></thead>
            <tbody>
              {#each shown as e (e.edition_id)}
                <tr>
                  <td>{e.code} · {e.title}</td>
                  <td><a href="/editions/{e.edition_id}">{e.label}</a></td>
                  <td><span class="chip">{e.role}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/if}
{/if}
