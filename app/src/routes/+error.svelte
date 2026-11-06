<script lang="ts">
  import { page } from '$app/state';
  import CopyButton from '#lib/CopyButton.svelte';
  import { incidentText } from '#lib/incident.ts';

  const report = $derived(page.error?.incident === undefined ? null : incidentText(page.error.incident));
</script>

<!--
  Without this file SvelteKit answers with its own built-in page: the status,
  the word "Internal Error", and nothing else, outside the layout and outside
  every style in this app. Since hooks.server.ts went to the trouble of
  putting a sentence in `error.message` — often the only copy a person will
  ever see, because the rest of it is in a Worker log — this is where that
  sentence is read. An unexpected error also brings its incident, shown here
  whole so that it can be copied into a report.
-->
<div class="head">
  <h1>{page.status === 404 ? 'Nothing here' : 'That did not work'}</h1>
</div>

<section>
  <h2>{page.status}</h2>
  <p class="error">{page.error?.message ?? 'Something went wrong.'}</p>
  {#if page.status === 404}
    <p>The link may be old, or the thing it pointed at may have been removed.</p>
  {:else if page.status === 401 || page.status === 403}
    <p>You may be logged in as somebody else, or not enrolled in this edition.</p>
  {/if}
  {#if report !== null}
    <p>This is a bug. The details below say when and where it happened; copy them into your report.</p>
    <pre class="incident">{report}</pre>
    <p><CopyButton text={report} /></p>
  {/if}
  <p><a href="/">Back to your courses</a></p>
</section>
