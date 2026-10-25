<!--
  How the project is built, in one place: a chip in the top bar that says
  what is chosen (`WASI · -O2`, `x86-64 · -O0 · ASan`) and opens a panel of
  labelled rows, each with a line saying what it does: the C++ target, the
  optimisation level (C++, Swift, Scala), the sanitizers, a Linux target's
  run options, and the C++ test framework.

  These were five controls side by side in the top bar, explained only by
  their tooltips, and they pushed Download, Reset and the theme off the
  right edge at laptop widths.

  The panel can also be opened from elsewhere, anchored to what opened it:
  the ⋯ menu when the chip is folded away, the status bar's build summary,
  and a compiler output view's "Change build settings…", by dispatching
  `BUILD_SETTINGS_EVENT` on window with the opener as its detail.
-->
<script lang="ts" module>
	import { TARGET_SHORT } from '../cpp-targets';
	import type { Workspace } from '../workspace.svelte';

	/** The window event that opens the panel; its `detail` is the element to anchor it to. */
	export const BUILD_SETTINGS_EVENT = 'yk-build-settings';

	/**
	 * The chip's summary of the build: the C++ target's short name, the
	 * optimisation level, the sanitizers on, and a Linux target's CPUs when
	 * more than one. Empty for a language without build settings.
	 */
	export function buildSummary(workspace: Workspace): string {
		const parts: string[] = [];
		const target = workspace.target;
		if (target) parts.push(target.kind === 'unsupported' ? target.triple || 'Other target' : TARGET_SHORT[target.target.id]);
		const o = workspace.optimization;
		if (o) parts.push(o.kind === 'other' ? o.flag : o.level.flag);
		const s = workspace.sanitizers;
		if (s?.address || s?.undefined) parts.push(s.address && s.undefined ? 'ASan + UBSan' : s.address ? 'ASan' : 'UBSan');
		if (target?.kind === 'target' && target.target.runtime === 'linux') {
			const r = workspace.runOptions;
			if (r.emulation === 'user') parts.push('user mode');
			else if (r.cpus > 1) parts.push(`${r.cpus} CPUs`);
			if (r.strace) parts.push('strace');
		}
		return parts.join(' · ');
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import Popover from './Popover.svelte';
	import Sanitizers from './Sanitizers.svelte';
	import { TARGETS, type CppTargetId } from '../cpp-targets';
	import { TEST_FRAMEWORKS, type TestFramework } from '../cpp-tests';
	import { levelsOf } from '../optimization';

	let { workspace }: { workspace: Workspace } = $props();

	let popover = $state<Popover>();
	let open = $state(false);

	const cpp = $derived(workspace.language === 'cpp');
	const summary = $derived(buildSummary(workspace));
	/** A C++ project on a Linux target: Run options apply (to Run and Test). */
	const linuxTarget = $derived(workspace.target?.kind === 'target' && workspace.target.target.runtime === 'linux');
	const targetValue = $derived(!workspace.target ? '' : workspace.target.kind === 'unsupported' ? 'other' : workspace.target.target.id);
	/** The optimisation levels of the project's language, null for one without them (optimization.ts). */
	const levels = $derived(workspace.optimization ? levelsOf(workspace.language) : null);
	const levelValue = $derived(!workspace.optimization ? '' : workspace.optimization.kind === 'other' ? 'other' : workspace.optimization.level.flag);
	const levelHelp = $derived(
		workspace.language === 'cpp'
			? 'The level Run, Test and the IR and assembly views compile at. Rewrites the -O line of compile_flags.txt.'
			: workspace.language === 'scala'
				? 'Whether Run links with the Scala.js optimizer, as sbt fastLinkJS does. It adds about a second to each Run.'
				: 'The level Run and Test compile at, saved with the project and written into Package.swift by Download.',
	);

	onMount(() => {
		const opened = (e: Event) => {
			const from = (e as CustomEvent<HTMLElement | null>).detail;
			if (from) popover?.show(from);
		};
		addEventListener(BUILD_SETTINGS_EVENT, opened);
		return () => removeEventListener(BUILD_SETTINGS_EVENT, opened);
	});
</script>

<button class="btn build-chip" data-fold="30" popovertarget="build-settings" aria-expanded={open} aria-label="Build settings: {summary}" title="Build settings: {summary}">
	<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></svg>
	<span class="build-word">Build</span>
	<span class="build-summary truncate">{summary}</span>
	<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
</button>

<Popover bind:this={popover} id="build-settings" label="Build settings" class="build-settings" ontoggle={(o) => (open = o)}>
	<h2>Build settings</h2>
	<div class="rows">
		{#if cpp}
			<!-- The target is compile_flags.txt's --target line (cpp-targets.ts): choosing one rewrites it; a hand-edited one is shown as it is. -->
			<label class="row target">
				<span class="name">Target</span>
				<span class="field">
					<select
						value={targetValue}
						onchange={(e) => {
							if (e.currentTarget.value !== 'other') workspace.chooseTarget(e.currentTarget.value as CppTargetId);
							e.currentTarget.value = targetValue;
						}}
					>
						{#each TARGETS as t (t.id)}
							<option value={t.id}>{t.label}</option>
						{/each}
						{#if workspace.target?.kind === 'unsupported'}
							<option value="other" disabled>Other ({workspace.target.triple || 'no triple'})</option>
						{/if}
					</select>
					<small>What the code is compiled for and runs on. Rewrites <code>--target</code> in compile_flags.txt.</small>
				</span>
			</label>
		{/if}
		{#if levels && workspace.optimization}
			<!-- C and C++: compile_flags.txt's -O line (optimization.ts), shown as it is when hand-edited; Swift and Scala: saved with the project. -->
			<label class="row optimization">
				<span class="name">Optimization</span>
				<span class="field">
					<select
						value={levelValue}
						onchange={(e) => {
							if (e.currentTarget.value !== 'other') workspace.chooseOptimization(e.currentTarget.value);
							e.currentTarget.value = levelValue;
						}}
					>
						{#each levels as l (l.flag)}
							<option value={l.flag} disabled={!!l.unavailable} title={l.unavailable ?? ''}>{l.label}{l.default ? ' (default)' : ''}{l.unavailable ? ' (not available yet)' : ''}</option>
						{/each}
						{#if workspace.optimization.kind === 'other'}
							<option value="other" disabled>{workspace.optimization.flag}</option>
						{/if}
					</select>
					<small>{levelHelp}</small>
				</span>
			</label>
		{/if}
		{#if cpp}
			<!-- The -fsanitize= line of compile_flags.txt (cpp-sanitizers.ts): ticking one rewrites it; a hand-written one is honoured. -->
			<div class="row" role="group" aria-label="Sanitizers">
				<span class="name">Sanitizers</span>
				<span class="field"><Sanitizers {workspace} /></span>
			</div>
			{#if linuxTarget}
				<!-- Loaded the first time a project is on a Linux target: most sessions never need it. -->
				<div class="row" role="group" aria-label="Run options">
					<span class="name">Run options</span>
					<span class="field">
						{#await import('./RunOptions.svelte') then { default: RunOptions }}
							<RunOptions {workspace} />
						{/await}
					</span>
				</div>
			{/if}
			<hr />
			<!-- What tests/ includes is the framework; choosing one converts the sample's tests or adds a sample test. -->
			<label class="row framework">
				<span class="name">Test framework</span>
				<span class="field">
					<select
						value={workspace.testFramework ?? ''}
						onchange={(e) => {
							workspace.chooseTestFramework(e.currentTarget.value as TestFramework);
							e.currentTarget.value = workspace.testFramework ?? '';
						}}
					>
						{#if workspace.testFramework === null || workspace.testFramework === 'mixed'}
							<option value={workspace.testFramework ?? ''} disabled>{workspace.testFramework === 'mixed' ? 'Mixed frameworks' : 'Test framework'}</option>
						{/if}
						{#each TEST_FRAMEWORKS as f (f.id)}
							<option value={f.id}>{f.label}</option>
						{/each}
					</select>
					<small>Changing it rewrites the files in tests/, or adds a sample test.</small>
				</span>
			</label>
		{/if}
	</div>
</Popover>

<style>
	.build-chip {
		max-width: 16rem;
	}
	.build-chip svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}
	.build-chip .chevron {
		width: 0.75rem;
		height: 0.75rem;
		stroke-width: 2;
	}
	/* "Build" shows only when the summary is folded away (app.css, the bar's tiers). */
	.build-word {
		display: none;
	}
	.build-summary {
		color: var(--white);
		font-family: var(--font-mono);
		font-size: 0.78rem;
	}
	:global(.build-settings) {
		width: 30rem;
		padding: 0.75rem 0.9rem 0.9rem !important;
	}
	h2 {
		margin: 0 0 0.6rem;
		font-size: 0.95rem;
	}
	.rows {
		display: grid;
		gap: 0.85rem;
	}
	.row {
		display: grid;
		grid-template-columns: 7rem minmax(0, 1fr);
		gap: 0.75rem;
		align-items: start;
	}
	.name {
		padding-top: 0.3rem;
		color: var(--gray-2);
		font-weight: 600;
	}
	.field {
		display: grid;
		gap: 0.3rem;
		min-width: 0;
	}
	.field > select {
		justify-self: start;
		max-width: 100%;
		min-height: 2rem;
		padding: 0 0.5rem;
		border: 1px solid var(--control-border);
		border-radius: 0.35rem;
		background: var(--gray-7);
		color: var(--white);
		font: inherit;
	}
	small {
		color: var(--gray-3);
		font-size: 0.75rem;
		line-height: 1.35;
	}
	code {
		font-size: 0.72rem;
		white-space: nowrap;
	}
	hr {
		width: 100%;
		margin: 0;
		border: 0;
		border-top: 1px solid var(--gray-5);
	}
	/* A phone: the label above its control. */
	@media (width < 30rem) {
		.row {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.3rem;
		}
		.name {
			padding-top: 0;
		}
	}
</style>
