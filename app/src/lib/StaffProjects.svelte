<script module lang="ts">
  /** One project as staff see it in an edition's list. */
  export interface StaffProject {
    readonly project_id: string;
    readonly title: string;
    readonly kind: string;
    readonly available_after: Date | null;
    readonly deadline: Date | null;
    readonly closes_at: Date | null;
    readonly releases: number;
    readonly ready: boolean;
  }
</script>

<script lang="ts">
  import { beforeNavigate } from '$app/navigation';
  import { tick } from 'svelte';
  import { postAction } from './action';
  import { when } from './format';
  import { hold } from './live.svelte';
  import { move } from './order';
  import { toast } from './toast.svelte';

  /** An edition's projects for staff, in the order students see them.
   *
   *  With `reorder`, each row can be dragged, or moved with the arrow keys on
   *  its handle, and every move is saved as it is made: the list changes on
   *  screen first and goes back, with a toast saying why, if the server
   *  refuses. Moves are sent one after another, in the order they were made,
   *  because each is placed between neighbours as the server has them.
   *  Leaving while one is on its way asks first. Without `reorder` (the
   *  database said this person may not), none of that is drawn at all.
   *
   *  Changes others make arrive live (see live.svelte.ts), but not during a
   *  drag or while a move is unsaved: the list would jump under the pointer,
   *  or briefly show the server's older order. */
  let { rows, editionId, reorder }: { rows: readonly StaffProject[]; editionId: string; reorder: boolean } = $props();

  const byId = $derived(new Map(rows.map((p) => [p.project_id, p] as const)));
  // Follows `rows` whenever the page reloads, and is overridden by a move in
  // the meantime.
  let order = $derived(rows.map((p) => p.project_id));
  let dragging = $state<number | null>(null);
  let over = $state<number | null>(null);
  let saving = $state(0);
  let queue: Promise<void> = Promise.resolve();

  const now = Date.now();
  const past = (d: Date | null): boolean => d !== null && new Date(d).getTime() <= now;

  function commit(from: number, to: number): void {
    const moved = move(order, from, to);
    if (moved === null) return;
    const previous = order;
    order = moved.items;
    saving += 1;
    queue = queue
      .then(() => postAction('?tab=projects&/move', { project: moved.items[to] ?? '', after: moved.after ?? '', before: moved.before ?? '' }))
      .catch((e: unknown) => {
        order = previous;
        toast(`The new order was not saved: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        saving -= 1;
      });
  }

  async function onkey(e: KeyboardEvent, i: number): Promise<void> {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : null;
    if (to === null) return;
    e.preventDefault();
    const id = order[i];
    commit(i, to);
    // The row is drawn again in its new place; keep the focus on its handle
    // so the next arrow key moves it further.
    await tick();
    document.querySelector<HTMLButtonElement>(`[data-handle="${id}"]`)?.focus();
  }

  /** What makes row `i` draggable: attributes and handlers, spread onto the
   *  row only when reordering is allowed. */
  function draggableRow(id: string, i: number) {
    return {
      draggable: true,
      ondragstart: (e: DragEvent) => {
        dragging = i;
        e.dataTransfer?.setData('text/plain', id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      },
      ondragover: (e: DragEvent) => {
        if (dragging === null) return;
        e.preventDefault();
        over = i;
      },
      ondrop: (e: DragEvent) => {
        e.preventDefault();
        if (dragging !== null) commit(dragging, i);
        dragging = over = null;
      },
      ondragend: () => {
        dragging = over = null;
      },
    };
  }

  $effect(() => (saving > 0 || dragging !== null ? hold() : undefined));

  // A tab being closed gets the browser's own question; a link inside the
  // site gets ours.
  beforeNavigate((nav) => {
    if (saving === 0) return;
    if (nav.type === 'leave') nav.cancel();
    else if (!confirm('The new order is still being saved. Leave anyway?')) nav.cancel();
  });
</script>

{#if order.length === 0}
  <p class="empty">No projects yet.</p>
{:else}
  {#if reorder}<p class="note">Drag a project to change the order students see. Changes are saved as you drop.</p>{/if}
  <div class="scroll">
    <table class="projects">
      <thead>
        <tr>
          {#if reorder}<th><span class="sr-only">Order</span></th>{/if}
          <th>Project</th><th>Opens</th><th>Deadline</th><th>Closes</th><th>Releases</th>
        </tr>
      </thead>
      <tbody>
        {#each order as id, i (id)}
          {@const p = byId.get(id)}
          {#if p}
            <tr
              {...(reorder ? draggableRow(id, i) : {})}
              class:dragging={dragging === i}
              class:over={over === i && dragging !== null && dragging !== i}
            >
              {#if reorder}
                <td class="grip">
                  <button type="button" class="handle" data-handle={id} aria-label="Move {p.title}: drag, or use the up and down arrow keys" title="Drag to reorder" onkeydown={(e) => onkey(e, i)}>⠿</button>
                </td>
              {/if}
              <td>
                <a href="/editions/{editionId}/projects/{p.project_id}">{p.title}</a>
                <span class="chip">{p.kind}</span>
                {#if p.available_after === null}<span class="chip">draft</span>{/if}
                {#if !p.ready}<span class="chip">no starter yet</span>{/if}
              </td>
              <td>{when(p.available_after)}</td>
              <td>{when(p.deadline)}{#if past(p.deadline) && !past(p.closes_at)} <span class="chip late">late window</span>{/if}</td>
              <td>{p.closes_at === null ? 'never' : when(p.closes_at)}</td>
              <td>{p.releases}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
{/if}
