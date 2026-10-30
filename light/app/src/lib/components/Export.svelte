<!--
  The Download dialog: how the downloaded project is built (when its
  language has more than one build system), which CI service it is set up
  for, whether it gets a dev container and a .gitattributes, and the files
  that will be generated, before the zip is made (workspace.download, which
  export.ts fills). The choices are remembered in this browser.
-->
<script lang="ts">
	import type { Workspace } from '../workspace.svelte';
	import { CI_SERVICES, isCiServiceId, type CiServiceId } from '../export-tooling';
	import type { BuildSystem, ExportOptions } from '../export';
	import type { LanguageId } from '../languages';

	/** The choices as this browser keeps them: the CI service and switches, and each language's build system. */
	interface Choices {
		ci: CiServiceId | null;
		devcontainer: boolean;
		gitattributes: boolean;
		build: Partial<Record<LanguageId, string>>;
	}

	let { workspace }: { workspace: Workspace } = $props();

	const KEY = 'yukibana-light:export';
	/** A first download: GitHub Actions, a dev container and LF line endings, each a click away from off. */
	const DEFAULTS: Choices = { ci: 'github', devcontainer: true, gitattributes: true, build: {} };

	/** The choices last made here, each one checked; the defaults where storage has none or refuses. */
	function load(): Choices {
		try {
			const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
			if (typeof saved !== 'object' || saved === null) return DEFAULTS;
			const s = saved as Record<string, unknown>;
			const build = typeof s.build === 'object' && s.build !== null ? Object.fromEntries(Object.entries(s.build).filter(([, v]) => typeof v === 'string')) : {};
			return {
				ci: s.ci === null ? null : isCiServiceId(s.ci) ? s.ci : DEFAULTS.ci,
				devcontainer: typeof s.devcontainer === 'boolean' ? s.devcontainer : DEFAULTS.devcontainer,
				gitattributes: typeof s.gitattributes === 'boolean' ? s.gitattributes : DEFAULTS.gitattributes,
				build,
			};
		} catch {
			return DEFAULTS;
		}
	}

	function save(choices: Choices): void {
		try {
			localStorage.setItem(KEY, JSON.stringify(choices));
		} catch {
			// Storage refused (a private window, say): the choices last until the page is reloaded.
		}
	}

	let dialog: HTMLDialogElement;
	let choices = $state<Choices>(load());
	/** Bumped when the dialog opens, so the preview reads the project as it is now. */
	let opened = $state(0);

	const options = $derived<ExportOptions>({
		ci: choices.ci,
		devcontainer: choices.devcontainer,
		gitattributes: choices.gitattributes,
		...(choices.build[workspace.language] ? { build: choices.build[workspace.language] } : {}),
	});
	const preview = $derived.by((): { buildSystems: BuildSystem[]; generated: string[] } => {
		void opened;
		return workspace.exportPreview(options);
	});
	const chosenBuild = $derived(preview.buildSystems.find((b) => b.id === choices.build[workspace.language])?.id ?? preview.buildSystems[0]?.id);

	/** Opens the dialog on the current project. */
	export function show(): void {
		opened++;
		dialog.showModal();
	}

	function setBuild(id: string): void {
		choices = { ...choices, build: { ...choices.build, [workspace.language]: id } };
		save(choices);
	}

	function set(change: Partial<Choices>): void {
		choices = { ...choices, ...change };
		save(choices);
	}

	async function download(): Promise<void> {
		dialog.close();
		await workspace.download(options);
	}
</script>

<dialog class="export" bind:this={dialog} aria-labelledby="export-title" onclick={(e) => e.target === dialog && dialog.close()}>
	<header>
		<h2 id="export-title">Download project</h2>
		<button class="icon-btn close" onclick={() => dialog.close()} aria-label="Close" title="Close">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
		</button>
	</header>

	<p>A zip of the project for an IDE, with the files its tools need. A file the project already has is never replaced.</p>

	{#if preview.buildSystems.length > 1}
		<fieldset>
			<legend>Build system</legend>
			<div class="choices">
				{#each preview.buildSystems as b (b.id)}
					<label class="choice"><input type="radio" name="export-build" value={b.id} checked={chosenBuild === b.id} onchange={() => setBuild(b.id)} />{b.label}</label>
				{/each}
			</div>
		</fieldset>
	{/if}

	<fieldset>
		<legend>Continuous integration</legend>
		<p class="hint">Builds, tests and checks the format on every push, in the same container as the dev container.</p>
		<div class="choices">
			<label class="choice"><input type="radio" name="export-ci" checked={choices.ci === null} onchange={() => set({ ci: null })} />None</label>
			{#each CI_SERVICES as s (s.id)}
				<label class="choice"><input type="radio" name="export-ci" value={s.id} checked={choices.ci === s.id} onchange={() => set({ ci: s.id })} />{s.label}</label>
			{/each}
		</div>
	</fieldset>

	<fieldset>
		<legend>Repository</legend>
		<label class="check"><input type="checkbox" checked={choices.devcontainer} onchange={(e) => set({ devcontainer: e.currentTarget.checked })} /><span>Dev container <span class="hint">(VS Code, Codespaces: the tools in a container)</span></span></label>
		<label class="check"><input type="checkbox" checked={choices.gitattributes} onchange={(e) => set({ gitattributes: e.currentTarget.checked })} /><span>.gitattributes <span class="hint">(LF line endings on every system, whatever core.autocrlf says)</span></span></label>
	</fieldset>

	<details class="files">
		<summary>{preview.generated.length} file{preview.generated.length === 1 ? '' : 's'} generated</summary>
		<ul>
			{#each preview.generated as path (path)}
				<li><code>{path}</code></li>
			{/each}
		</ul>
	</details>

	<footer>
		<button class="button" onclick={() => dialog.close()}>Cancel</button>
		<button class="button primary" onclick={() => void download()}>Download .zip</button>
	</footer>
</dialog>

<style>
	.export {
		width: min(34rem, calc(100vw - 2rem));
		max-height: calc(var(--app-height, 100dvh) - 2rem);
		padding: 0;
		border: 1px solid var(--gray-5);
		border-radius: 0.5rem;
		background: var(--gray-7);
		color: var(--white);
		font-size: 0.9rem;
	}
	.export::backdrop {
		background: rgb(0 0 0 / 0.45);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.5rem 0 1rem;
	}
	h2 {
		margin: 0;
		font-size: 1.05rem;
	}
	.close {
		min-width: 2.5rem;
		min-height: 2.5rem;
		color: var(--gray-2);
	}
	p {
		margin: 0.5rem 1rem;
		color: var(--gray-2);
		line-height: 1.4;
	}
	fieldset {
		margin: 0.5rem 1rem;
		padding: 0.4rem 0.75rem 0.6rem;
		border: 1px solid var(--gray-6);
		border-radius: 0.4rem;
	}
	legend {
		padding: 0 0.3rem;
		color: var(--gray-3);
		font-weight: 500;
	}
	fieldset p {
		margin: 0 0 0.4rem;
	}
	.hint {
		color: var(--gray-3);
		font-size: 0.8rem;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
	}
	.choice,
	.check {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2rem;
		cursor: pointer;
	}
	.check {
		align-items: flex-start;
		padding: 0.3rem 0;
		min-height: 0;
	}
	.check input {
		margin-top: 0.15rem;
	}
	input {
		accent-color: var(--accent);
	}
	.files {
		margin: 0.5rem 1rem;
		color: var(--gray-2);
	}
	.files summary {
		cursor: pointer;
	}
	.files ul {
		margin: 0.4rem 0 0;
		padding-left: 1.2rem;
		max-height: 10rem;
		overflow: auto;
	}
	code {
		font-family: var(--mono, 'JetBrains Mono Variable', monospace);
		font-size: 0.8rem;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0.5rem 1rem 1rem;
	}
	.button {
		min-height: 2rem;
		white-space: nowrap;
		padding: 0 0.8rem;
		border: 1px solid var(--gray-5);
		border-radius: 0.35rem;
		background: var(--gray-6);
		color: var(--gray-2);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.button:hover {
		border-color: var(--gray-4);
		color: var(--white);
	}
	.primary {
		border-color: var(--accent);
		color: var(--white);
		font-weight: 600;
	}
</style>
