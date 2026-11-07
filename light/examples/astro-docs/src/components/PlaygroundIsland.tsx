/**
 * The interactive half of a playground (Playground.astro renders the
 * rest): hydrated with `client:visible`, so its JavaScript, its language's
 * package and its compiler are fetched only once the reader scrolls it into
 * view, and the compiler only at the first Run.
 *
 * Before hydration (and with JavaScript off) it is the highlighted code
 * the page was built with, which Playground.astro passes as its children,
 * and the input the program would read: a page that reads fine as text.
 * Hydrated, it adds Edit, Run (or Test, or a live page for a web project),
 * Stop, a status line and the program's output, and runs through an
 * instance of @yukibana/core for its language (src/lib/languages.ts) on
 * the page's one host, so every playground of a language shares its
 * runner.
 */
import { pathOf, snapshotOf, type Files, type Path, type Subject } from '@yukibana/core';
import { textareaEditor, type TextareaEditor } from '@yukibana/editors/textarea';
import type { RunEvent, RunHandle } from '@yukibana/runtime';
import { preview, run, test } from '@yukibana/std';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { LANGS, type PlaygroundLang } from '../lib/langs.ts';
import { loadLanguage, type Loaded } from '../lib/languages.ts';
import { openLivePage, type LivePage } from '../lib/live-page.ts';
import { joinPrelude, registerSnippet, snippetText } from '../lib/prelude.ts';
import { statusOf } from '../lib/status.ts';

/** What Playground.astro gives the island: plain values, serialised into the page. */
export interface PlaygroundIslandProps {
	/** The language the code is in. */
	readonly lang: PlaygroundLang;
	/** The code the page was built with: the document the reader edits. */
	readonly code: string;
	/** The snippet's name on its page: later snippets continue it by it, and the pool names its runs by it. */
	readonly name: string;
	/** Ids of earlier snippets on the page whose code runs before this one's, in order (src/lib/prelude.ts). */
	readonly continues: readonly string[];
	/** Offer Run: the program's output. */
	readonly run: boolean;
	/** Offer Test: the language's test run over the project. */
	readonly test: boolean;
	/** Offer the live page (std's `preview`): a web project built as the reader types. */
	readonly preview: boolean;
	/** What the program reads on standard input, given line by line, then end of input; null for none. */
	readonly stdin: string | null;
	/** Files beside the document, by project path, that the run sees and the reader does not edit. */
	readonly files: Files;
	/** The document's project path, or null for the language's entry (`main.py`, `src/main.rs`). */
	readonly path: string | null;
	/** The static highlighted code, as Playground.astro rendered it. */
	readonly children?: ComponentChildren;
}

/** One piece of the output panel. */
interface Piece {
	readonly kind: 'stdout' | 'stderr' | 'info' | 'notice' | 'problem';
	readonly text: string;
}

/** What a hydrated playground has once its language is loaded. */
interface Ready {
	readonly loaded: Loaded;
	readonly editor: TextareaEditor;
	readonly path: Path;
}

/** Splits `text` into the lines a program is given, without a final empty one. */
function linesOf(text: string): string[] {
	const lines = text.split('\n');
	if (lines.at(-1) === '') lines.pop();
	return lines;
}

/**
 * `text` without its ANSI escape sequences (colours, bold): compilers
 * colour their messages for a terminal, and the output panel is not one.
 */
function plain(text: string): string {
	return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
}

/** The message of `thrown`. */
const messageOf = (thrown: unknown): string => (thrown instanceof Error ? thrown.message : String(thrown));

/**
 * The playground island: see the module's comment. Each instance names its
 * runs `name`, so a Run replaces only its own earlier run.
 *
 * - Requires: `name` is unique on the page; each id in `continues` is a
 *   snippet of the page (else Run says which is missing).
 */
export default function PlaygroundIsland(props: PlaygroundIslandProps): JSX.Element {
	const info = LANGS[props.lang];
	const showsPage = props.preview || info.shows === 'page';
	const [hydrated, setHydrated] = useState(false);
	const [ready, setReady] = useState<Ready | null>(null);
	const [editing, setEditing] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [status, setStatus] = useState('');
	const [state, setState] = useState('idle');
	const [pieces, setPieces] = useState<readonly Piece[]>([]);
	const [stdin, setStdin] = useState(props.stdin ?? '');
	const [refusal, setRefusal] = useState<string | null>(null);
	const [live, setLive] = useState(false);
	const textarea = useRef<HTMLTextAreaElement>(null);
	const frameHost = useRef<HTMLDivElement>(null);
	const handle = useRef<RunHandle | null>(null);
	const current = useRef<object | null>(null);
	const livePage = useRef<LivePage | null>(null);

	const print = (kind: Piece['kind'], text: string): void => setPieces((shown) => [...shown, { kind, text }]);

	useEffect(() => {
		setHydrated(true);
		const element = textarea.current;
		if (element === null) return;
		// Preact renders no `defaultValue` into the page, and hydration keeps
		// the element as rendered: the document's text is set here.
		element.value = props.code;
		let alive = true;
		let release = (): void => {};
		const unregister = registerSnippet(props.name, () => element.value);
		loadLanguage(props.lang).then(
			(loaded) => {
				if (!alive) return;
				const path = pathOf(props.path ?? loaded.language.entry);
				const editor = textareaEditor(element, path, props.files);
				const subject: Subject = { kind: 'language', id: loaded.language.key };
				const token = showsPage ? preview : props.test && !props.run ? test : run;
				const refresh = (): void => {
					const availability = loaded.instance.availability(subject, token, editor.project.snapshot());
					setRefusal(availability.kind === 'unavailable' ? availability.reason : null);
				};
				refresh();
				const listener = editor.project.onChange(() => {
					refresh();
					setDirty(element.value !== props.code);
					livePage.current?.edited(filesNow({ loaded, editor, path }));
				});
				release = () => {
					listener.dispose();
					editor.dispose();
				};
				setReady({ loaded, editor, path });
				setStatus('');
			},
			(error: unknown) => alive && setStatus(`${info.label} did not load: ${messageOf(error)}`),
		);
		return () => {
			alive = false;
			unregister();
			release();
			livePage.current?.stop();
			handle.current?.stop();
		};
	}, []);

	/** The project as it runs now: the document after the snippets it continues, and the files beside it. */
	const filesNow = (at: Ready): Files => {
		const files = at.editor.project.snapshot().files();
		if (props.continues.length === 0) return files;
		const parts = props.continues.map((id) => ({ id, code: snippetText(id) }));
		return { ...files, [at.path]: joinPrelude(parts, files[at.path] ?? '', info.comment).text };
	};

	const show = (event: RunEvent): void => {
		switch (event.type) {
			case 'state':
				setState(event.state.kind);
				setStatus(statusOf(event.state));
				return;
			case 'output':
				print(event.stream, plain(event.pieces.join('')));
				return;
			case 'notice':
			case 'problem':
				print(event.type, `${event.text}\n`);
				return;
			default:
				return;
		}
	};

	/** Runs the project with `token` (std's `run` or `test`), then gives it the playground's input. */
	const perform = (token: typeof run | typeof test): void => {
		if (ready === null) return;
		let files: Files;
		try {
			files = filesNow(ready);
		} catch (error) {
			setPieces([{ kind: 'problem', text: `${messageOf(error)}\n` }]);
			return;
		}
		setPieces([]);
		const mine = {};
		current.current = mine;
		// Until this run's handle arrives, Stop has nothing to stop: never the replaced run.
		handle.current = null;
		const onEvent = (event: RunEvent): void => {
			if (current.current === mine) show(event);
		};
		const input = { files, entry: ready.path, options: null, snippet: props.name, onEvent };
		const subject: Subject = { kind: 'language', id: ready.loaded.language.key };
		ready.loaded.instance.perform(subject, token, input, snapshotOf(files), new AbortController().signal).then(
			(outcome) => {
				if (current.current !== mine) return;
				if (outcome.kind !== 'done') return show({ type: 'problem', text: outcome.reason });
				handle.current = outcome.value;
				if (props.stdin === null) return;
				// Lines given before the program asks are kept until it does (RunHandle.input).
				for (const line of linesOf(stdin)) outcome.value.input(line);
				outcome.value.endInput();
				if (!crossOriginIsolated) show({ type: 'notice', text: 'This page is not cross-origin isolated, so the program reads end of input at once.' });
			},
			(error: unknown) => current.current === mine && show({ type: 'problem', text: messageOf(error) }),
		);
	};

	/** Opens the live page, or rebuilds it when open. */
	const showPage = (): void => {
		if (ready === null || frameHost.current === null) return;
		if (livePage.current !== null) return livePage.current.reload(filesNow(ready));
		const output = { print, restart: () => setPieces([]), status: setStatus };
		setState('running');
		openLivePage(ready.loaded.instance, ready.loaded.language, snapshotOf(filesNow(ready)), frameHost.current, output).then(
			(opened) => {
				if (typeof opened === 'string') {
					setState('unavailable');
					return setStatus(opened);
				}
				livePage.current = opened;
				setLive(true);
				setState('live');
			},
			(error: unknown) => {
				setState('failed');
				setStatus(messageOf(error));
			},
		);
	};

	const reset = (): void => {
		const element = textarea.current;
		if (element === null) return;
		element.value = props.code;
		element.dispatchEvent(new Event('input'));
	};

	/** Ctrl-Enter (Cmd-Enter) runs; Tab indents rather than leaving the editor. */
	const onKeyDown = (event: KeyboardEvent): void => {
		const element = event.currentTarget;
		if (!(element instanceof HTMLTextAreaElement)) return;
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			if (showsPage) showPage();
			else perform(props.run || !props.test ? run : test);
		} else if (event.key === 'Tab' && !event.shiftKey) {
			event.preventDefault();
			element.setRangeText('  ', element.selectionStart, element.selectionEnd, 'end');
			element.dispatchEvent(new Event('input'));
		}
	};

	const busy = state === 'queued' || state === 'loading' || state === 'running';
	const disabled = ready === null || refusal !== null;
	const rows = Math.max(3, props.code.split('\n').length);

	return (
		<div class="pg" data-state={state} data-hydrated={hydrated ? '' : undefined} data-live={live ? '' : undefined}>
			<div class="pg-code" hidden={editing}>
				{props.children}
			</div>
			<textarea
				ref={textarea}
				class="pg-editor"
				hidden={!editing}
				spellcheck={false}
				autocapitalize="off"
				aria-label={`${info.label} code, editable`}
				rows={rows}
				onKeyDown={onKeyDown}
			/>
			{props.stdin !== null &&
				(hydrated ? (
					<label class="pg-stdin">
						<span>Input</span>
						<textarea class="pg-stdin-text" rows={Math.max(1, linesOf(stdin).length)} value={stdin} onInput={(event) => setStdin(event.currentTarget.value)} />
					</label>
				) : (
					<div class="pg-stdin">
						<span>Input</span>
						<pre class="pg-stdin-text">{props.stdin}</pre>
					</div>
				))}
			{hydrated && (
				<div class="pg-bar">
					<button type="button" class="pg-edit" aria-pressed={editing} onClick={() => setEditing(!editing)} disabled={ready === null}>
						{editing ? 'Done' : 'Edit'}
					</button>
					{dirty && (
						<button type="button" class="pg-reset" onClick={reset}>
							Reset
						</button>
					)}
					<span class="pg-spacer" />
					{showsPage ? (
						<button type="button" class="pg-run primary" onClick={showPage} disabled={disabled} title={refusal ?? 'Build the page and show it; it reloads as you type'}>
							{live ? 'Reload' : 'Show page'}
						</button>
					) : (
						<>
							{props.test && (
								<button type="button" class={`pg-test${props.run ? '' : ' primary'}`} onClick={() => perform(test)} disabled={disabled} title={refusal ?? `Test the ${info.label} code`}>
									Test
								</button>
							)}
							{(props.run || !props.test) && (
								<button type="button" class="pg-run primary" onClick={() => perform(run)} disabled={disabled} title={refusal ?? `Run the ${info.label} code (Ctrl-Enter)`}>
									Run
								</button>
							)}
							<button type="button" class="pg-stop" onClick={() => handle.current?.stop()} disabled={!busy}>
								Stop
							</button>
						</>
					)}
				</div>
			)}
			{hydrated && (
				<p class="pg-status" role="status">
					{ready === null && status === '' ? `Loading ${info.label}…` : status}
				</p>
			)}
			{showsPage && <div class="pg-frame" ref={frameHost} hidden={!live} />}
			{hydrated && pieces.length > 0 && (
				<pre class="pg-output" aria-label="Output">
					{pieces.map((piece, index) => (
						<span key={index} class={piece.kind}>
							{piece.text}
						</span>
					))}
				</pre>
			)}
		</div>
	);
}
