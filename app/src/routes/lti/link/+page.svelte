<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<section class="stack">
  <h1>Link a Moodle course</h1>
  <p class="muted">
    Its members will be enrolled in the edition you pick, as students, or as assistants for Moodle's teachers,
    and kept in step with Moodle from then on. Nobody you enrolled by hand is changed.
  </p>
  {#if data.editions.length === 0}
    <p>You own no edition that is not linked already. Create one, then launch Yukibana from Moodle again.</p>
  {:else}
    <form method="POST" action="?/link" class="stack">
      <label>Edition
        <select name="edition" required>
          {#each data.editions as e (e.edition_id)}
            <option value={e.edition_id}>{e.code} · {e.title} · {e.label}</option>
          {/each}
        </select>
      </label>
      <button>Link</button>
    </form>
  {/if}
</section>
