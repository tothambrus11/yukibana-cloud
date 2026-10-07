<script lang="ts">
  import { page } from '$app/state';
  import Tabs from '#lib/Tabs.svelte';
  import { actionIn, tabOf, type Tab } from '#lib/tabs.ts';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const tabs = $derived<Tab[]>([
    { id: 'roles', label: 'Roles', count: data.staff.length },
    { id: 'audit', label: 'Audit log' },
  ]);
  const tab = $derived(tabOf(page.url, tabs));
</script>

<div class="head">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Courses</a><span>Administration</span></nav>
  <h1>Administration</h1>
  <p>Who may create courses, and everything the platform has been asked to do.</p>
</div>

<Tabs {tabs} current={tab} />
{#if form?.error}<p class="error">{form.error}</p>{/if}

{#if tab === 'roles'}
  <section>
    <h2>Change a platform role</h2>
    <form method="POST" action={actionIn('roles', 'setRole')} class="stack">
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

{:else}
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
{/if}
