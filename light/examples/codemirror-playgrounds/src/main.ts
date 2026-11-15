/**
 * The whole page: one C++ playground in CodeMirror per snippet section,
 * each made by one `createPlayground` call of
 * @yukibana/playground/codemirror. Each has its own project, its own
 * language server and its own view; the host's part is CodeMirror
 * (passed in), the C++ mode and the theme (`extensions`), and the
 * section's elements.
 */
import * as autocomplete from '@codemirror/autocomplete';
import { cpp } from '@codemirror/lang-cpp';
import * as lint from '@codemirror/lint';
import * as state from '@codemirror/state';
import * as view from '@codemirror/view';
import { basicSetup } from 'codemirror';
import type { Files } from '@yukibana/core';
import { LANGUAGES } from '@yukibana/lang-cpp';
import { createPlayground, type CodeMirrorPlayground } from '@yukibana/playground/codemirror';
import greetHeader from '../cpp/greet.h?raw';
import greet from '../cpp/greet.cpp?raw';
import hello from '../cpp/hello.cpp?raw';
import squares from '../cpp/squares.cpp?raw';

const cm = { state, view, lint, autocomplete };

/** Each section's files: what the reader edits, and what is part of the snippet but not offered for editing. */
const SNIPPETS: Readonly<Record<string, { readonly files: Files; readonly hidden?: Files }>> = {
	hello: { files: { 'main.cpp': hello } },
	greet: { files: { 'main.cpp': greet }, hidden: { 'greet.h': greetHeader, 'compile_flags.txt': '-std=c++20\n' } },
	squares: { files: { 'main.cpp': squares } },
};

/** The element of `section` that has class `name`. */
const part = (section: HTMLElement, name: string): HTMLElement => section.querySelector<HTMLElement>(`.${name}`) ?? section;

const playgrounds: Record<string, CodeMirrorPlayground> = {};
for (const [id, snippet] of Object.entries(SNIPPETS)) {
	const section = document.getElementById(id);
	if (section === null) continue;
	const playground = createPlayground({
		cm,
		element: part(section, 'editor'),
		// The C++ mode for sources and headers; a compile_flags.txt is plain text.
		extensions: (path) => [basicSetup, /\.(c|cc|cpp|h|hpp)$/.test(path) ? cpp() : []],
		language: LANGUAGES.cpp,
		...snippet,
		status: (text) => (part(section, 'server').textContent = text),
	});
	const output = part(section, 'output');
	part(section, 'run').addEventListener('click', () => {
		output.textContent = '';
		void playground.run({
			output: (text) => output.append(text),
			status: (text) => (part(section, 'run-status').textContent = text),
		});
	});
	playgrounds[id] = playground;
}

// For the end-to-end test (test.mjs).
Object.assign(globalThis, { playgrounds, cm });
