<script lang="ts">
  import CopyButton from './CopyButton.svelte';
  import { dismiss, toasts } from './toast.svelte';
  /** Where `toast` draws: one region for the whole site, announced to screen
   *  readers as it changes. A notice with details (an incident) shows them
   *  folded, to be read or copied. */
</script>

<div class="toasts" role="status" aria-live="assertive">
  {#each toasts as t (t.id)}
    <div class="toast">
      <span>{t.message}</span>
      {#if t.details !== null}
        <details>
          <summary>Details</summary>
          <pre>{t.details}</pre>
        </details>
        <CopyButton text={t.details} />
      {/if}
      <button type="button" class="quiet" aria-label="Dismiss" onclick={() => dismiss(t.id)}>×</button>
    </div>
  {/each}
</div>
