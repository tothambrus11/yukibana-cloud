<!--
  The call hierarchy of the function last asked about (Show Call Hierarchy,
  Shift+Alt+H): its callers or its callees as a tree. A row's arrow expands
  it, asking the server for the next level; clicking the row goes to its
  first call, and a row with several calls lists them to go to each.
-->
<script lang="ts">
	import { WORKSPACE } from '../project';
	import { toMonacoRange } from '@yukibana/monaco';
	import { callsLabel, iconOf, placeOf, siteLabel, type CallSite } from '../lsp/call-hierarchy';
	import type { CallNode } from '../call-hierarchy.svelte';
	import type { Workspace } from '../workspace.svelte';

	let { workspace }: { workspace: Workspace } = $props();

	const tree = $derived(workspace.callHierarchy);
	const go = (site: CallSite) => workspace.showSite(site.uri, toMonacoRange(site.range));
	/** Right opens a row, Left closes it or goes to its parent's row, as in a tree view. */
	function keys(e: KeyboardEvent, node: CallNode) {
		if (e.key === 'ArrowRight' && node.expandable && !node.expanded) void node.expand();
		else if (e.key === 'ArrowLeft' && node.expanded) node.expanded = false;
		else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			const rows = [...(e.currentTarget as HTMLElement).closest('.calls')!.querySelectorAll<HTMLElement>('.row')];
			rows[rows.indexOf(e.currentTarget as HTMLElement) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
		} else return;
		e.preventDefault();
	}
</script>

{#snippet branch(node: CallNode, depth: number)}
	<li role="treeitem" aria-expanded={node.expandable ? node.expanded : undefined} aria-selected="false">
		<div class="line" data-depth={depth} style:padding-left="{0.5 + depth * 1}rem">
			{#if node.expandable}
				<button class="twisty" tabindex="-1" aria-label={node.expanded ? 'Collapse' : 'Expand'} onclick={() => void node.toggle()}>
					<span class="codicon {node.expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}"></span>
				</button>
			{:else}
				<span class="twisty"></span>
			{/if}
			<button class="row" title={node.row.item.detail ?? node.row.item.name} onclick={() => go(node.row.sites[0]!)} onkeydown={(e) => keys(e, node)}>
				<span class="codicon codicon-{iconOf(node.row.item.kind)} kind"></span>
				<span class="name">{node.row.item.name}</span>
				{#if node.row.item.detail}<span class="detail">{node.row.item.detail}</span>{/if}
				<span class="where">{placeOf(node.row.item, WORKSPACE.uri)}{depth > 0 ? ` · ${callsLabel(node.row.sites.length)}` : ''}{node.row.recursive ? ' · recursive' : ''}</span>
			</button>
		</div>
		{#if depth > 0 && node.row.sites.length > 1}
			<div class="sites" style:padding-left="{2.1 + depth * 1}rem">
				{#each node.row.sites as site, i (i)}
					<button class="site" title="Go to this call" onclick={() => go(site)}>{siteLabel(site)}</button>
				{/each}
			</div>
		{/if}
		{#if node.expanded}
			{#if node.loading}
				<p class="note" style:padding-left="{2.1 + depth * 1}rem">Asking the language server…</p>
			{:else if node.failed}
				<p class="note failed" style:padding-left="{2.1 + depth * 1}rem">{node.failed}</p>
			{:else if node.children?.length === 0}
				<p class="note" style:padding-left="{2.1 + depth * 1}rem">{tree?.direction === 'incoming' ? 'No callers in the project.' : 'Calls no function of the project.'}</p>
			{:else if node.children}
				<ul role="group">
					{#each node.children as child, i (i)}
						{@render branch(child, depth + 1)}
					{/each}
				</ul>
			{/if}
		{/if}
	</li>
{/snippet}

<div class="call-hierarchy">
	{#if !tree}
		<p class="empty">Show Call Hierarchy (Shift+Alt+H, or the editor's context menu) on a function lists its callers and what it calls, here.</p>
	{:else}
		<div class="toolbar" role="radiogroup" aria-label="Direction">
			<button class:on={tree.direction === 'incoming'} role="radio" aria-checked={tree.direction === 'incoming'} title="Who calls {tree.root.name}" onclick={() => tree.show('incoming')}>Callers</button>
			<button class:on={tree.direction === 'outgoing'} role="radio" aria-checked={tree.direction === 'outgoing'} title="What {tree.root.name} calls" onclick={() => tree.show('outgoing')}>Callees</button>
			<span class="spacer"></span>
			<button title="Ask the language server again" aria-label="Refresh" onclick={() => tree.show(tree.direction)}><span class="codicon codicon-refresh"></span></button>
		</div>
		{#if tree.top}
			<ul class="calls" role="tree" aria-label="{tree.direction === 'incoming' ? 'Callers of' : 'Calls from'} {tree.root.name}">
				{@render branch(tree.top, 0)}
			</ul>
		{/if}
	{/if}
</div>

<style>
	.call-hierarchy {
		display: flex;
		flex-direction: column;
		height: 100%;
		font-size: 0.8125rem;
	}
	.empty {
		margin: 0.6rem 1rem;
		color: var(--gray-3);
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.35rem 0.6rem;
		border-bottom: 1px solid var(--gray-5);
	}
	.toolbar button {
		display: inline-flex;
		align-items: center;
		height: 1.5rem;
		padding: 0 0.6rem;
		border: 1px solid transparent;
		border-radius: 0.3rem;
		background: none;
		color: var(--gray-3);
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.toolbar button:hover,
	.toolbar button:focus-visible {
		color: var(--white);
		outline: none;
	}
	.toolbar button.on {
		border-color: var(--gray-5);
		background: var(--gray-6);
		color: var(--white);
	}
	.spacer {
		flex: 1;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.calls {
		flex: 1;
		overflow: auto;
		padding: 0.3rem 0;
	}
	.line {
		display: flex;
		align-items: center;
	}
	.twisty {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: 1.1rem;
		height: 1.4rem;
		padding: 0;
		border: 0;
		background: none;
		color: var(--gray-3);
		cursor: pointer;
	}
	.row {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		flex: 1;
		min-width: 0;
		padding: 0.15rem 0.6rem 0.15rem 0.2rem;
		border: 0;
		background: none;
		color: var(--gray-2);
		font: inherit;
		text-align: start;
		white-space: nowrap;
		cursor: pointer;
	}
	.line:hover,
	.line:focus-within {
		background: var(--gray-6);
	}
	.row:hover,
	.row:focus-visible {
		color: var(--white);
		outline: none;
	}
	.kind {
		align-self: center;
		flex: none;
		color: var(--blue-high);
	}
	.name {
		color: var(--white);
		font-family: var(--font-mono);
		font-size: 0.78rem;
	}
	.detail {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--gray-3);
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}
	.where {
		flex: none;
		margin-left: auto;
		color: var(--gray-3);
		font-size: 0.75rem;
	}
	.sites {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		padding: 0.05rem 0.6rem 0.2rem;
	}
	.site {
		padding: 0 0.4rem;
		border: 1px solid var(--gray-5);
		border-radius: 0.25rem;
		background: none;
		color: var(--gray-3);
		font-family: var(--font-mono);
		font-size: 0.72rem;
		cursor: pointer;
	}
	.site:hover,
	.site:focus-visible {
		border-color: var(--gray-4);
		color: var(--white);
		outline: none;
	}
	.note {
		margin: 0.15rem 0;
		color: var(--gray-3);
		font-size: 0.78rem;
	}
	.note.failed {
		color: var(--red-high);
	}
</style>
