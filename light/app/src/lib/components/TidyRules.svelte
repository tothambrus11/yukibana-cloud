<!--
  The clang-tidy rules of a C or C++ project: a view of the `Checks` of its
  .clang-tidy (tidy-config.ts), opened from Build settings. Every check the
  pack's clang-tidy has is listed (tidy-checks.json, which the pack's build
  makes from clang-tidy's own documentation) with what it finds and whether
  it is on; the search box narrows the list by name, a pattern
  (`modernize-*`) or any part of a name (`const`), and "Turn on" and "Turn
  off" act on everything it matches, as one glob. Each change rewrites the
  `Checks` key alone, as one edit Undo takes back; clangd reads the file
  again and the diagnostics follow.

  Loaded the first time it is opened: most sessions never need it.
-->
<script lang="ts">
	import { appPacks, packOf } from '../packs';
	import { languageOf } from '../languages';
	import { checksOf, describeTidy, docsUrl, globOfSearch, globText, isEnabled, isTidyChecks, matches, setChecks, TIDY_FILE, type CheckGlob, type TidyChecks } from '../tidy-config';
	import type { Workspace } from '../workspace.svelte';

	let { workspace }: { workspace: Workspace } = $props();

	let dialog: HTMLDialogElement;
	let searchBox = $state<HTMLInputElement>();
	let catalogue = $state.raw<TidyChecks | null>(null);
	let loadError = $state<string | null>(null);
	let search = $state('');
	let filter = $state<'all' | 'on' | 'off'>('all');

	/** Opens the dialog, reading the pack's list of checks the first time. */
	export function show(): void {
		dialog.showModal();
		searchBox?.focus();
		if (!catalogue) void load();
	}

	async function load(): Promise<void> {
		loadError = null;
		try {
			const response = await fetch(appPacks().url(packOf(languageOf(workspace.language)), 'tidy-checks.json'));
			if (!response.ok) throw new Error(`tidy-checks.json: ${response.status} ${response.statusText}`);
			const value: unknown = await response.json();
			if (!isTidyChecks(value)) throw new Error('tidy-checks.json is not a list of checks');
			catalogue = value;
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		}
	}

	/** The rules as they are; no `Checks` key is no rules of the project's own. */
	const globs = $derived(workspace.tidyChecks ?? []);
	const names = $derived(catalogue?.checks.map((c) => c.name) ?? []);
	/** The search as a glob: what the list shows, and what the buttons turn on or off. */
	const glob = $derived(globOfSearch(search, names));
	const matching = $derived(catalogue ? catalogue.checks.filter((c) => !glob || matches(glob, c.name)) : []);
	const enabled = $derived(new Set(names.filter((n) => isEnabled(globs, n))));
	const shown = $derived(filter === 'all' ? matching : matching.filter((c) => enabled.has(c.name) === (filter === 'on')));
	const matchingOn = $derived(matching.filter((c) => enabled.has(c.name)).length);
	/** The language's own defaults, which "Reset" puts back. */
	const defaults = $derived(checksOf(languageOf(workspace.language).sample[TIDY_FILE]) ?? []);
	const isDefault = $derived(globs.map(globText).join(',') === defaults.map(globText).join(','));

	const set = (pattern: string, on: boolean) => workspace.setTidyChecks(setChecks(globs, pattern, on, names));
	const remove = (index: number) => workspace.setTidyChecks(globs.filter((_, i) => i !== index));
	const reset = () => workspace.setTidyChecks(defaults);

	function openFile(): void {
		dialog.close();
		workspace.show(TIDY_FILE);
	}
</script>

{#snippet rule(g: CheckGlob, index: number)}
	<li class="glob" class:off={!g.on}>
		<code>{globText(g)}</code>
		<button class="x" onclick={() => remove(index)} aria-label="Remove {globText(g)}" title="Remove this line">×</button>
	</li>
{/snippet}

<dialog class="tidy-rules" bind:this={dialog} aria-labelledby="tidy-rules-title" onclick={(e) => e.target === dialog && dialog.close()}>
	<header>
		<h2 id="tidy-rules-title">clang-tidy rules</h2>
		<button class="close" onclick={() => dialog.close()} aria-label="Close">×</button>
	</header>

	<div class="state">
		<label class="toggle">
			<input type="checkbox" checked={workspace.clangTidy} onchange={(e) => workspace.setClangTidy(e.currentTarget.checked)} />
			<span>Check the code with clang-tidy as you type</span>
		</label>
		<small>{describeTidy(workspace.clangTidy, workspace.tidyStatus)}</small>
	</div>

	<div class="search">
		<input
			bind:this={searchBox}
			bind:value={search}
			type="search"
			placeholder="Search by name: modernize-*, const, bugprone-use-after-move"
			aria-label="Search checks by name or pattern"
			spellcheck="false"
			autocomplete="off"
		/>
		<div class="actions">
			<span class="count">
				{#if catalogue}
					{#if glob}{matching.length} matching <code>{glob}</code>, {matchingOn} on{:else}{enabled.size} of {names.length} checks on{/if}
				{/if}
			</span>
			<button class="btn" disabled={!glob || !catalogue || (matching.length > 0 && matchingOn === matching.length)} onclick={() => glob && set(glob, true)}>Turn on {glob ? 'all matching' : ''}</button>
			<button class="btn" disabled={!glob || !catalogue || matchingOn === 0} onclick={() => glob && set(glob, false)}>Turn off {glob ? 'all matching' : ''}</button>
		</div>
		<div class="filter" role="radiogroup" aria-label="Show">
			{#each [['all', 'All'], ['on', 'On'], ['off', 'Off']] as const as [value, label] (value)}
				<label><input type="radio" name="tidy-filter" {value} bind:group={filter} />{label}</label>
			{/each}
		</div>
	</div>

	<div class="list">
		{#if loadError}
			<p class="muted">The list of checks could not be loaded ({loadError}). The rules below still apply, and {TIDY_FILE} can be edited by hand.</p>
		{:else if !catalogue}
			<p class="muted">Loading the list of checks…</p>
		{:else if shown.length === 0}
			<p class="muted">No check {filter === 'all' ? '' : `that is ${filter} `}matches. A pattern with * that matches none may still be added: it may be for a newer clang-tidy.</p>
		{:else}
			<ul>
				{#each shown as check (check.name)}
					{@const on = enabled.has(check.name)}
					<li class="check" class:on>
						<label>
							<input type="checkbox" checked={on} onchange={(e) => set(check.name, e.currentTarget.checked)} />
							<span class="name">{check.name}</span>
						</label>
						<span class="badges">
							{#if check.alias}<span class="badge" title="The same check as {check.alias}, under another module's name">alias</span>{/if}
							{#if check.fixes}<span class="badge fix" title="Offers a fix: a quick fix (Ctrl+.) on its warnings">fix</span>{/if}
							{#if check.speed === 'slow'}<span class="badge slow" title="clangd measured it as slow: each edit's diagnostics come later with it on">slow</span>{/if}
							{#if check.clangd === false}<span class="badge never" title="clangd never runs it while you type (it misreports code being typed); the clang-tidy command still does">not in the editor</span>{/if}
							<a href={docsUrl(check.name)} target="_blank" rel="noopener" title="clang-tidy’s documentation of {check.name}">docs</a>
						</span>
						<p class="summary">{check.alias ? `Another name for ${check.alias}. ` : ''}{check.summary}</p>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<footer>
		<div class="rules">
			<span class="label" title="clang-tidy reads them in order, and the last one that matches a check decides">Checks in {TIDY_FILE}:</span>
			{#if globs.length}
				<ul class="globs">
					{#each globs as g, i (i)}
						{@render rule(g, i)}
					{/each}
				</ul>
			{:else}
				<span class="muted">{workspace.tidyChecks === null ? 'none: clangd runs its own few default checks' : 'none'}</span>
			{/if}
		</div>
		<div class="buttons">
			<button class="btn" disabled={isDefault} onclick={reset} title="Put back the {languageOf(workspace.language).label} defaults">Reset to defaults</button>
			<button class="btn" onclick={openFile} disabled={!workspace.files.includes(TIDY_FILE)}>Open {TIDY_FILE}</button>
		</div>
	</footer>
</dialog>

<style>
	.tidy-rules {
		display: none;
		width: min(48rem, calc(100vw - 2rem));
		height: min(42rem, calc(100vh - 4rem));
		padding: 0;
		border: 1px solid var(--gray-5);
		border-radius: 0.5rem;
		background: var(--gray-7);
		color: var(--white);
		font-size: 0.85rem;
	}
	.tidy-rules[open] {
		display: flex;
		flex-direction: column;
	}
	.tidy-rules::backdrop {
		background: rgb(0 0 0 / 0.45);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem 0;
	}
	h2 {
		margin: 0;
		font-size: 1.05rem;
	}
	.close {
		border: 0;
		background: none;
		color: var(--gray-2);
		font-size: 1.4rem;
		cursor: pointer;
	}
	.state {
		display: grid;
		gap: 0.2rem;
		padding: 0.4rem 1rem 0;
	}
	.toggle,
	.check label,
	.filter label {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		cursor: pointer;
	}
	small,
	.muted,
	.count {
		color: var(--gray-3);
		font-size: 0.78rem;
	}
	.search {
		display: grid;
		gap: 0.45rem;
		padding: 0.75rem 1rem 0.5rem;
		border-bottom: 1px solid var(--gray-6);
	}
	.search input[type='search'] {
		min-height: 2rem;
		padding: 0 0.55rem;
		border: 1px solid var(--control-border);
		border-radius: 0.35rem;
		background: var(--black);
		color: var(--white);
		font: inherit;
		font-family: var(--font-mono);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	.count {
		flex: 1;
		min-width: 12rem;
	}
	.filter {
		display: flex;
		gap: 0.9rem;
		color: var(--gray-2);
	}
	.list {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 0.25rem 0;
	}
	.list > p {
		margin: 0.75rem 1rem;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.check {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.1rem 0.5rem;
		padding: 0.35rem 1rem;
		border-bottom: 1px solid var(--gray-6);
	}
	.check .name {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--gray-2);
		overflow-wrap: anywhere;
	}
	.check.on .name {
		color: var(--white);
	}
	.badges {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.badge {
		padding: 0 0.35rem;
		border-radius: 0.6rem;
		background: var(--gray-6);
		color: var(--gray-2);
		font-size: 0.7rem;
		line-height: 1.3rem;
		white-space: nowrap;
	}
	.badge.fix {
		background: var(--accent-low);
		color: var(--accent-high);
	}
	.badge.slow {
		background: var(--orange-low, var(--gray-6));
		color: var(--orange-high);
	}
	.badge.never {
		color: var(--gray-3);
	}
	a {
		color: var(--accent-high);
		font-size: 0.75rem;
	}
	.summary {
		grid-column: 1 / -1;
		margin: 0 0 0 1.55rem;
		color: var(--gray-3);
		font-size: 0.78rem;
		line-height: 1.35;
	}
	footer {
		display: grid;
		gap: 0.5rem;
		padding: 0.6rem 1rem 0.8rem;
		border-top: 1px solid var(--gray-5);
	}
	.rules {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		max-height: 6.5rem;
		overflow: auto;
	}
	.label {
		color: var(--gray-2);
		font-weight: 600;
	}
	.globs {
		display: contents;
	}
	.glob {
		display: inline-flex;
		align-items: center;
		padding-left: 0.4rem;
		border: 1px solid var(--gray-5);
		border-radius: 0.3rem;
		font-size: 0.75rem;
	}
	.glob.off code {
		color: var(--gray-3);
	}
	.x {
		padding: 0 0.35rem;
		border: 0;
		background: none;
		color: var(--gray-3);
		cursor: pointer;
	}
	.x:hover {
		color: var(--white);
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 0.4rem;
	}
	code {
		font-size: 0.75rem;
	}
	/* A phone: the dialog fills the screen. */
	@media (width < 30rem) {
		.tidy-rules {
			width: 100vw;
			max-width: 100vw;
			height: 100dvh;
			max-height: 100dvh;
			border-radius: 0;
		}
		.check {
			padding-inline: 0.75rem;
		}
	}
</style>
