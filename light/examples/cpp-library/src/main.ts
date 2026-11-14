/**
 * The whole page: C++ in Monaco against the geometry library (cpp/lib),
 * with the language server's answers in the editor and Run building
 * main.cpp with the library and running it. Everything but the page's
 * three elements is @yukibana/playground's.
 */
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { LANGUAGES } from '@yukibana/lang-cpp';
import { createPlayground } from '@yukibana/playground';
import main from '../cpp/main.cpp?raw';
import header from '../cpp/lib/include/geometry.h?raw';
import source from '../cpp/lib/src/geometry.cpp?raw';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const element = (id: string): HTMLElement => document.getElementById(id) ?? document.body;
const output = element('output');

const playground = createPlayground({
	monaco,
	element: element('editor'),
	language: LANGUAGES.cpp,
	// What the reader edits.
	files: { 'main.cpp': main },
	// The library: read by the language server, compiled and linked by Run, not editable.
	hidden: {
		'lib/include/geometry.h': header,
		'lib/src/geometry.cpp': source,
		'compile_flags.txt': '-std=c++20\n-Ilib/include\n',
	},
	status: (text) => (element('server').textContent = text),
});

element('run').addEventListener('click', () => {
	output.textContent = '';
	void playground.run({
		output: (text) => output.append(text),
		status: (text) => (element('run-status').textContent = text),
	});
});

// For the end-to-end test (test.mjs).
Object.assign(globalThis, { playground, monaco });
