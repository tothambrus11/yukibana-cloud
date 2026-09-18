<script lang="ts">
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const when = (d: Date | null): string => (d === null ? '—' : new Date(d).toLocaleString());
  // datetime-local wants local time without a zone; the browser's zone is the teacher's.
  const local = (d: Date | null): string => {
    if (d === null) return '';
    const t = new Date(d);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
  };
  const p = $derived(data.project);
</script>

<p><a href="/editions/{p.edition_id}">← Edition</a></p>
<h1>{p.title} <span class="muted">{p.slug} · {p.kind}</span></h1>
<p>Available after {when(p.available_after)} · deadline {when(p.deadline)}</p>
{#if form?.error}<p class="error">{form.error}</p>{/if}
{#if form?.submitted}<p class="ok">Submitted: {form.submitted.byteSize} bytes, sha256 {form.submitted.sha256.slice(0, 16)}…</p>{/if}

<h2>Starter</h2>
{#if p.ready}
  <p><a href="/api/projects/{p.project_id}/starter">Download {p.slug}.tar.gz</a></p>
{:else}
  <p class="muted">No starter has been built yet.</p>
{/if}

{#if !data.staff}
  <h2>Submit</h2>
  {#if p.can_submit}
    <form method="POST" action="?/submit" enctype="multipart/form-data" class="stack">
      <label>Your solution as .tar.zst <input type="file" name="archive" accept=".zst,application/zstd" required /></label>
      <button>Submit</button>
    </form>
    <p class="muted">You can submit as many times as you like before the deadline; every version is kept.</p>
  {:else}
    <p class="muted">This project is not accepting submissions from you now.</p>
  {/if}
{/if}

<h2>{data.staff ? 'Submissions' : 'Your submissions'}</h2>
{#if data.submissions.length === 0}
  <p class="muted">None yet.</p>
{:else}
  <table>
    <thead><tr>{#if data.staff}<th>Student</th>{/if}<th>Submitted</th><th>Size</th><th>SHA-256</th><th></th></tr></thead>
    <tbody>
      {#each data.submissions as s (s.submission_id)}
        <tr>
          {#if data.staff}<td>{s.full_name ?? ''} {#if s.github_login}<span class="muted">@{s.github_login}</span>{/if}</td>{/if}
          <td>{when(s.submitted_at)}</td>
          <td>{s.byte_size}</td>
          <td><code>{s.sha256.slice(0, 12)}</code></td>
          <td><a href="/api/submissions/{s.submission_id}">Download</a></td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

{#if data.owner}
  <h2>Settings</h2>
  <form method="POST" action="?/update" class="stack">
    <label>Title <input name="title" value={p.title} required /></label>
    <label>Available after <input type="datetime-local" name="available_after" value={local(p.available_after)} /></label>
    <label>Deadline <input type="datetime-local" name="deadline" value={local(p.deadline)} /></label>
    <label>Branch or tag to build from <input name="github_ref" value={p.github_ref} /></label>
    <button>Save</button>
  </form>
  <p class="muted">No "available after" date means students cannot see the project at all.</p>

  <h2>Repository</h2>
  {#if p.github_repo_full_name}
    <p>{p.github_repo_full_name} @ {p.github_ref}
      {#if p.installation_removed}<span class="error"> · the GitHub App was uninstalled; connect it again</span>{/if}</p>
    <form method="POST" action="?/rebuild" class="inline"><button>Rebuild now</button></form>
    <a href={data.connectUrl}>Connect a different repository</a>
  {:else}
    <p><a href={data.connectUrl}>Connect a GitHub repository</a> — you will be asked to install the Yukibana app on it, then to pick it.</p>
  {/if}
{/if}

{#if data.staff}
  <h2>Builds</h2>
  {#if data.builds.length === 0}
    <p class="muted">No builds yet. Every push to the repository's branch builds a starter; so does "Rebuild now".</p>
  {:else}
    <table>
      <thead><tr><th>Started</th><th>Status</th><th>Commit</th><th>Log</th></tr></thead>
      <tbody>
        {#each data.builds as b (b.build_id)}
          <tr>
            <td>{when(b.started_at)}</td>
            <td class={b.status === 'succeeded' ? 'ok' : b.status === 'failed' ? 'error' : 'muted'}>{b.status}</td>
            <td><code>{b.commit_sha?.slice(0, 12) ?? '—'}</code></td>
            <td><pre>{b.log}</pre></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
{/if}
