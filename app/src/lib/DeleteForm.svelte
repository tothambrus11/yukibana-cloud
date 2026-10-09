<script lang="ts">
  /** A delete, at the bottom of a settings tab: what goes with it, a box to
   *  type the thing's name into, and the button, which stays disabled until
   *  the name matches. The server checks the name again (see
   *  server/deletion.ts), so without JavaScript it is the same form.
   *
   *  `blocked` is why it cannot be deleted at all, as the page learned it
   *  from the database (submissions, another owner); the form is then not
   *  drawn, only the reason. */
  let { action, what, name, consequences, blocked = null }: {
    action: string;
    what: string;
    name: string;
    consequences: string;
    blocked?: string | null;
  } = $props();
  let typed = $state('');
</script>

<section class="danger">
  <h2>Delete this {what}</h2>
  <p class="note">{consequences}</p>
  {#if blocked !== null}
    <p class="empty">{blocked}</p>
  {:else}
    <form method="POST" {action} class="stack">
      <!-- One span: a label in a stacked form is a grid, and each loose
           piece of its text would be a row of its own. -->
      <label><span>Type <code>{name}</code> to confirm</span>
        <input name="confirm" autocomplete="off" spellcheck="false" bind:value={typed} required />
      </label>
      <button class="danger" disabled={typed.trim() !== name}>Delete {what}</button>
    </form>
  {/if}
</section>
