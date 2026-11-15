/**
 * The whole page: one C++ playground per snippet section, all in the one
 * Monaco the page imports, each made by one `createPlayground` call of
 * @yukibana/playground, with its own models, language server and editor.
 * The host's part is Monaco (passed in), what Monaco keeps once per page
 * (its editor worker and its theme, set here), and the frame around each
 * editor: the shown file's name, the server's state, Run and the output.
 *
 * The snippets are the CodeMirror example's (../codemirror-playgrounds),
 * copied: the same page in the other editor.
 */
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import type { Files } from '@yukibana/core';
import { LANGUAGES } from '@yukibana/lang-cpp';
import { createPlayground, type Playground } from '@yukibana/playground';
import greetHeader from '../cpp/greet.h?raw';
import greet from '../cpp/greet.cpp?raw';
import hello from '../cpp/hello.cpp?raw';
import squares from '../cpp/squares.cpp?raw';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
// The theme is Monaco's, one for every editor of the page: the page's to set, not a playground's.
monaco.editor.setTheme(matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs');

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

const playgrounds: Record<string, Playground> = {};
for (const [id, snippet] of Object.entries(SNIPPETS)) {
	const section = document.getElementById(id);
	if (section === null) continue;
	const frame = add(section, 'div', 'playground');
	const bar = add(frame, 'div', 'bar');
	const file = add(bar, 'button', 'file');
	file.type = 'button';
	file.title = 'Back to main.cpp';
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

	const playground = createPlayground({
		monaco,
		element: editor,
		language: LANGUAGES.cpp,
		...snippet,
		status: (text, state) => {
			// clangd names itself twice and its build at length ("clangd clangd
			// version 21.1.8 unix-tidy wasm32-…"): the bar shows the name and
			// version, the tooltip all of it.
			server.textContent = text.replace(/ (?:\S+ )?version (\d[\w.]*)(?: \S+)*?(?= is running\.$)/, ' $1');
			server.title = text;
			server.dataset['state'] = state.kind;
		},
	});
	// The shown file's name, and whether it is one the reader may edit (F12 into the header shows it read-only).
	const name = (): void => {
		file.textContent = Object.hasOwn(snippet.files, playground.shown) ? playground.shown : `${playground.shown} (read-only)`;
	};
	playground.editor.onDidChangeModel(name);
	name();
	file.addEventListener('click', () => playground.show(playground.entry));

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
Object.assign(globalThis, { playgrounds, monaco });
