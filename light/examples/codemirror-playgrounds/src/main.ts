/**
 * The whole page: one C++ playground in CodeMirror per snippet section,
 * each made by one `createPlayground` call of
 * @yukibana/playground/codemirror, with its own project, language server
 * and view. The host's part is CodeMirror (passed in), the C++ mode and
 * the look (`extensions`: basicSetup, then the playground theme, Monaco's
 * light or dark as the page is), the keys (Tab indents), and the frame
 * around each editor: the file tabs, the server's state, Run and the
 * output.
 */
import * as autocomplete from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import * as language from '@codemirror/language';
import * as lint from '@codemirror/lint';
import * as state from '@codemirror/state';
import * as view from '@codemirror/view';
import * as highlight from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { playgroundTheme } from '@yukibana/codemirror';
import type { Files } from '@yukibana/core';
import { LANGUAGES } from '@yukibana/lang-cpp';
import { createPlayground, type CodeMirrorPlayground } from '@yukibana/playground/codemirror';
import greetHeader from '../cpp/greet.h?raw';
import greet from '../cpp/greet.cpp?raw';
import hello from '../cpp/hello.cpp?raw';
import squares from '../cpp/squares.cpp?raw';

const cm = { state, view, lint, autocomplete };
const syntax = { language, highlight };
const look = playgroundTheme(cm, syntax, matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
// Tab indents, as in Monaco, instead of leaving the editor. CodeMirror
// leaves it out of basicSetup so a keyboard can always get out of an
// editor: Escape and then Tab still moves the focus on (Ctrl-M, or
// Shift-Alt-M on macOS, makes Tab move it until pressed again). The page's
// choice, not the playground's: which keys an editor takes is the host's.
const keys = view.keymap.of([indentWithTab]);

/** Each section's files: what the reader edits, and what is part of the snippet but not offered for editing. */
const SNIPPETS: Readonly<Record<string, { readonly files: Files; readonly hidden?: Files }>> = {
	hello: { files: { 'main.cpp': hello } },
	greet: { files: { 'main.cpp': greet }, hidden: { 'greet.h': greetHeader, 'compile_flags.txt': '-std=c++20\n' } },
	squares: { files: { 'main.cpp': squares } },
};

/** Makes an element of `tag` with class `name`, appended to `parent`. */
function add<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, name: string): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	element.className = name;
	parent.append(element);
	return element;
}

/** A C++ source or header, which gets the C++ mode; anything else (compile_flags.txt) is plain text. */
const isCpp = (path: string): boolean => /\.(c|cc|cpp|h|hpp)$/.test(path);

const playgrounds: Record<string, CodeMirrorPlayground> = {};
for (const [id, snippet] of Object.entries(SNIPPETS)) {
	const section = document.getElementById(id);
	if (section === null) continue;
	const frame = add(section, 'div', 'playground');
	const bar = add(frame, 'div', 'bar');
	const tabs = add(bar, 'div', 'tabs');
	tabs.setAttribute('role', 'tablist');
	const server = add(bar, 'span', 'server');
	server.setAttribute('role', 'status');
	server.textContent = 'Starting…';
	const run = add(bar, 'button', 'run');
	run.type = 'button';
	run.textContent = 'Run';
	const editor = add(frame, 'div', 'editor');
	const console_ = add(frame, 'div', 'console');
	console_.hidden = true;
	const head = add(console_, 'div', 'console-head');
	add(head, 'span', 'console-title').textContent = 'Output';
	const runStatus = add(head, 'span', 'run-status');
	runStatus.setAttribute('role', 'status');
	const output = add(console_, 'pre', 'output');
	output.setAttribute('aria-live', 'polite');

	// A tab per file the reader may look at: the sources, and the headers (read-only).
	const shownFiles = [...Object.keys(snippet.files), ...Object.keys(snippet.hidden ?? {}).filter(isCpp)];
	const tabOf = new Map<string, HTMLButtonElement>();
	const select = (path: string): void => {
		for (const [file, tab] of tabOf) tab.setAttribute('aria-selected', String(file === path));
	};

	const playground = createPlayground({
		cm,
		syntax,
		element: editor,
		extensions: (path) => [basicSetup, keys, look, isCpp(path) ? cpp() : []],
		language: LANGUAGES.cpp,
		...snippet,
		status: (text, serverState) => {
			// clangd names itself twice and its build at length ("clangd clangd
			// version 21.1.8 unix-tidy wasm32-…"): the bar shows the name and
			// version, the tooltip all of it.
			server.textContent = text.replace(/ (?:\S+ )?version (\d[\w.]*)(?: \S+)*?(?= is running\.$)/, ' $1');
			server.title = text;
			server.dataset['state'] = serverState.kind;
		},
		shownChanged: (path) => select(path),
	});
	for (const path of shownFiles) {
		const tab = add(tabs, 'button', 'tab');
		tab.type = 'button';
		tab.setAttribute('role', 'tab');
		tab.textContent = path;
		if (Object.hasOwn(snippet.hidden ?? {}, path)) add(tab, 'span', 'lock').textContent = 'read-only';
		tab.addEventListener('click', () => {
			playground.show(path);
			playground.view.focus();
		});
		tabOf.set(path, tab);
	}
	select(playground.shown);

	run.addEventListener('click', () => {
		console_.hidden = false;
		output.textContent = '';
		void playground.run({
			output: (text, stream) => {
				if (stream === 'stderr') add(output, 'span', 'stderr').textContent = text;
				else output.append(text);
			},
			status: (text) => (runStatus.textContent = text),
		});
	});
	playgrounds[id] = playground;
}

// For the end-to-end test (test.mjs).
Object.assign(globalThis, { playgrounds, cm });
