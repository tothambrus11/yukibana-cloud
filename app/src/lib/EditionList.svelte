<script module lang="ts">
  import type { EditionId } from './ids';

  /** One edition as a list shows it: field names the database's. */
  export interface EditionItem {
    readonly edition_id: EditionId;
    readonly label: string;
    readonly archived_at: Date | null;
    /** The caller's role, or null for an edition a teacher sees and is not in. */
    readonly role: string | null;
    /** Who owns it, by name, when the caller is not in it. */
    readonly owners: readonly string[];
  }
</script>

<script lang="ts">
  /** The editions of one course, newest first as given: live ones as rows,
   *  archived ones folded away under a count. An edition the caller is not
   *  in is a row with no link and the names of whom to ask, because its page
   *  would show them nothing. */
  let { rows, empty }: { rows: readonly EditionItem[]; empty: string } = $props();
  const live = $derived(rows.filter((e) => e.archived_at === null));
  const archived = $derived(rows.filter((e) => e.archived_at !== null));
</script>

{#snippet item(e: EditionItem)}
  <li class:outside={e.role === null}>
    {#if e.role === null}
      <span class="label">{e.label}</span>
      <span class="muted small">
        You are not in this edition{#if e.owners.length > 0}; ask {e.owners.join(', ')}{/if}.
      </span>
    {:else}
      <a class="label" href="/editions/{e.edition_id}">{e.label}</a>
      <span class="row">
        {#if e.archived_at}<span class="chip">archived</span>{/if}
        <span class="chip" class:live={e.role === 'owner'}>{e.role}</span>
      </span>
    {/if}
  </li>
{/snippet}

{#if rows.length === 0}
  <p class="empty">{empty}</p>
{:else}
  {#if live.length > 0}
    <ul class="editions">{#each live as e (e.edition_id)}{@render item(e)}{/each}</ul>
  {:else}
    <p class="muted small">No running edition.</p>
  {/if}
  {#if archived.length > 0}
    <details class="archived">
      <summary>{archived.length} archived {archived.length === 1 ? 'edition' : 'editions'}</summary>
      <ul class="editions">{#each archived as e (e.edition_id)}{@render item(e)}{/each}</ul>
    </details>
  {/if}
{/if}
