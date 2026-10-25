<!--
  The page: a top bar, the dockview layout, and a status bar.

  The top bar is one row in five zones: who (the brand), what (the
  language), do (Run, Test, Mutate), how it is built (the Build chip), what
  to see (LLVM IR and Assembly), and, after a spacer, the app's own
  controls ending in the ⋯ menu. As the bar narrows, labels shorten first
  and then controls move into ⋯, in a fixed order (MoreMenu.svelte and
  app.css, "The top bar's folding"); the language, Run, Test and ⋯ never
  leave. Nothing in it wraps, and nothing makes the page wider than the
  window.

  The status bar says the language server's state (and opens a menu to
  restart it or show its output), the C++ build in short, and the
  problems, which open the Problems panel.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { createDock } from '../lib/dock';
	import { LANGUAGE_GROUPS, languageOf, shortLabel, type LanguageId } from '../lib/languages';
	import { packOf } from '../lib/packs';
	import { KINDS, viewsOf } from '../lib/explore-views';
	import { registerServiceWorker } from '../lib/pwa';
	import { offline } from '../lib/offline.svelte';
	import Offline from '../lib/components/Offline.svelte';
	import BuildSettings from '../lib/components/BuildSettings.svelte';
	import { buildSummary, openBuildSettings } from '../lib/build-settings';
	import MoreMenu from '../lib/components/MoreMenu.svelte';
	import Popover from '../lib/components/Popover.svelte';
	import { theme } from '../lib/theme.svelte';
	import { Workspace } from '../lib/workspace.svelte';
	import { projectLanguageOf } from '../lib/project';
	import { serverLabel } from '../lib/format';
	import { followViewport } from '../lib/viewport';
	import { startEditor } from '../lib/monaco';

	// The editor is on from here: importing it changed nothing on the page.
	// Before the workspace, which listens to Monaco's markers and so starts
	// Monaco's services, which startEditor must replace first.
	startEditor();
	theme.start();
	const workspace = new Workspace();
	let dockElement: HTMLElement;
	let dock: ReturnType<typeof createDock> | undefined;
	let offlineDialog = $state<Offline>();
	let serverMenu = $state<Popover>();
	/** Set when a new build is installed and waiting: activates it and reloads. */
	let applyUpdate = $state<(() => void) | null>(null);

	onMount(() => {
		dock = createDock(dockElement, workspace);
		workspace.attach(dock);
		registerServiceWorker({
			report: (m) => workspace.write('warning', m),
			beforeReload: () => workspace.flush(),
			updateReady: (apply) => (applyUpdate = apply),
		});
		void offline.refresh();
		// Keeps the body the height of the visible area, above a phone's on-screen keyboard, and on a phone gives the editor the room while typing.
		const stopViewport = followViewport((up) => dock?.keyboard(up));
		// The save is debounced; a page being hidden may never come back.
		const hidden = () => document.visibilityState === 'hidden' && workspace.flush();
		const flush = () => workspace.flush();
		const storage = (e: StorageEvent) => {
			const language = e.key && projectLanguageOf(e.key);
			if (language) workspace.savedElsewhere(language);
		};
		addEventListener('pagehide', flush);
		addEventListener('storage', storage);
		document.addEventListener('visibilitychange', hidden);
		return () => {
			stopViewport();
			removeEventListener('pagehide', flush);
			removeEventListener('storage', storage);
			document.removeEventListener('visibilitychange', hidden);
			dock?.dispose();
		};
	});

	$effect(() => dock?.setProblemCount(workspace.problems.length));
	// A pack used for the first time is cached as it downloads: say so in the language list.
	$effect(() => {
		if (workspace.clientState.kind === 'running') setTimeout(() => void offline.refresh(), 2000);
	});

	const errors = $derived(workspace.problems.filter((p) => p.severity === 'error').length);
	const warnings = $derived(workspace.problems.filter((p) => p.severity === 'warning').length);
	const percent = $derived(workspace.progress && workspace.progress.total > 0 ? Math.min(100, (100 * workspace.progress.loaded) / workspace.progress.total) : null);
	const language = $derived(languageOf(workspace.language));
	/** The language's compiler output views (explore-views.ts), none for most. */
	const views = $derived(viewsOf(workspace.language)?.views.map((v) => v.kind) ?? []);
	/** "the active C or C++ file" and the like, for the views' buttons. */
	const activeSource = $derived(`the active ${shortLabel(language)} ${workspace.language === 'haskell' ? 'module' : 'file'}`);
	/** C++ (target, sanitizers, run options, tests) and the languages with optimisation levels have build settings. */
	const hasBuild = $derived(workspace.language === 'cpp' || workspace.optimization !== null);
	const summary = $derived(buildSummary(workspace));
	const cached = $derived(offline.isPackCached(packOf(language)));
	const themeLabel = $derived(`Switch to ${theme.current === 'dark' ? 'light' : 'dark'} theme`);
	/** The server's full name and version, for the status bar's title; its short form is shown. */
	const serverFull = $derived(workspace.clientState.kind === 'running' ? workspace.clientState.server : '');
	const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

	function reset() {
		const label = languageOf(workspace.language).label;
		if (confirm(`Replace your ${label} project with the sample? Your changes to it will be lost.`)) void workspace.resetProject();
	}
</script>

<header class="bar-host">
	<div class="bar">
		<a class="brand" href="./" aria-label="Yukibana Light" title="Yukibana Light">
			<img src="logo-64.png" alt="" width="28" height="28" />
			<span class="name">Yukibana</span><span class="product">Light</span>
		</a>

		<!-- The chosen language is shown by .lang-label (its full or short name, by the bar's width); the native select lies over it, unseen, so a phone keeps its own picker. -->
		<label class="lang" title="Language: {language.label}">
			<span class="lang-label" aria-hidden="true"><span class="full">{language.label}</span><span class="short">{shortLabel(language)}</span></span>
			<span class="sr-only">Language</span>
			<select value={workspace.language} onchange={(e) => void workspace.switchTo(e.currentTarget.value as LanguageId)}>
				{#each LANGUAGE_GROUPS as group (group.label)}
					<optgroup label={group.label}>
						{#each group.ids.map(languageOf) as l (l.id)}
							<option value={l.id}>{l.label}{offline.isPackCached(packOf(l)) ? ' (offline)' : ''}</option>
						{/each}
					</optgroup>
				{/each}
			</select>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
		</label>

		{#if workspace.runner.busy}
			<button class="btn run stop" onclick={() => workspace.runner.stop()} title="Stop the program">
				<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1" /></svg>Stop
			</button>
		{:else}
			<button class="btn run" onclick={() => workspace.run()} disabled={!language.runs} title={language.runs ? 'Run the project (Ctrl+Enter)' : language.cannotRun}>
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" /></svg>Run
			</button>
			{#if language.tests}
				<button class="btn test" onclick={() => workspace.run('test')} title="Run the project's tests (Ctrl+Shift+Enter)">Test</button>
			{/if}
			{#if language.mutates}
				<button class="btn mutate" data-fold="70" onclick={() => workspace.run('mutate')} title="Mutation testing: change the code in small ways and check that the tests notice">Mutate</button>
			{/if}
		{/if}

		{#if hasBuild}
			<BuildSettings {workspace} />
		{/if}

		{#if views.length}
			<div class="view-group" role="group" aria-label="Compiler output" data-fold="44">
				{#each views as kind (kind)}
					{@const on = workspace.viewsOpen.includes(kind)}
					<button class="btn view" data-view={kind} aria-pressed={on} onclick={() => workspace.toggleView(kind)} title={on ? `Close the ${KINDS[kind].title} view` : `Show the ${KINDS[kind].noun} of ${activeSource}`}>
						<span class="check" aria-hidden="true">{on ? '✓' : ''}</span><span class="long">{KINDS[kind].title}</span><span class="short">{KINDS[kind].short}</span>
					</button>
				{/each}
			</div>
		{/if}

		<span class="spacer"></span>

		{#if applyUpdate}
			<button class="btn update" onclick={() => applyUpdate?.()} title="A new version is installed. Reload to use it">Update</button>
		{/if}
		<button class="icon-btn offline-button" data-fold="44" onclick={() => offlineDialog?.show()} aria-label="Offline use" title="Offline use">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a5 5 0 0 1-.6-9.96A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7z" /><path d="M12 10v6M9.5 13.5 12 16l2.5-2.5" /></svg>
			{#if cached}<span class="badge" title="{language.label} works offline">✓</span>{/if}
		</button>
		<button class="icon-btn theme-button" data-fold="44" onclick={() => theme.toggle()} aria-label={themeLabel} title={themeLabel}>
			{#if theme.current === 'dark'}
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
			{:else}
				<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
			{/if}
		</button>

		<MoreMenu>
			{#if language.mutates}
				<button class="menu-item" role="menuitem" data-fold="70" disabled={workspace.runner.busy} onclick={() => workspace.run('mutate')}>Mutation testing…</button>
				<div class="menu-divider" role="separator" data-fold="70"></div>
			{/if}
			{#if hasBuild}
				<button class="menu-item" role="menuitem" data-fold="30" onclick={() => openBuildSettings(document.querySelector<HTMLElement>('.bar-host button.more'))}>
					Build settings…<span class="hint">{summary}</span>
				</button>
				<div class="menu-divider" role="separator" data-fold="30"></div>
			{/if}
			{#if views.length}
				{#each views as kind (kind)}
					{@const on = workspace.viewsOpen.includes(kind)}
					<button class="menu-item" role="menuitemcheckbox" aria-checked={on} data-fold="44" data-view={kind} onclick={() => workspace.toggleView(kind)}>
						<span class="check" aria-hidden="true">{on ? '✓' : ''}</span>{KINDS[kind].title}
					</button>
				{/each}
				<div class="menu-divider" role="separator" data-fold="44"></div>
			{/if}
			<button class="menu-item" role="menuitem" onclick={() => void workspace.download()} title="Download the project as a zip, with the build files an IDE needs">Download project (.zip)</button>
			<button class="menu-item danger" role="menuitem" onclick={reset} title="Replace this language's project with the sample">Reset project…</button>
			<div class="menu-divider" role="separator"></div>
			<button class="menu-item" role="menuitem" onclick={() => offlineDialog?.show()}>Offline use…{#if cached}<span class="hint">{shortLabel(language)} ✓</span>{/if}</button>
			<button class="menu-item" role="menuitem" data-fold="44" onclick={() => theme.toggle()}>{themeLabel}</button>
			<button class="menu-item" role="menuitem" onclick={() => void workspace.restartServer()}>Restart language server</button>
		</MoreMenu>
	</div>
</header>

<main class="dock" bind:this={dockElement}></main>

<Offline bind:this={offlineDialog} />

<footer class="status-bar">
	<button class="server" popovertarget="server-menu" aria-haspopup="menu" title={serverFull || 'Language server'}>
		<span class="state" role="status">
			{#if workspace.progress}
				<span class="spinner" aria-hidden="true"></span>
				<span class="truncate">Loading {workspace.progress.label}</span>
				{#if percent !== null}
					<span class="meter" role="progressbar" aria-label="Download" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(percent)}><span style:width="{percent}%"></span></span>
					<span class="amount">{mb(workspace.progress.loaded)} / {mb(workspace.progress.total)} MB</span>
				{:else}
					<span class="amount">{mb(workspace.progress.loaded)} MB</span>
				{/if}
			{:else if workspace.clientState.kind === 'starting'}
				<span class="spinner" aria-hidden="true"></span> <span class="truncate">Starting the {language.label} language server…</span>
			{:else if workspace.clientState.kind === 'running'}
				<span class="ok" aria-hidden="true"></span> <span class="truncate">{serverLabel(workspace.clientState.server)}</span>
			{:else if workspace.clientState.kind === 'failed'}
				<span class="bad" aria-hidden="true"></span> <span class="truncate">Language server failed: {workspace.clientState.reason}</span>
			{:else}
				<span class="truncate">Language server stopped</span>
			{/if}
		</span>
	</button>
	<Popover bind:this={serverMenu} id="server-menu" label="Language server" role="menu" class="server-menu">
		<button class="menu-item" role="menuitem" onclick={() => (serverMenu?.hide(), void workspace.restartServer())}>Restart language server</button>
		<button class="menu-item" role="menuitem" onclick={() => (serverMenu?.hide(), workspace.showPanel('output'))}>Show output</button>
	</Popover>
	{#if workspace.language === 'cpp' && summary}
		<button class="build-summary-button" onclick={(e) => openBuildSettings(e.currentTarget)} title="Build settings: {summary}"><span class="truncate">{summary}</span></button>
	{/if}
	<span class="spacer"></span>
	<button class="problems-button" onclick={() => workspace.showPanel('problems')} title="Show the problems">
		<span class="sr-only">{errors} {errors === 1 ? 'error' : 'errors'}, {warnings} {warnings === 1 ? 'warning' : 'warnings'}</span>
		<span class="counts" aria-hidden="true">
			<span title="Errors"><span class="dot error"></span>{errors}</span>
			<span title="Warnings"><span class="dot warning"></span>{warnings}</span>
		</span>
	</button>
</footer>

<style>
	.bar-host {
		/* Above the layout, so nothing in the dock is drawn over the bar. */
		position: relative;
		z-index: 10;
		flex: none;
		border-bottom: 1px solid var(--gray-5);
		background: var(--header-bg);
		backdrop-filter: blur(0.5rem);
	}
	.bar {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: 0.6rem;
		height: var(--nav-height);
		padding: 0 1rem;
		/* Never wider than the window; the margin keeps focus rings at the edges whole. */
		overflow-x: clip;
		overflow-clip-margin: 4px;
	}
	.brand {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0.5rem;
		margin-right: 0.4rem;
		color: var(--white);
		text-decoration: none;
		white-space: nowrap;
	}
	.brand img {
		width: 1.75rem;
		height: 1.75rem;
	}
	.name {
		font-weight: 700;
		font-size: 1.15rem;
		letter-spacing: -0.01em;
	}
	.product {
		font-weight: 600;
		font-size: 1.05rem;
		color: var(--gray-2);
	}
	.lang {
		position: relative;
		display: inline-flex;
		flex: 0 1 auto;
		align-items: center;
		min-width: 0;
		max-width: 12rem;
		min-height: 2rem;
		padding: 0 1.9rem 0 0.75rem;
		border: 1px solid var(--gray-5);
		border-radius: 0.35rem;
		background: var(--gray-6);
		color: var(--white);
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
	}
	/* A finger's height on a touch screen, as the bar's buttons have (app.css). */
	@media (pointer: coarse) {
		.lang {
			min-height: 2.75rem;
		}
	}
	.lang:hover,
	.lang:focus-within {
		border-color: var(--control-border);
	}
	.lang:has(select:focus-visible) {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
	.lang-label {
		display: block;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	:global(.lang-label .short) {
		display: none;
	}
	.lang select {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		font: inherit;
		cursor: pointer;
	}
	.lang svg {
		position: absolute;
		right: 0.6rem;
		width: 0.8rem;
		height: 0.8rem;
		fill: none;
		stroke: var(--gray-2);
		stroke-width: 2;
		pointer-events: none;
	}
	.run {
		border-color: var(--accent);
		color: var(--white);
		font-weight: 600;
	}
	.run svg {
		fill: var(--accent-high);
	}
	.run.stop svg {
		fill: var(--red-high);
	}
	.update {
		border-color: var(--accent);
		color: var(--accent-high);
	}
	.view-group {
		display: inline-flex;
		flex: none;
	}
	.view-group .view {
		gap: 0.25rem;
		padding: 0 0.65rem;
		border-radius: 0;
	}
	.view-group .view:first-child {
		border-radius: 0.35rem 0 0 0.35rem;
	}
	.view-group .view:last-child {
		border-radius: 0 0.35rem 0.35rem 0;
	}
	.view-group .view + .view {
		margin-left: -1px;
	}
	.view .check:empty {
		display: none;
	}
	:global(.view-group .short) {
		display: none;
	}
	.spacer {
		flex: 1 1 0;
		min-width: 0;
	}
	.offline-button {
		position: relative;
	}
	.badge {
		position: absolute;
		right: 0.1rem;
		bottom: 0.15rem;
		display: grid;
		place-items: center;
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 50%;
		background: var(--accent);
		color: var(--black);
		font-size: 0.55rem;
		font-weight: 700;
		line-height: 1;
	}
	.dock {
		flex: 1;
		min-height: 0;
	}
	.status-bar {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0.75rem;
		min-height: 1.75rem;
		padding: 0 0.6rem;
		border-top: 1px solid var(--gray-5);
		color: var(--gray-3);
		font-size: 0.8rem;
		white-space: nowrap;
	}
	/*
	 * The bar's own buttons, its children only: the server menu's Popover is
	 * rendered inside the footer, and `.status-bar button` once matched its
	 * menu items too, made them inline and laid them side by side, with
	 * "Show output" off the edge of the menu.
	 */
	.status-bar > button {
		display: inline-flex;
		align-items: center;
		min-width: 0;
		min-height: 1.6rem;
		padding: 0 0.4rem;
		border: 0;
		border-radius: 0.3rem;
		background: none;
		color: inherit;
		font: inherit;
		white-space: nowrap;
		cursor: pointer;
	}
	.status-bar > button:hover {
		background: var(--gray-6);
		color: var(--white);
	}
	/* What gives way first as the bar narrows: the server's name, then the build summary. */
	.server {
		flex: 0 1 auto;
	}
	.build-summary-button {
		flex: 0 10 auto;
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}
	.problems-button {
		flex: none;
	}
	.state {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
	}
	.amount {
		flex: none;
	}
	.meter {
		display: inline-block;
		flex: none;
		width: 6rem;
		height: 0.35rem;
		border-radius: 1rem;
		background: var(--gray-5);
		overflow: hidden;
	}
	.meter span {
		display: block;
		height: 100%;
		background: var(--accent-high);
		transition: width 0.2s;
	}
	.spinner {
		flex: none;
		width: 0.75rem;
		height: 0.75rem;
		border: 1.5px solid var(--gray-4);
		border-top-color: var(--accent-high);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.ok,
	.bad {
		display: inline-block;
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
	}
	.ok {
		background: var(--accent-high);
	}
	.bad {
		background: var(--red-high);
	}
	.dot {
		font-size: 0.85rem;
		line-height: 1;
	}
	/* The marks are drawn, not written, so each count's text is its number alone (what the e2e suites read). */
	.dot.error {
		color: var(--red-high);
	}
	.dot.error::before {
		content: '⊗';
	}
	.dot.warning {
		color: var(--orange-high);
	}
	.dot.warning::before {
		content: '⚠';
	}
	.counts {
		display: flex;
		gap: 0.75rem;
	}
	.counts > span {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	@media (width < 40em) {
		.bar {
			gap: 0.4rem;
			padding: 0 0.5rem;
		}
	}
</style>
