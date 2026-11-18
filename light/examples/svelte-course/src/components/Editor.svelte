<!--
@component
An editor of one file, for an exercise: a plain textarea at once
(@yukibana/editors/textarea), replaced by Monaco (@yukibana/monaco's
`monacoPort`) once the editor comes near the screen, unless the browser is
a phone or the URL says `?editor=textarea` (editor.ts `prefersTextarea`).
Monaco's chunk is loaded by `import()` the first time any editor needs it,
and shared by every editor of the page. If it fails to load, the textarea
stays, and says so.

`onready` is called with each editor made: the textarea's first, then
Monaco's, which starts from what was typed in the textarea meanwhile. The
caller uses the latest; the earlier one is disposed by then.
-->
<script lang="ts">
	import type { Files, Path } from '@yukibana/core';
	import { onMount, tick } from 'svelte';
	import { prefersTextarea, textareaHandle, type EditorHandle } from '../lib/editor.ts';
	import { theme } from '../lib/theme.svelte.ts';

	interface Props {
		/** The file it edits. */
		path: Path;
		/** Its text at first; read once, when the component mounts. */
		text: string;
		/** The files beside it in the project, which it does not show. */
		hidden: Files;
		/** Monaco's language id for the file's grammar. */
		language: string;
		/** The editor's accessible name. */
		label: string;
		/** How many lines tall it is. */
		rows: number;
		/** Called with each editor made, the latest being the one to use. */
		onready: (editor: EditorHandle) => void;
	}

	let { path, text, hidden, language, label, rows, onready }: Props = $props();

	let area: HTMLTextAreaElement | undefined = $state();
	let host: HTMLDivElement | undefined = $state();
	/** Which editor shows: the textarea, the textarea while Monaco loads, or Monaco. */
	let kind: 'textarea' | 'loading' | 'monaco' = $state('textarea');
	let problem: string | null = $state(null);
	let applyTheme: ((dark: boolean) => void) | null = $state(null);

	onMount(() => {
		if (area === undefined || host === undefined) return;
		const textarea = area;
		const container = host;
		textarea.value = text;
		let handle: EditorHandle = textareaHandle(textarea, path, hidden);
		onready(handle);
		let disposed = false;

		const load = async (): Promise<void> => {
			kind = 'loading';
			try {
				const monaco = await import('../lib/monaco-editor.ts');
				if (disposed) return;
				monaco.applyTheme(theme.dark);
				const typed = handle.text();
				kind = 'monaco';
				await tick();
				if (disposed) return;
				const next = monaco.monacoHandle(container, path, typed, hidden, language, label);
				handle.dispose();
				handle = next;
				applyTheme = monaco.applyTheme;
				onready(next);
			} catch (error) {
				kind = 'textarea';
				problem = `The code editor did not load (${error instanceof Error ? error.message : String(error)}); this plain one works the same.`;
			}
		};

		let observer: IntersectionObserver | null = null;
		if (!prefersTextarea()) {
			observer = new IntersectionObserver(
				(entries) => {
					if (!entries.some((entry) => entry.isIntersecting)) return;
					observer?.disconnect();
					observer = null;
					void load();
				},
				{ rootMargin: '400px 0px' },
			);
			observer.observe(textarea);
		}
		return () => {
			disposed = true;
			observer?.disconnect();
			handle.dispose();
		};
	});

	$effect(() => {
		applyTheme?.(theme.dark);
	});

	/** Tab indents in the textarea, as in Monaco, instead of leaving it; Escape then Tab still leaves. */
	let escaped = false;
	function keydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			escaped = true;
			return;
		}
		if (event.key !== 'Tab' || event.shiftKey || escaped || area === undefined) {
			escaped = false;
			return;
		}
		event.preventDefault();
		area.setRangeText('    ', area.selectionStart, area.selectionEnd, 'end');
		area.dispatchEvent(new Event('input'));
	}
</script>

<div class="editor" data-editor={kind} style:--rows={rows}>
	<textarea
		bind:this={area}
		class="plain"
		hidden={kind === 'monaco'}
		spellcheck="false"
		autocapitalize="off"
		autocomplete="off"
		aria-label={label}
		{rows}
		onkeydown={keydown}
	></textarea>
	<div bind:this={host} class="monaco" hidden={kind !== 'monaco'}></div>
	{#if kind === 'loading'}<span class="loading" aria-hidden="true">Loading the editor…</span>{/if}
	{#if problem !== null}<p class="problem">{problem}</p>{/if}
</div>

<style>
	.editor {
		position: relative;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--code-bg);
		overflow: hidden;
	}
	.editor:focus-within {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.plain {
		display: block;
		box-sizing: border-box;
		width: 100%;
		min-height: calc(var(--rows) * 21px + 20px);
		padding: 10px 14px;
		border: 0;
		outline: none;
		resize: vertical;
		background: transparent;
		color: var(--ink);
		font: 14px/21px var(--mono);
		tab-size: 4;
		white-space: pre;
		overflow: auto;
	}
	.plain[hidden],
	.monaco[hidden] {
		display: none;
	}
	.monaco {
		height: calc(var(--rows) * 21px + 20px);
	}
	.loading {
		position: absolute;
		top: 8px;
		right: 12px;
		font-size: 12px;
		color: var(--muted);
	}
	.problem {
		margin: 0;
		padding: 6px 14px;
		font-size: 13px;
		color: var(--warn);
		border-top: 1px solid var(--line);
	}
</style>
