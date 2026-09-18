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
  const kb = (n: number): string => `${Math.max(1, Math.round(n / 1024))} KB`;
  const p = $derived(data.project);
</script>

<p><a href="/editions/{p.edition_id}">← Edition</a></p>
<h1>{p.title} <span class="muted">{p.slug} · {p.kind}</span></h1>
<p>Available after {when(p.available_after)} · deadline {when(p.deadline)}</p>
{#if form?.error}<p class="error">{form.error}</p>{/if}
{#if form?.submitted}<p class="ok">Submitted: {form.submitted.byteSize} bytes, sha256 {form.submitted.sha256.slice(0, 16)}…</p>{/if}
{#if form?.published}<p class="ok">Published release {form.published.releaseId}.</p>{/if}
{#if form?.token}
  <p class="ok">Token "{form.token.label}" created. Copy it now; it is not shown again:</p>
  <pre>{form.token.secret}</pre>
{/if}

<h2>Starter</h2>
{#if p.ready}
  <p><a href="/api/projects/{p.project_id}/starter">Download {p.slug}.tar.gz</a></p>
{:else}
  <p class="muted">No release has been published yet.</p>
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
          <td>{kb(s.byte_size)}</td>
          <td><code>{s.sha256.slice(0, 12)}</code></td>
          <td><a href="/api/submissions/{s.submission_id}">Download</a></td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

{#if data.staff}
  <h2>Releases</h2>
  {#if data.releases.length === 0}
    <p class="muted">No releases yet. A release is two archives: the starter students get, and the whole project for staff.</p>
  {:else}
    <table>
      <thead><tr><th>Uploaded</th><th>Label</th><th>Commit</th><th>By</th><th>Starter</th><th>Teacher archive</th></tr></thead>
      <tbody>
        {#each data.releases as r, i (r.release_id)}
          <tr>
            <td>{when(r.uploaded_at)}{#if i === 0}<span class="ok"> · live</span>{/if}</td>
            <td>{r.label}</td>
            <td><code>{r.commit_sha?.slice(0, 12) ?? '—'}</code></td>
            <td>{r.uploader ?? ''}{#if r.via_token}<span class="muted"> (token)</span>{/if}</td>
            <td><a href="/api/releases/{r.release_id}/starter">{kb(r.starter_size)}</a></td>
            <td><a href="/api/releases/{r.release_id}/teacher">{kb(r.teacher_size)}</a></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
{/if}

{#if data.owner}
  <h2>Publish a release</h2>
  <p>From a checkout of the project, <code>yukibana build</code> writes <code>starter.tar.gz</code> and <code>teacher.tar.gz</code>; upload them here. Or let CI do it with a token (below), which is what <code>yukibana publish</code> and the GitHub Action use.</p>
  <form method="POST" action="?/publish" enctype="multipart/form-data" class="stack">
    <label>Starter (.tar.gz) <input type="file" name="starter" accept=".gz,application/gzip" required /></label>
    <label>Teacher archive (.tar.gz) <input type="file" name="teacher" accept=".gz,application/gzip" required /></label>
    <label>Label <input name="label" placeholder="v3, or what changed" /></label>
    <label>Commit <input name="commit" placeholder="optional sha" /></label>
    <button>Publish</button>
  </form>

  <h2>Publishing tokens</h2>
  <p>A token publishes releases to this project and nothing else. Put it in your repository's secrets as <code>YUKIBANA_TOKEN</code>, with <code>YUKIBANA_PROJECT={p.project_id}</code> and <code>YUKIBANA_URL={data.origin}</code>.</p>
  {#if data.tokens.length > 0}
    <table>
      <thead><tr><th>Label</th><th>Created</th><th>Last used</th><th></th></tr></thead>
      <tbody>
        {#each data.tokens as t (t.token_id)}
          <tr>
            <td>{t.label}</td>
            <td>{when(t.created_at)}</td>
            <td>{t.revoked_at ? 'revoked' : when(t.last_used_at)}</td>
            <td>{#if !t.revoked_at}<form method="POST" action="?/revokeToken" class="inline"><input type="hidden" name="token_id" value={t.token_id} /><button>Revoke</button></form>{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  <form method="POST" action="?/createToken" class="stack">
    <label>Label <input name="label" placeholder="github actions" /></label>
    <button>Create token</button>
  </form>

  <h2>Settings</h2>
  <form method="POST" action="?/update" class="stack">
    <label>Title <input name="title" value={p.title} required /></label>
    <label>Available after <input type="datetime-local" name="available_after" value={local(p.available_after)} /></label>
    <label>Deadline <input type="datetime-local" name="deadline" value={local(p.deadline)} /></label>
    <button>Save</button>
  </form>
  <p class="muted">No "available after" date means students cannot see the project at all.</p>
{/if}
