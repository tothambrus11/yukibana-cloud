<!--
  The tools' log: the language server's messages and stderr, and what the
  client reports (a failed start, a request that errored); a run's side
  channel (the guest kernel, timings); the app's own notes (a setting
  changed, a download made). Never the program's output, which is the
  terminal's: each line names who wrote it so that none reads as if it were.
-->
<script lang="ts">
	import type { LogSource, Workspace } from '../workspace.svelte';

	let { workspace }: { workspace: Workspace } = $props();

	let scroller: HTMLDivElement | undefined = $state();
	let follow = true;

	$effect(() => {
		void workspace.log.length;
		if (scroller && follow) scroller.scrollTop = scroller.scrollHeight;
	});

	const time = (d: Date) => d.toLocaleTimeString(undefined, { hour12: false });

	/** The tag beside a line, and what its tooltip says it means. */
	const SOURCES: Record<LogSource, { tag: string; says: string }> = {
		server: { tag: 'server', says: 'The language server' },
		run: { tag: 'run', says: 'The run, beside the program: timings, the emulated machine' },
		app: { tag: 'app', says: 'Light itself' },
	};
</script>

<div class="log-panel">
	<div class="lines" bind:this={scroller} onscroll={(e) => {
		const el = e.currentTarget;
		follow = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
	}}>
		{#if workspace.log.length === 0}
			<p class="empty">Messages from the language server, the compiler and the runner appear here. Your program's output is in the Terminal.</p>
		{/if}
		{#each workspace.log as line (line.id)}
			<div class="line {line.level}"><span class="time">{time(line.time)}</span><span class="source" title={SOURCES[line.source].says}>{SOURCES[line.source].tag}</span>{line.text}</div>
		{/each}
	</div>
	<button class="clear" title="Clear the log" onclick={() => workspace.clearLog()}>Clear</button>
</div>

<style>
	.log-panel {
		position: relative;
		height: 100%;
	}
	.lines {
		height: 100%;
		overflow: auto;
		padding: 0.5rem 0;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		line-height: 1.55;
	}
	.empty {
		margin: 0.2rem 1rem;
		color: var(--gray-3);
		font-family: var(--font);
		font-size: 0.8125rem;
	}
	.line {
		padding: 0 1rem;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--gray-2);
	}
	.line.error {
		color: var(--red-high);
	}
	.line.warning {
		color: var(--orange-high);
	}
	.line.log {
		color: var(--gray-3);
	}
	.time {
		margin-right: 0.75rem;
		color: var(--gray-4);
	}
	.source {
		display: inline-block;
		/* As wide as the widest tag, so the messages start in one column. */
		min-width: 7ch;
		margin-right: 0.6rem;
		color: var(--gray-3);
	}
	.clear {
		position: absolute;
		top: 0.4rem;
		right: 0.9rem;
		padding: 0.15rem 0.55rem;
		border: 1px solid var(--gray-5);
		border-radius: 0.35rem;
		background: var(--gray-6);
		color: var(--gray-2);
		font: inherit;
		font-size: 0.75rem;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.log-panel:hover .clear,
	.clear:focus-visible {
		opacity: 1;
	}
	.clear:hover {
		color: var(--white);
	}
</style>
