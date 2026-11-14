/**
 * The browser half of CppPlayground.svelte, imported by its onMount: Monaco,
 * its editor worker and the playground. Kept out of the component's own
 * imports so that the prerender, which runs in Node, never loads Monaco
 * (which needs a DOM) or a worker.
 */
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { LANGUAGES } from '@yukibana/lang-cpp';
import { createPlayground, type Playground } from '@yukibana/playground';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

/** A C++ playground in `element`: `files` edited, `hidden` read by the server and compiled by Run; `status` hears what the server is doing. */
export function createCppPlayground(element: HTMLElement, files: Record<string, string>, hidden: Record<string, string>, status: (text: string) => void): Playground {
	// The packs are at the site's root (vite.config.ts), not beside whichever route shows the component.
	const playground = createPlayground({ monaco, element, language: LANGUAGES.cpp, files, hidden, status, packs: new URL('/packs/', location.origin) });
	// For the end-to-end test (test.mjs).
	Object.assign(globalThis, { playground, monaco });
	return playground;
}
