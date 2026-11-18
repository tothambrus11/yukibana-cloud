<!--
  A C++ playground: `files` in Monaco, `hidden` in the project beside them
  (a library, compile_flags.txt), the language server's answers in the
  editor, and Run. Its markup renders on the server; Monaco and the
  playground load in the browser, on mount, and are disposed with it.

  `files` and `hidden` are read once, when the playground is made: a parent
  that wants other files gives the component a new `key`.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import type { Playground } from '@yukibana/playground';

	interface Props {
		/** The files the reader edits, by project path; the first one (or main.cpp) is shown and run. */
		files: Record<string, string>;
		/** Files of the project not offered for editing: a library, compile_flags.txt. */
		hidden?: Record<string, string>;
	}
	let { files, hidden = {} }: Props = $props();

	let element: HTMLDivElement | undefined = $state();
	let playground: Playground | null = $state(null);
	let server = $state('Loading the editor…');
	let runStatus = $state('');
	let output = $state('');
	let running = $state(false);

	onMount(() => {
		let made: Playground | null = null;
		let unmounted = false;
		import('./playground.ts')
			.then(({ createCppPlayground }) => {
				if (unmounted || element === undefined) return;
				made = createCppPlayground(element, files, hidden, (text) => (server = text));
				playground = made;
			})
			// Also what making the playground throws: a second one on the page while this one is alive.
			.catch((error: unknown) => (server = `The editor did not load: ${error instanceof Error ? error.message : String(error)}`));
		return () => {
			unmounted = true;
			made?.dispose();
		};
	});

	async function run(): Promise<void> {
		if (playground === null) return;
		output = '';
		running = true;
		const ended = await playground.run({ output: (text) => (output += text), status: (text) => (runStatus = text) });
		// A run that a newer one replaced ends as cancelled while the newer one still runs.
		if (ended.kind !== 'cancelled' || ended.why === 'disposed') running = false;
	}
</script>

<div class="playground">
	<p class="server" role="status">{server}</p>
	<div class="editor" bind:this={element}></div>
	<div class="controls">
		<button class="run" type="button" onclick={run} disabled={playground === null || running}>Run</button>
		<button class="stop" type="button" onclick={() => playground?.stop()} disabled={!running}>Stop</button>
		<span class="run-status" role="status">{runStatus}</span>
	</div>
	<pre class="output" aria-live="polite">{output}</pre>
</div>

<style>
	.server,
	.controls {
		color: #5b6370;
		margin: 8px 0;
	}
	.controls {
		display: flex;
		gap: 8px;
		align-items: baseline;
	}
	.editor {
		height: 55vh;
		border: 1px solid #c8ccd2;
	}
	.output {
		min-height: 6em;
		margin: 0;
		padding: 8px;
		background: #f6f7f9;
		border: 1px solid #c8ccd2;
		white-space: pre-wrap;
	}
</style>
