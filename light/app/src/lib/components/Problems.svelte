<!--
  Every diagnostic in the project, grouped by file; clicking one shows it in
  the editor.
-->
<script lang="ts">
	import type { Severity } from '../severity';
	import type { Workspace } from '../workspace.svelte';

	let { workspace }: { workspace: Workspace } = $props();

	const groups = $derived.by(() => {
		const byPath = new Map<string, typeof workspace.problems>();
		for (const p of workspace.problems) byPath.set(p.path, [...(byPath.get(p.path) ?? []), p]);
		return [...byPath];
	});

	/** The marker's class: hints are drawn as infos. */
	const kind = (s: Severity) => (s === 'error' || s === 'warning' ? s : 'info');
</script>

<div class="problems">
	{#if workspace.problems.length === 0}
		<p class="empty">No problems{workspace.clientState.kind === 'running' ? '' : ' reported yet'}.</p>
	{/if}
	{#each groups as [path, problems] (path)}
		<div class="file">{path} <span class="count">{problems.length}</span></div>
		{#each problems as { severity, message, source, range }, i (i)}
			<button class="problem" onclick={() => workspace.show(path, range)}>
				<span class="sev {kind(severity)}" aria-label={kind(severity)}></span>
				<span class="message">{message}</span>
				<span class="where">{source ? source + ' · ' : ''}{range.startLineNumber}:{range.startColumn}</span>
			</button>
		{/each}
	{/each}
</div>

<style>
	.problems {
		height: 100%;
		overflow: auto;
		padding: 0.4rem 0;
		font-size: 0.8125rem;
	}
	.empty {
		margin: 0.6rem 1rem;
		color: var(--gray-3);
	}
	.file {
		padding: 0.35rem 1rem 0.2rem;
		color: var(--white);
		font-weight: 600;
	}
	.count {
		margin-left: 0.3rem;
		color: var(--gray-3);
		font-weight: 400;
	}
	.problem {
		display: flex;
		align-items: baseline;
		gap: 0.55rem;
		width: 100%;
		padding: 0.2rem 1rem 0.2rem 1.6rem;
		border: 0;
		background: none;
		color: var(--gray-2);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.problem:hover,
	.problem:focus-visible {
		background: var(--gray-6);
		color: var(--white);
		outline: none;
	}
	.sev {
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		transform: translateY(-0.05rem);
	}
	.sev.error {
		background: var(--red-high);
	}
	.sev.warning {
		background: var(--orange-high);
	}
	.sev.info {
		background: var(--blue-high);
	}
	.message {
		flex: 1;
		white-space: pre-wrap;
		font-family: var(--font-mono);
		font-size: 0.78rem;
	}
	.where {
		flex: none;
		color: var(--gray-3);
		font-size: 0.75rem;
	}
</style>
