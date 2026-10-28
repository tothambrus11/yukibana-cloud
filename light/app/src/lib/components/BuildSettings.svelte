<!--
  How the project is built, in one place: a chip in the top bar that says
  what is chosen (`WASI · -O2`, `x86-64 · -O0 · ASan`) and opens a panel of
  labelled rows, each with a line saying what it does: the C or C++ target
  and language standard, the optimisation level (C, C++, Swift, Scala), the
  sanitizers, a Linux target's run options, the C++ test framework, and
  clang-tidy (on or off, and its rules, in their own dialog, TidyRules).

  These were five controls side by side in the top bar, explained only by
  their tooltips, and they pushed Download, Reset and the theme off the
  right edge at laptop widths.

  The panel can also be opened from elsewhere, anchored to what opened it:
  the ⋯ menu when the chip is folded away, the status bar's build summary,
  and a compiler output view's "Change build settings…", by dispatching
  `BUILD_SETTINGS_EVENT` (build-settings.ts) on window with the opener as
  its detail.
-->
<script lang="ts">
	import { onMount, tick, type Component } from 'svelte';
	import Popover from './Popover.svelte';
	import { BUILD_SETTINGS_EVENT, buildSummary } from '../build-settings';
	import type { Workspace } from '../workspace.svelte';
	import Sanitizers from './Sanitizers.svelte';
	import { TARGETS, type CppTargetId } from '../cpp-targets';
	import { TEST_FRAMEWORKS, type TestFramework } from '../cpp-tests';
	import { levelsOf } from '../optimization';
	import { isCFamily } from '../languages';
	import { CPP_STANDARDS, C_STANDARDS, describeStandard, defaultStandard } from '../cpp-standards';
	import { describeTidy } from '../tidy-config';

	let { workspace }: { workspace: Workspace } = $props();

	let popover = $state<Popover>();
	let open = $state(false);

	const cpp = $derived(workspace.language === 'cpp');
	const cFamily = $derived(isCFamily(workspace.language));
	const standards = $derived(workspace.language === 'c' ? C_STANDARDS : CPP_STANDARDS);
	const standardValue = $derived(!workspace.standard ? '' : workspace.standard.kind === 'standard' ? workspace.standard.standard.iso : workspace.standard.kind);
	/** Whether the standard is spelt with GNU extensions; the default is clang's, which has them. */
	const gnu = $derived(workspace.standard?.kind === 'standard' || workspace.standard?.kind === 'default' ? workspace.standard.gnu : false);

	/** The clang-tidy rule editor, loaded the first time it is opened. */
	let Rules = $state<Component<{ workspace: Workspace }, { show(): void }>>();
	let rules = $state<{ show(): void }>();
	async function openRules(): Promise<void> {
		Rules ??= (await import('./TidyRules.svelte')).default;
		await tick();
		rules?.show();
	}
	const summary = $derived(buildSummary(workspace));
	/** A C++ project on a Linux target: Run options apply (to Run and Test). */
	const linuxTarget = $derived(workspace.target?.kind === 'target' && workspace.target.target.runtime === 'linux');
	const targetValue = $derived(!workspace.target ? '' : workspace.target.kind === 'unsupported' ? 'other' : workspace.target.target.id);
	/** The optimisation levels of the project's language, null for one without them (optimization.ts). */
	const levels = $derived(workspace.optimization ? levelsOf(workspace.language) : null);
	const levelValue = $derived(!workspace.optimization ? '' : workspace.optimization.kind === 'other' ? 'other' : workspace.optimization.level.flag);
	const levelHelp = $derived(
		cFamily
			? `The level Run${cpp ? ', Test' : ''} and the IR and assembly views compile at. Rewrites the -O line of compile_flags.txt.`
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
		{#if cFamily}
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
			{#if workspace.standard}
				<!-- compile_flags.txt's -std= line for the project's language (cpp-standards.ts): choosing one rewrites it; a hand-written one is shown as it is. -->
				<div class="row standard" role="group" aria-label="Standard">
					<span class="name">Standard</span>
					<span class="field">
						<span class="inline">
							<select
								aria-label="Language standard"
								value={standardValue}
								onchange={(e) => {
									const value = e.currentTarget.value;
									const standard = standards.find((s) => s.iso === value);
									if (value === 'default') workspace.chooseStandard('default');
									else if (standard) workspace.chooseStandard({ standard, gnu: workspace.standard?.kind === 'standard' && workspace.standard.gnu });
									e.currentTarget.value = standardValue;
								}}
							>
								<option value="default">Default ({describeStandard({ kind: 'standard', ...defaultStandard(workspace.language === 'c' ? 'c' : 'cpp') })})</option>
								{#each standards as s (s.iso)}
									<option value={s.iso}>{s.label}{s.draft ? ' (draft)' : ''}</option>
								{/each}
								{#if workspace.standard.kind === 'other'}
									<option value="other" disabled>-std={workspace.standard.value}</option>
								{/if}
							</select>
							<label class="check" title="The GNU dialect (-std=gnu++20 rather than -std=c++20): GNU's extensions to the language, on by default in clang">
								<input
									type="checkbox"
									checked={gnu}
									disabled={workspace.standard.kind !== 'standard'}
									onchange={(e) => {
										const s = workspace.standard;
										if (s?.kind === 'standard') workspace.chooseStandard({ standard: s.standard, gnu: e.currentTarget.checked });
									}}
								/>
								GNU extensions
							</label>
						</span>
						<small>The language version clangd, Run and the views compile with. Rewrites <code>-std=</code> in compile_flags.txt.</small>
					</span>
				</div>
			{/if}
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
		{#if cFamily}
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
			<!-- On or off is saved with the project; the rules are its .clang-tidy, which the dialog edits. -->
			<div class="row tidy" role="group" aria-label="clang-tidy">
				<span class="name">clang-tidy</span>
				<span class="field">
					<label class="check">
						<input type="checkbox" checked={workspace.clangTidy} onchange={(e) => workspace.setClangTidy(e.currentTarget.checked)} />
						Check the code as you type
					</label>
					<small>{describeTidy(workspace.clangTidy, workspace.tidyStatus)} Its rules are the project's .clang-tidy.</small>
					<button class="btn rules-button" onclick={() => void openRules()}>Edit rules…</button>
				</span>
			</div>
		{/if}
		{#if cpp}
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

{#if Rules}
	<Rules bind:this={rules} {workspace} />
{/if}

<style>
	.build-chip {
		max-width: 19rem;
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
		--popover-width: 30rem;
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
	.inline {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.9rem;
	}
	.inline > select,
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
	.check {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		cursor: pointer;
	}
	.tidy .check {
		padding-top: 0.3rem;
	}
	.rules-button {
		justify-self: start;
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
