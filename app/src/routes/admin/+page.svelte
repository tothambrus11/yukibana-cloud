<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div class="head">
  <a href="/" class="back">← Your courses</a>
  <h1>Administration</h1>
  <p>Who may create courses, and everything the platform has been asked to do.</p>
</div>

{#if form?.error}<p class="error">{form.error}</p>{/if}

<section>
  <h2>Change a platform role</h2>
  <form method="POST" action="?/setRole" class="stack">
    <label>Address <input name="email" type="email" required placeholder="teacher@school.example" /></label>
    <label>Role
      <select name="role">
        <option value="teacher">teacher</option>
        <option value="user">user</option>
        <option value="admin">admin</option>
      </select>
    </label>
    <button>Set role</button>
  </form>
  <p class="note">The person must have logged in once, so there is an account to change.</p>
</section>

<section>
  <h2>Teachers and admins</h2>
  {#if data.staff.length === 0}
    <p class="empty">Nobody but you.</p>
  {:else}
    <div class="scroll">
      <table>
        <thead><tr><th>Person</th><th>Role</th></tr></thead>
        <tbody>
          {#each data.staff as s (s.user_id)}
            <tr>
              <td>{s.full_name ?? ''} {#if s.github_login}<span class="muted">@{s.github_login}</span>{/if}</td>
              <td><span class="chip">{s.role}</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<section>
  <h2>Audit log</h2>
  {#if data.audit.length === 0}
    <p class="empty">Nothing has happened yet.</p>
  {:else}
    <div class="scroll">
      <table>
        <thead><tr><th>When</th><th>Action</th><th>Subject</th></tr></thead>
        <tbody>
          {#each data.audit as a, i (i)}
            <tr>
              <td>{new Date(a.at).toLocaleString()}</td>
              <td><span class="chip">{a.action}</span></td>
              <td><code>{a.subject}</code></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
