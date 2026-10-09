<script lang="ts">
  import { page } from '$app/state';
  import Tabs from '#lib/Tabs.svelte';
  import EditionList from '#lib/EditionList.svelte';
  import StudentProjects from '#lib/StudentProjects.svelte';
  import { byUrgency, outstanding, progressOf } from '#lib/progress.ts';
  import { actionIn, tabOf, type Tab } from '#lib/tabs.ts';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  // A student's work across every edition: what is still to hand in, most
  // urgent first, and what is already in.
  const now = $derived.by(() => {
    void data.tasks;
    return new Date();
  });
  const isStudent = $derived(data.editions.some((e) => e.role === 'student'));
  const todo = $derived(data.tasks
    .filter((t) => outstanding(progressOf(t, now)))
    .toSorted(byUrgency));
  const done = $derived(data.tasks.filter((t) => t.last_submitted_at !== null));

  // Somebody who is not a teacher sees their editions as one list: they are
  // in a handful, and the course is a column, not a heading.
  const mine = $derived(data.editions.filter((e) => e.role !== null));
  const active = $derived(mine.filter((e) => e.archived_at === null));
  const archived = $derived(mine.filter((e) => e.archived_at !== null));

  // A teacher sees courses, each with every edition of it. "Yours" is a
  // course they are in an edition of, or made; "All" is the catalogue.
  const courses = $derived(data.courses.map((c) => ({
    ...c,
    editions: data.editions.filter((e) => e.course_id === c.course_id),
  })));
  const yours = $derived(courses.filter((c) => c.mine || c.editions.some((e) => e.role !== null)));

  const tabs = $derived<Tab[]>([
    ...(isStudent ? [{ id: 'todo', label: 'To do', count: todo.length }] : []),
    ...(data.teacher
      ? [
          { id: 'courses', label: 'Your courses', count: yours.length },
          { id: 'all', label: 'All courses', count: courses.length },
          { id: 'create', label: 'New course' },
        ]
      : [
          { id: 'active', label: 'Editions', count: active.length },
          ...(archived.length > 0 ? [{ id: 'archived', label: 'Archived', count: archived.length }] : []),
        ]),
  ]);
  const tab = $derived(tabOf(page.url, tabs));
  const shown = $derived(tab === 'archived' ? archived : active);
</script>

<div class="head">
  <h1>{data.teacher ? 'Courses' : 'Your courses'}</h1>
  <p>
    Course projects, and the work students submit for them.
    {#if data.platformRole === 'admin'}<a href="/admin">Administration</a>{/if}
  </p>
</div>

{#snippet courseCards(list: typeof courses, empty: string)}
  {#if list.length === 0}
    <section><p class="empty">{empty}</p></section>
  {:else}
    <div class="courses">
      {#each list as c (c.course_id)}
        <section class="course">
          <h2>
            <a href="/courses/{c.course_id}">{c.code} · {c.title}</a>
            <a class="button quiet" href="/courses/{c.course_id}?tab=new">New edition</a>
          </h2>
          <EditionList rows={c.editions} empty="No editions yet." />
        </section>
      {/each}
    </div>
  {/if}
{/snippet}

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

  {#if tab === 'todo'}
    <section>
      <h2>Still to hand in</h2>
      <StudentProjects rows={todo} showCourse empty="Nothing outstanding. Projects appear here once they open." />
    </section>
    {#if done.length > 0}
      <section>
        <h2>Handed in</h2>
        <StudentProjects rows={done} showCourse empty="" />
        <p class="note">You can keep submitting while a project is open; the latest version is the one assessed.</p>
      </section>
    {/if}
  {:else if tab === 'courses'}
    {@render courseCards(yours, 'You are not in any edition yet. Make a course, or find one under All courses and ask its owner to add you.')}
  {:else if tab === 'all'}
    {@render courseCards(courses, 'Nobody has made a course yet.')}
  {:else if tab === 'create'}
    <section>
      <h2>New course</h2>
      <form method="POST" action={actionIn('create', 'createCourse')} class="stack">
        <label>Code <input name="code" placeholder="CS-101" required /></label>
        <label>Title <input name="title" placeholder="Introduction to Programming" required /></label>
        <button>Create course</button>
      </form>
      <p class="note">
        A course groups its editions; the work lives in an edition. Next you make its first one.
        To run an existing course again, open it and add an edition there instead.
      </p>
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
