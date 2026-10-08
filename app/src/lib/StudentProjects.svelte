<script lang="ts">
  import { when } from './format';
  import { ideUrl } from './ide';
  import { dueIn, PROGRESS_LABEL, progressOf, type Progress } from './progress';
  import type { StudentProjectRow } from './server/student';

  /** A student's projects as a table: where they stand with each, when it is
   *  due, and the three ways to get on with it (the IDE, the starter, the
   *  upload form). `showCourse` adds the course, for a list across editions. */
  let { rows, showCourse = false, empty }: { rows: readonly StudentProjectRow[]; showCourse?: boolean; empty: string } = $props();

  const now = new Date();
  const progress = (r: StudentProjectRow): Progress =>
    progressOf({ deadline: r.deadline, closesAt: r.closes_at, lastSubmittedAt: r.last_submitted_at, canSubmit: r.can_submit }, now);
  const chip: Record<Progress, string> = { submitted: 'good', late: 'late', todo: '', overdue: 'late', missed: '' };
  const page = (r: StudentProjectRow): string => `/editions/${r.edition_id}/projects/${r.project_id}`;
</script>

{#if rows.length === 0}
  <p class="empty">{empty}</p>
{:else}
  <div class="scroll">
    <table class="projects">
      <thead>
        <tr><th>Project</th><th>Deadline</th><th>Status</th><th>Work on it</th></tr>
      </thead>
      <tbody>
        {#each rows as r (r.project_id)}
          {@const p = progress(r)}
          <tr>
            <td>
              <a href={page(r)}>{r.title}</a>
              {#if showCourse}<div class="muted small">{r.course_code} · {r.edition_label}</div>{/if}
            </td>
            <td>
              {when(r.deadline)}
              {#if p === 'todo' || p === 'overdue'}<div class="muted small">{dueIn(r.deadline, now)}</div>{/if}
            </td>
            <td>
              <span class="chip {chip[p]}">{PROGRESS_LABEL[p]}</span>
              {#if r.last_submitted_at !== null}<div class="muted small">last {when(r.last_submitted_at)}{r.submissions > 1 ? ` · ${r.submissions} versions` : ''}</div>{/if}
            </td>
            <td class="actions">
              <a class="button" href={ideUrl(r.project_id)}>Open in IDE</a>
              {#if r.starter_ready}<a class="button quiet" href="/api/projects/{r.project_id}/starter">Download</a>{/if}
              {#if r.can_submit}<a class="button quiet" href="{page(r)}#submit">Submit</a>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
