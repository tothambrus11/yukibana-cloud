<script lang="ts">
  import { page } from '$app/state';
  import Tabs from '#lib/Tabs.svelte';
  import { kb, local, when } from '#lib/format.ts';
  import { ideUrl } from '#lib/ide.ts';
  import { hold, live, refresh } from '#lib/live.svelte.ts';
  import { actionIn, tabOf, type Tab } from '#lib/tabs.ts';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const p = $derived(data.project);
  const tabs = $derived<Tab[]>(data.staff
    ? [
        { id: 'overview', label: 'Overview' },
        { id: 'submissions', label: 'Submissions', count: data.submissions.length },
        { id: 'releases', label: 'Releases', count: data.releases.length },
        ...(data.owner ? [{ id: 'tokens', label: 'Tokens' }] : []),
        ...(data.project.can_edit ? [{ id: 'settings', label: 'Settings' }] : []),
      ]
    : [
        { id: 'overview', label: 'Overview' },
        { id: 'submissions', label: 'My submissions', count: data.submissions.length },
      ]);
  const tab = $derived(tabOf(page.url, tabs));
  const pastDeadline = $derived(p.deadline !== null && new Date(p.deadline).getTime() <= Date.now());
  const students = $derived(new Set(data.submissions.map((s) => s.author_id)).size);
  const late = $derived(data.submissions.filter((s) => s.late).length);

  // The settings form follows the project live until somebody types in it.
  // From then on changes from others are held back, so the form is never
  // rewritten under the cursor, and the page says that it is out of date;
  // saving replaces their change, discarding loads it.
  let editing = $state(false);
  $effect(() => (editing ? hold() : undefined));
  function discard(): void {
    editing = false;
    refresh();
  }
</script>

<div class="head">
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="/">Courses</a>
    <a href="/editions/{p.edition_id}">{p.course_code} {p.edition_label}</a>
    <span>{p.title}</span>
  </nav>
  <h1>{p.title}</h1>
  <p class="row">
    <span class="chip">{p.kind}</span>
    {#if data.staff && p.available_after === null}<span class="chip">draft</span>{/if}
    {#if pastDeadline}<span class="chip late">past the deadline</span>{/if}
  </p>
</div>

<Tabs {tabs} current={tab} />

{#if tab === 'overview'}
  {#if form?.submitted}
    <p class="ok">Submission received: {kb(form.submitted.byteSize)}, SHA-256 {form.submitted.sha256.slice(0, 16)}…</p>
  {/if}
  <section>
    <h2>Dates</h2>
    <div class="stats">
      <div><strong>{when(p.available_after)}</strong><span>Opens</span></div>
      <div><strong>{when(p.deadline)}</strong><span>Deadline</span></div>
      <div><strong>{p.closes_at === null ? 'Never' : when(p.closes_at)}</strong><span>Closes</span></div>
    </div>
    <p class="note">
      Submissions after the deadline are accepted until the project closes, and are marked late.
    </p>
  </section>

  {#if data.staff}
    <section>
      <h2>At a glance</h2>
      <div class="stats">
        <div><strong>{data.submissions.length}</strong><span>Submissions</span></div>
        <div><strong>{students}</strong><span>Students who submitted</span></div>
        <div><strong>{late}</strong><span>Late submissions</span></div>
        <div><strong>{data.releases.length}</strong><span>Releases</span></div>
      </div>
    </section>
  {/if}

  <section>
    <h2>{data.staff ? 'Starter' : 'Work on it'}</h2>
    {#if p.ready}
      <p class="row">
        <a class="button" href={ideUrl(p.project_id)}>Open in Yukibana IDE</a>
        <a class="button quiet" href="/api/projects/{p.project_id}/starter">Download {p.slug}.tar.gz</a>
      </p>
      {#if !data.staff}<p class="note">The IDE opens the project, downloading it if needed. Without the IDE, download the starter and work in that folder.</p>{/if}
    {:else}
      <p class="empty">No release has been published yet.</p>
    {/if}
  </section>

  {#if !data.staff}
    <section id="submit">
      <h2>Submit your solution</h2>
      {#if p.can_submit}
        {#if pastDeadline}<p class="error">The deadline has passed: a submission now is recorded as late.</p>{/if}
        <form method="POST" action={actionIn('overview', 'submit')} enctype="multipart/form-data" class="stack">
          <label>Your solution as .tar.zst
            <input type="file" name="archive" accept=".zst,application/zstd" required />
          </label>
          <button>Submit</button>
        </form>
        <p class="note">
          You can submit as many times as you like. Every version is kept; the latest version is the one assessed.
          The IDE's submit button sends the right archive for you; to make one by hand, run <code>yukibana pack</code> in the project folder.
        </p>
      {:else}
        <p class="empty">This project is not accepting submissions from you now.</p>
      {/if}
    </section>
  {/if}
{:else if tab === 'submissions'}
  <section>
    <h2>{data.staff ? 'Submissions' : 'My submissions'}</h2>
    {#if data.submissions.length === 0}
      <p class="empty">None yet.</p>
    {:else}
      <div class="scroll">
        <table>
          <thead>
            <tr>{#if data.staff}<th>Student</th>{/if}<th>Submitted</th><th>Size</th><th>SHA-256</th><th></th></tr>
          </thead>
          <tbody>
            {#each data.submissions as s (s.submission_id)}
              <tr>
                {#if data.staff}
                  <td>{s.full_name ?? ''} {#if s.github_login}<span class="muted">@{s.github_login}</span>{/if}</td>
                {/if}
                <td>{when(s.submitted_at)}{#if s.late} <span class="chip late">late</span>{/if}</td>
                <td>{kb(s.byte_size)}</td>
                <td><code>{s.sha256.slice(0, 12)}</code></td>
                <td><a href="/api/submissions/{s.submission_id}">Download</a></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{:else if tab === 'releases'}
  {#if form?.published}<p class="ok">Published release {form.published.releaseId}.</p>{/if}
  <section>
    <h2>Releases</h2>
    {#if data.releases.length === 0}
      <p class="empty">
        No releases yet. A release is two archives: the starter students get, and the whole project
        for staff.
      </p>
    {:else}
      <div class="scroll">
        <table>
          <thead>
            <tr><th>Uploaded</th><th>Label</th><th>Commit</th><th>By</th><th>Starter</th><th>Teacher archive</th></tr>
          </thead>
          <tbody>
            {#each data.releases as r, i (r.release_id)}
              <tr>
                <td>{when(r.uploaded_at)}{#if i === 0} <span class="chip live">live</span>{/if}</td>
                <td>{r.label}</td>
                <td><code>{r.commit_sha?.slice(0, 12) ?? '—'}</code></td>
                <td>{r.uploader ?? ''}{#if r.via_token} <span class="chip">token</span>{/if}</td>
                <td><a href="/api/releases/{r.release_id}/starter">{kb(r.starter_size)}</a></td>
                <td><a href="/api/releases/{r.release_id}/teacher">{kb(r.teacher_size)}</a></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  {#if p.can_edit}
    <section>
      <h2>Publish a release</h2>
      <p>
        From a checkout of the project, <code>yukibana build</code> writes <code>starter.tar.gz</code>
        and <code>teacher.tar.gz</code>; upload them here. CI can publish instead, with a token an
        owner makes in the Tokens tab.
      </p>
      <form method="POST" action={actionIn('releases', 'publish')} enctype="multipart/form-data" class="stack">
        <label>Starter (.tar.gz) <input type="file" name="starter" accept=".gz,application/gzip" required /></label>
        <label>Teacher archive (.tar.gz) <input type="file" name="teacher" accept=".gz,application/gzip" required /></label>
        <label>Label <input name="label" placeholder="v3, or what changed" /></label>
        <label>Commit <input name="commit" placeholder="optional sha" /></label>
        <button>Publish</button>
      </form>
    </section>
  {/if}
{:else if tab === 'tokens'}
  {#if form?.token}
    <section>
      <h2>Your new token</h2>
      <p class="ok">Token "{form.token.label}" created. Copy it now; it is not shown again.</p>
      <pre>{form.token.secret}</pre>
    </section>
  {/if}
  <section>
    <h2>Publishing tokens</h2>
    <p>A token publishes releases to this project and nothing else. Put it in your repository's secrets:</p>
    <pre>YUKIBANA_TOKEN   (the secret)
YUKIBANA_PROJECT {p.project_id}
YUKIBANA_URL     {data.origin}</pre>
    {#if data.tokens.length > 0}
      <div class="scroll">
        <table>
          <thead><tr><th>Label</th><th>Created</th><th>Last used</th><th></th></tr></thead>
          <tbody>
            {#each data.tokens as t (t.token_id)}
              <tr>
                <td>{t.label}</td>
                <td>{when(t.created_at)}</td>
                <td>{#if t.revoked_at}<span class="chip">revoked</span>{:else}{when(t.last_used_at)}{/if}</td>
                <td>
                  {#if !t.revoked_at}
                    <form method="POST" action={actionIn('tokens', 'revokeToken')} class="inline">
                      <input type="hidden" name="token_id" value={t.token_id} />
                      <button>Revoke</button>
                    </form>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
  <section>
    <h2>New token</h2>
    <form method="POST" action={actionIn('tokens', 'createToken')} class="stack">
      <label>Label <input name="label" placeholder="github actions" /></label>
      <button>Create token</button>
    </form>
  </section>
{:else if tab === 'settings'}
  {#if form?.ok}<p class="ok">Saved.</p>{/if}
  <section>
    <h2>Settings</h2>
    {#if editing && live.stale}
      <p class="error" role="alert">
        Somebody else changed this project while you were editing. Saving replaces their change.
        <button type="button" class="quiet" onclick={discard}>Discard my edits and show theirs</button>
      </p>
    {/if}
    {#key p}
      <form method="POST" action={actionIn('settings', 'update')} class="stack" oninput={() => (editing = true)}>
        <label>Title <input name="title" value={p.title} required /></label>
        <label>Opens <input type="datetime-local" name="available_after" value={local(p.available_after)} /></label>
        <label>Deadline <input type="datetime-local" name="deadline" value={local(p.deadline)} /></label>
        <label>Closes <input type="datetime-local" name="closes_at" value={local(p.closes_at)} /></label>
        <button>Save</button>
      </form>
    {/key}
    <p class="note">
      Without an opening date students cannot see the project at all. Between the deadline and the
      closing date, submissions are accepted and marked late; after closing, students no longer see
      the project. Without a closing date, late work is accepted indefinitely.
    </p>
  </section>
{/if}
