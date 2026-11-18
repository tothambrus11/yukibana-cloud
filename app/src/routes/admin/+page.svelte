<script lang="ts">
  import { page } from '$app/state';
  import Tabs from '#lib/Tabs.svelte';
  import { when } from '#lib/format.ts';
  import { viewer } from '#lib/viewer.svelte.ts';
  import { actionIn, tabOf, type Tab } from '#lib/tabs.ts';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const tabs = $derived<Tab[]>([
    { id: 'roles', label: 'Roles', count: data.staff.length },
    { id: 'courses', label: 'Courses', count: data.courses.length },
    { id: 'audit', label: 'Audit log' },
  ]);
  const tab = $derived(tabOf(page.url, tabs));
</script>

<div class="head">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Courses</a><span>Administration</span></nav>
  <h1>Administration</h1>
  <p>Who may create courses, every course on the platform, and everything it has been asked to do.</p>
</div>

<Tabs {tabs} current={tab} />

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

{:else if tab === 'courses'}
  <section>
    <h2>Courses and editions</h2>
    {#if data.courses.length === 0}
      <p class="empty">No courses yet.</p>
    {:else}
      <div class="scroll">
        <table>
          <thead><tr><th>Code</th><th>Edition</th><th>Owners</th><th>Students</th></tr></thead>
          <tbody>
            {#each data.courses as c (c.edition_id ?? c.course_id)}
              <tr>
                <td>{c.code}</td>
                <td>
                  {#if c.edition_id === null}<span class="muted">{c.title} · no edition yet</span>
                  {:else}<a href="/editions/{c.edition_id}">{c.title} · {c.label}</a>{#if c.archived_at !== null} <span class="chip">archived</span>{/if}{/if}
                </td>
                <td>{#if c.owners === '' && c.edition_id !== null}<span class="chip">none</span>{:else}{c.owners}{/if}</td>
                <td>{c.edition_id === null ? '' : c.students}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    <p class="note">An admin owns every edition: open one to change its roster, names or archive state. Its submissions stay with the people enrolled.</p>
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
                <td>{when(a.at, viewer.zone)}</td>
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
