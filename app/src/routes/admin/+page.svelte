<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<p><a href="/">← Your courses</a></p>
<h1>Administration</h1>
{#if form?.error}<p class="error">{form.error}</p>{/if}

<h2>Change a platform role</h2>
<form method="POST" action="?/setRole" class="stack">
  <label>Address (the person must have logged in once) <input name="email" type="email" required /></label>
  <label>Role <select name="role"><option value="teacher">teacher</option><option value="user">user</option><option value="admin">admin</option></select></label>
  <button>Set role</button>
</form>

<h2>Teachers and admins</h2>
<table>
  <thead><tr><th>Person</th><th>Role</th></tr></thead>
  <tbody>
    {#each data.staff as s (s.user_id)}
      <tr><td>{s.full_name ?? ''} {#if s.github_login}<span class="muted">@{s.github_login}</span>{/if}</td><td>{s.role}</td></tr>
    {/each}
  </tbody>
</table>

<h2>Audit log</h2>
<table>
  <thead><tr><th>When</th><th>Action</th><th>Subject</th></tr></thead>
  <tbody>
    {#each data.audit as a, i (i)}
      <tr><td>{new Date(a.at).toLocaleString()}</td><td>{a.action}</td><td><code>{a.subject}</code></td></tr>
    {/each}
  </tbody>
</table>
