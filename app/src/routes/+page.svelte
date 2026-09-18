<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const staff = $derived(data.platformRole === 'teacher' || data.platformRole === 'admin');
</script>

<h1>Your courses</h1>

{#if data.user === null}
  <p>Yukibana holds course projects and the work students submit for them. <a href="/auth/login">Log in with GitHub</a> to see yours.</p>
{:else}
  {#if data.editions.length === 0}
    <p class="muted">You are not in any course edition yet. Enrolment is by address: once a teacher enrols the address you logged in with, the edition appears here.</p>
  {:else}
    <table>
      <thead><tr><th>Course</th><th>Edition</th><th>You are</th></tr></thead>
      <tbody>
        {#each data.editions as e (e.edition_id)}
          <tr>
            <td>{e.code} · {e.title}</td>
            <td><a href="/editions/{e.edition_id}">{e.label}</a>{#if e.archived_at}<span class="muted"> (archived)</span>{/if}</td>
            <td>{e.role}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#if staff}
    <h2>New edition</h2>
    {#if form?.error}<p class="error">{form.error}</p>{/if}
    {#if data.courses.length > 0}
      <form method="POST" action="?/createEdition" class="stack">
        <label>Course
          <select name="course_id">
            {#each data.courses as c (c.course_id)}<option value={c.course_id}>{c.code} · {c.title}</option>{/each}
          </select>
        </label>
        <label>Label <input name="label" placeholder="2026 autumn" required /></label>
        <button>Create edition</button>
      </form>
      <p class="muted">To reuse last year's projects and staff, open that edition and duplicate it instead.</p>
    {/if}
    <h2>New course</h2>
    <form method="POST" action="?/createCourse" class="stack">
      <label>Code <input name="code" placeholder="CS-101" required /></label>
      <label>Title <input name="title" placeholder="Introduction to Programming" required /></label>
      <button>Create course</button>
    </form>
  {/if}
  {#if data.platformRole === 'admin'}
    <p><a href="/admin">Administration</a></p>
  {/if}
{/if}
