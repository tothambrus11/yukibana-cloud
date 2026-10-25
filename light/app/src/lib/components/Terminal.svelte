<!--
  The program's terminal: what it printed (errors in red, and the colours
  the program asked for with ANSI escapes, see ansi.ts), its system calls
  when strace is on (dimmed), what was typed, and an input line. Enter sends the line; Ctrl+D ends the input.
  A project file's path and line in the output (a compiler's diagnostic, a
  sanitizer's frame) is a link to that line (terminal-links.ts).
-->
<script lang="ts">
	import type { Workspace } from '../workspace.svelte';
	import { linksIn, type Place } from '../terminal-links';

	let { workspace }: { workspace: Workspace } = $props();
	const runner = $derived(workspace.runner);
	const files = $derived(new Set(workspace.files));

	/** Opens a link's file, the caret at its line and column (the line's start without one). */
	const go = ({ path, line, column }: Place) => workspace.show(path, { startLineNumber: line, startColumn: column ?? 1, endLineNumber: line, endColumn: column ?? 1 });

	let scroller: HTMLDivElement | undefined = $state();
	let field: HTMLInputElement | undefined = $state();
	let line = $state('');
	let follow = true;

	$effect(() => {
		// Follow the output while the user has not scrolled up.
		for (const c of runner.chunks) void c.text.length;
		if (scroller && follow) scroller.scrollTop = scroller.scrollHeight;
	});

	const waiting = $derived(runner.state.kind === 'running' && runner.state.waiting);
	$effect(() => {
		if (waiting) field?.focus();
	});

	function keydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			runner.input(line);
			line = '';
		} else if (e.key === 'd' && e.ctrlKey && line === '') {
			e.preventDefault();
			runner.endInput();
		}
	}

	const status = $derived.by(() => {
		const s = runner.state;
		switch (s.kind) {
			case 'idle':
				return '';
			case 'queued':
				return `Waiting for ${s.behind.snippet} to finish${s.behind.waitingForInput ? ', which is waiting for input' : ''}`;
			case 'loading': {
				const p = s.progress;
				return p === null ? 'Starting…' : `Loading ${p.label}${p.total ? ` ${Math.round((100 * p.loaded) / p.total)}%` : ''}`;
			}
			case 'running':
				return s.waiting ? 'Waiting for input' : `${s.phase}…`;
			case 'ended':
				return `Exited with code ${s.code} after ${s.seconds.toFixed(1)} s`;
			case 'stopped':
				return `Stopped after ${s.seconds.toFixed(1)} s`;
			case 'unavailable':
				return 'Cannot run on this page';
			case 'failed':
				return s.failure.kind === 'replaced' ? 'Reload the page to run' : 'The runner failed';
		}
	});
	const failed = $derived((runner.state.kind === 'ended' && runner.state.code !== 0) || runner.state.kind === 'failed' || runner.state.kind === 'unavailable');
	/** The status in a few characters, for a terminal narrower than its sentence ("✓ 0 · 7.2 s"); the sentence stays its title and what is announced. */
	const compact = $derived.by(() => {
		const s = runner.state;
		if (s.kind === 'ended') return `${s.code === 0 ? '✓' : '✗'} ${s.code} · ${s.seconds.toFixed(1)} s`;
		if (s.kind === 'stopped') return `■ ${s.seconds.toFixed(1)} s`;
		return status;
	});
</script>

<div class="terminal">
	<div class="lines" bind:this={scroller} onscroll={(e) => {
		const el = e.currentTarget;
		follow = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
	}}>
		{#if runner.chunks.length === 0 && runner.state.kind === 'idle'}
			<p class="empty">Press <strong>Run</strong> (Ctrl+Enter) to run the project. Its output appears here.</p>
		{/if}
		<pre>{#each runner.chunks as chunk (chunk.id)}<span class={chunk.kind} style={chunk.style || undefined}>{#if chunk.kind === 'stdin'}{chunk.text}{:else}{#each linksIn(chunk.text, files) as piece, i (i)}{#if piece.place}<button class="place" title="Open {piece.place.path} at line {piece.place.line}" onclick={() => piece.place && go(piece.place)}>{piece.text}</button>{:else}{piece.text}{/if}{/each}{/if}</span>{/each}</pre>
	</div>
	{#if runner.busy}
		<label class="input" class:waiting>
			<span class="prompt" aria-hidden="true">›</span>
			<span class="sr-only">Input for the program</span>
			<input bind:this={field} bind:value={line} onkeydown={keydown} spellcheck="false" autocomplete="off" placeholder={waiting ? 'The program is waiting for input' : 'Input (Enter to send, Ctrl+D to end)'} />
		</label>
	{/if}
	<div class="footer">
		<!-- The sentence is what is announced and what a narrow terminal shows in its title; the compact form is only drawn. -->
		<span class="status truncate" class:failed role="status" title={status || undefined}>{status}</span>
		<span class="status-compact truncate" class:failed aria-hidden="true" title={status || undefined}>{compact}</span>
		<button class="icon-btn clear" title="Clear the terminal" aria-label="Clear the terminal" onclick={() => runner.clear()}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>
		</button>
	</div>
</div>

<style>
	.terminal {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.lines {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 0.5rem 1rem;
	}
	pre {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.8rem;
		line-height: 1.55;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--white);
	}
	.stderr {
		color: var(--red-high);
	}
	.place {
		display: inline;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-decoration: underline dotted;
		text-underline-offset: 0.2em;
		cursor: pointer;
		user-select: text;
	}
	.place:hover {
		color: var(--accent-high);
		text-decoration-style: solid;
	}
	.stdin {
		color: var(--accent-high);
	}
	.info {
		color: var(--gray-3);
		font-style: italic;
	}
	/* System calls (strace on a Linux target): there to read when wanted, not to compete with the output. */
	.trace {
		color: var(--gray-4);
		font-style: italic;
	}
	.empty {
		margin: 0.2rem 0;
		color: var(--gray-3);
		font-size: 0.8125rem;
	}
	.input {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0.75rem 0.4rem;
		padding: 0 0.6rem;
		border: 1px solid var(--gray-5);
		border-radius: 0.35rem;
		background: var(--gray-6);
	}
	.input.waiting {
		border-color: var(--accent-high);
	}
	.prompt {
		color: var(--accent-high);
		font-family: var(--font-mono);
	}
	.input input {
		flex: 1;
		min-width: 0;
		height: 1.9rem;
		border: 0;
		outline: 0;
		background: none;
		color: var(--white);
		font-family: var(--font-mono);
		font-size: 0.8rem;
	}
	.footer {
		container: terminal-footer / inline-size;
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0 0.25rem 0 1rem;
		border-top: 1px solid var(--gray-5);
		color: var(--gray-3);
		font-size: 0.75rem;
		min-height: 2rem;
	}
	.status,
	.status-compact {
		flex: 1;
	}
	.status-compact {
		display: none;
	}
	.failed {
		color: var(--red-high);
	}
	.clear {
		color: var(--gray-3);
	}
	.clear svg {
		width: 1rem;
		height: 1rem;
	}
	/* A terminal a phone's width: the sentence gives way to its compact form. */
	@container terminal-footer (width < 20rem) {
		.status {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
		.status-compact {
			display: block;
		}
	}
</style>
