<!--
  The Debug panel: the session's buttons (Continue or Pause, Step Over,
  Step Into, Step Out, Stop), where the program stopped and why, its call
  stack (a row shows that frame's line and variables) and the selected
  frame's variables as a tree, each opened on demand. Breakpoints are set
  in the editors' margin (debug.svelte.ts, decorate); this lists them.
-->
<script lang="ts">
	import type { Variable } from '../debug.svelte';
	import type { Workspace } from '../workspace.svelte';
	import { languageOf } from '../languages';

	let { workspace }: { workspace: Workspace } = $props();

	const dbg = $derived(workspace.debugger);
	const status = $derived(dbg.status);
	const stopped = $derived(status.kind === 'stopped');
	const language = $derived(languageOf(workspace.language));
	/** Opened variables, by the path of names from their scope. */
	let open = $state<Record<string, boolean>>({});
	const breakpoints = $derived(Object.entries(dbg.breakpoints).flatMap(([path, lines]) => lines.map((line) => ({ path, line }))));

	const REASONS: Record<string, string> = {
		breakpoint: 'Paused at a breakpoint',
		step: 'Paused after a step',
		pause: 'Paused',
		entry: 'Paused at the start',
		exception: 'The program crashed',
		signal: 'The program crashed',
		'function breakpoint': 'Paused at a breakpoint',
	};

	async function toggle(key: string, v: Variable) {
		const next = !open[key];
		open = { ...open, [key]: next };
		if (next) await dbg.expand(v.ref);
	}
</script>

{#snippet variables(list: Variable[], prefix: string, depth: number)}
	<ul role="group">
		{#each list as v, i (prefix + i)}
			{@const key = `${prefix}/${v.name}`}
			<li role="treeitem" aria-expanded={v.ref ? (open[key] ?? false) : undefined} aria-selected="false">
				<div class="var" style:padding-left="{0.4 + depth * 0.9}rem">
					{#if v.ref}
						<button class="twisty" aria-label={open[key] ? 'Collapse' : 'Expand'} onclick={() => void toggle(key, v)}>
							<span class="codicon {open[key] ? 'codicon-chevron-down' : 'codicon-chevron-right'}"></span>
						</button>
					{:else}
						<span class="twisty"></span>
					{/if}
					<span class="name">{v.name}</span>
					{#if v.value}<span class="value" title={v.type ? `${v.type}: ${v.value}` : v.value}>{v.value}</span>{/if}
					{#if v.type}<span class="type">{v.type}</span>{/if}
				</div>
				{#if v.ref && open[key]}
					{#if dbg.children[v.ref]}
						{@render variables(dbg.children[v.ref]!, key, depth + 1)}
					{:else}
						<p class="note" style:padding-left="{1.5 + depth * 0.9}rem">Reading…</p>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<div class="debug">
	<div class="toolbar" role="toolbar" aria-label="Debugger">
		{#if dbg.active}
			{#if stopped}
				<button title="Continue (F5)" aria-label="Continue" onclick={() => dbg.continue()}><span class="codicon codicon-debug-continue"></span></button>
			{:else}
				<button title="Pause" aria-label="Pause" disabled={status.kind !== 'running'} onclick={() => dbg.pause()}><span class="codicon codicon-debug-pause"></span></button>
			{/if}
			<button title="Step Over (F10)" aria-label="Step Over" disabled={!stopped} onclick={() => dbg.next()}><span class="codicon codicon-debug-step-over"></span></button>
			<button title="Step Into (F11)" aria-label="Step Into" disabled={!stopped} onclick={() => dbg.stepIn()}><span class="codicon codicon-debug-step-into"></span></button>
			<button title="Step Out (Shift+F11)" aria-label="Step Out" disabled={!stopped} onclick={() => dbg.stepOut()}><span class="codicon codicon-debug-step-out"></span></button>
			<button class="stop" title="Stop debugging" aria-label="Stop" onclick={() => dbg.end()}><span class="codicon codicon-debug-stop"></span></button>
		{:else}
			<button class="start" disabled={!language.debugs || workspace.runner.busy} onclick={() => workspace.debug()} title={language.debugs ? 'Run the project under the debugger (F5)' : `${language.label} has no debugger yet`}>
				<span class="codicon codicon-debug-alt"></span> Debug
			</button>
		{/if}
		<span class="state" role="status">
			{#if status.kind === 'starting'}
				{status.text}…
			{:else if status.kind === 'running'}
				Running
			{:else if status.kind === 'stopped'}
				{REASONS[status.reason] ?? 'Paused'}{status.description && status.reason !== 'breakpoint' && status.reason !== 'step' ? `: ${status.description}` : ''}
			{:else if status.kind === 'ended'}
				{status.text}
			{/if}
		</span>
	</div>

	<div class="body">
		{#if !dbg.active && status.kind !== 'ended'}
			<p class="empty">
				{#if language.debugs}
					Click left of a line number to set a breakpoint, then Debug: the program stops there, and its call stack and variables show here.
				{:else}
					The debugger runs C, C++ and Swift programs for now.
				{/if}
			</p>
		{/if}

		{#if stopped}
			<section aria-label="Call stack">
				<h3>Call stack</h3>
				<ul class="frames">
					{#each dbg.frames as frame, i (frame.id)}
						<li>
							<button class="frame" class:selected={i === dbg.selected} class:outside={!frame.path} onclick={() => void dbg.select(i)} title={frame.file ?? ''}>
								<span class="fn">{frame.name}</span>
								<span class="where">{frame.path ?? frame.file?.split('/').pop() ?? '?'}{frame.line ? `:${frame.line}` : ''}</span>
							</button>
						</li>
					{/each}
				</ul>
			</section>
			<section aria-label="Variables">
				<h3>Variables</h3>
				{#each dbg.scopes as scope (scope.ref)}
					{@const children = dbg.children[scope.ref]}
					{#if children}
						{#if dbg.scopes.length > 1}<h4>{scope.name}</h4>{/if}
						{#if children.length}
							<div class="tree" role="tree" aria-label={scope.name}>{@render variables(children, scope.name, 0)}</div>
						{:else}
							<p class="note">None.</p>
						{/if}
					{:else}
						<button class="scope" onclick={() => void dbg.expand(scope.ref)}>{scope.name}…</button>
					{/if}
				{/each}
			</section>
		{/if}

		{#if breakpoints.length}
			<section aria-label="Breakpoints">
				<h3>Breakpoints</h3>
				<ul class="breakpoints">
					{#each breakpoints as bp (`${bp.path}:${bp.line}`)}
						<li>
							<button class="bp" onclick={() => workspace.show(bp.path, { startLineNumber: bp.line, startColumn: 1, endLineNumber: bp.line, endColumn: 1 })}>
								<span class="dot" aria-hidden="true"></span>{bp.path}:{bp.line}
							</button>
							<button class="remove" title="Remove this breakpoint" aria-label="Remove breakpoint {bp.path}:{bp.line}" onclick={() => dbg.toggleBreakpoint(bp.path, bp.line)}>
								<span class="codicon codicon-close"></span>
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>
</div>

<style>
	.debug {
		display: flex;
		flex-direction: column;
		height: 100%;
		font-size: 0.8125rem;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		padding: 0.3rem 0.5rem;
		border-bottom: 1px solid var(--gray-5);
	}
	.toolbar button {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		height: 1.6rem;
		min-width: 1.6rem;
		justify-content: center;
		padding: 0 0.35rem;
		border: 1px solid transparent;
		border-radius: 0.3rem;
		background: none;
		color: var(--gray-2);
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.toolbar button:hover:not(:disabled),
	.toolbar button:focus-visible {
		background: var(--gray-6);
		color: var(--white);
		outline: none;
	}
	.toolbar button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.toolbar .start {
		border-color: var(--gray-5);
		padding: 0 0.6rem;
	}
	.toolbar .stop {
		color: var(--red, #e5534b);
	}
	.state {
		min-width: 0;
		margin-left: 0.5rem;
		overflow: hidden;
		color: var(--gray-3);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.body {
		flex: 1;
		overflow: auto;
		padding-bottom: 0.5rem;
	}
	.empty,
	.note {
		margin: 0.5rem 0.9rem;
		color: var(--gray-3);
	}
	h3 {
		margin: 0.6rem 0.8rem 0.2rem;
		color: var(--gray-3);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	h4 {
		margin: 0.3rem 0.8rem 0.1rem;
		color: var(--gray-3);
		font-size: 0.75rem;
		font-weight: 500;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.frame,
	.bp,
	.scope {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		width: 100%;
		padding: 0.15rem 0.8rem;
		border: 0;
		background: none;
		color: var(--gray-2);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.frame:hover,
	.bp:hover,
	.scope:hover {
		background: var(--gray-6);
		color: var(--white);
	}
	.frame.selected {
		background: var(--gray-6);
		color: var(--white);
	}
	.frame.outside {
		color: var(--gray-3);
	}
	.fn {
		min-width: 0;
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.where {
		flex: none;
		margin-left: auto;
		color: var(--gray-3);
		font-size: 0.75rem;
	}
	.var {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		min-width: 0;
		padding-right: 0.6rem;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		white-space: nowrap;
	}
	.var:hover {
		background: var(--gray-6);
	}
	.twisty {
		display: inline-grid;
		place-items: center;
		flex: none;
		align-self: center;
		width: 1.1rem;
		height: 1.35rem;
		padding: 0;
		border: 0;
		background: none;
		color: var(--gray-3);
		cursor: pointer;
	}
	.name {
		color: var(--blue-high);
	}
	.value {
		min-width: 0;
		overflow: hidden;
		color: var(--white);
		text-overflow: ellipsis;
	}
	.type {
		flex: none;
		margin-left: auto;
		padding-left: 0.6rem;
		color: var(--gray-3);
		font-size: 0.72rem;
	}
	.breakpoints li {
		display: flex;
		align-items: center;
	}
	.bp {
		align-items: center;
		font-family: var(--font-mono);
		font-size: 0.78rem;
	}
	.dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: #e5534b;
	}
	.remove {
		flex: none;
		padding: 0 0.5rem;
		border: 0;
		background: none;
		color: var(--gray-3);
		cursor: pointer;
	}
	.remove:hover {
		color: var(--white);
	}
</style>
