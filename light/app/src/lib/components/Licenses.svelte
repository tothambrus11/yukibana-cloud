<!--
  The Licences dialog: the licence of everything the app and its language
  packs ship, as files a click opens. The app's npm packages are in
  licenses/app.txt (scripts/licenses.mjs); each pack's are the files its
  build put beside it (LICENSE-*.txt, NOTICE*, and SOURCES*.txt where a
  licence asks for the source to be offered), found in offline.json, so a
  pack that adds one is listed without a change here. A pack no language is
  served by (the debugger, packs/lldb) has a row of its own: the first
  release with it failed e2e.mjs's licences check for want of one.
-->
<script lang="ts">
	import { LANGUAGES } from '../languages';
	import { packOf } from '../packs';
	import { offline } from '../offline.svelte';

	let dialog: HTMLDialogElement;

	/** Opens the dialog, reading offline.json if nothing has yet. */
	export function show(): void {
		dialog.showModal();
		if (!offline.manifest) void offline.refresh();
	}

	/** A pack file that is a licence, a notice or where the source is. */
	const LEGAL = /^(licen[cs]es?|notice|copying|sources|third.?party)/i;
	const href = (path: string) => new URL(path, new URL('./', document.baseURI)).href;
	const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

	/** What a pack no language is served by is, by its directory; others show their directory's name. */
	const TOOLS: Record<string, string> = { lldb: 'Debugger (C, C++, Swift)' };

	/** Each installed pack once, with the languages it serves (or what it is) and its legal files. */
	const packs = $derived.by(() => {
		const legal = (pack: string) =>
			offline
				.packFiles(pack)
				.map((f) => f.path)
				.filter((p) => LEGAL.test(nameOf(p)));
		const byPack = new Map<string, { labels: string[]; files: string[] }>();
		for (const l of LANGUAGES) {
			const pack = packOf(l);
			const entry = byPack.get(pack);
			if (entry) entry.labels.push(l.label);
			else byPack.set(pack, { labels: [l.label], files: legal(pack) });
		}
		for (const pack of offline.packs) {
			if (!byPack.has(pack)) byPack.set(pack, { labels: [TOOLS[pack] ?? pack], files: legal(pack) });
		}
		return [...byPack].filter(([, e]) => e.files.length > 0);
	});
</script>

<dialog class="licenses" bind:this={dialog} aria-labelledby="licenses-title" onclick={(e) => e.target === dialog && dialog.close()}>
	<header>
		<h2 id="licenses-title">Licences</h2>
		<button class="close" onclick={() => dialog.close()} aria-label="Close">×</button>
	</header>

	<p>Yukibana Light is built from open-source software, and runs compilers and tools that are too, in your browser. Each part's licence is below, as it ships.</p>

	<ul class="app">
		<li><a href={href('licenses/app.txt')} target="_blank" rel="noopener">The app</a>: the npm packages its own code is built from (Svelte, SvelteKit, Monaco, dockview, JetBrains Mono, …).</li>
	</ul>

	{#if !offline.manifest}
		<p class="muted">This build has no list of its files (offline.json). Each language's licences are in its pack's directory, packs/&lt;pack&gt;/LICENSE-*.txt.</p>
	{:else}
		<table>
			<thead>
				<tr><th>Part</th><th>Licences</th></tr>
			</thead>
			<tbody>
				{#each packs as [pack, { labels, files }] (pack)}
					<tr data-pack={pack}>
						<td>{labels.join(', ')}</td>
						<td class="files">
							{#each files as path (path)}
								<a href={href(path)} target="_blank" rel="noopener">{nameOf(path)}</a>
							{/each}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="muted">A SOURCES file says where the corresponding source of a part under the GPL or a similar licence is.</p>
	{/if}
</dialog>

<style>
	.licenses {
		width: min(44rem, calc(100vw - 2rem));
		max-height: calc(100vh - 4rem);
		padding: 0 0 0.75rem;
		border: 1px solid var(--gray-5);
		border-radius: 0.5rem;
		background: var(--gray-7);
		color: var(--white);
		font-size: 0.9rem;
	}
	.licenses::backdrop {
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
	p,
	ul {
		margin: 0.5rem 1rem;
		color: var(--gray-2);
		line-height: 1.4;
	}
	ul {
		padding-left: 1.2rem;
	}
	table {
		width: calc(100% - 2rem);
		margin: 0.5rem 1rem;
		border-collapse: collapse;
	}
	th {
		color: var(--gray-3);
		font-weight: 500;
		text-align: left;
	}
	th,
	td {
		padding: 0.3rem 0.4rem;
		border-bottom: 1px solid var(--gray-6);
		vertical-align: top;
	}
	td:first-child {
		white-space: nowrap;
	}
	.files {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.75rem;
	}
	a {
		color: var(--accent-high);
	}
	.muted {
		color: var(--gray-3);
	}
</style>
