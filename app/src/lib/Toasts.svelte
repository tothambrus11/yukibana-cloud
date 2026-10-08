<script lang="ts">
  import { dismiss, toasts } from './toast.svelte';
  /** Where `toast` draws: one region for the whole site, announced to screen
   *  readers as it changes. */
</script>

<div class="toasts" role="status" aria-live="assertive">
  {#each toasts as t (t.id)}
    <div class="toast">
      <span>{t.message}</span>
      <button type="button" class="quiet" aria-label="Dismiss" onclick={() => dismiss(t.id)}>×</button>
    </div>
  {/each}
</div>
