// @ts-check
/**
 * The baseline: the runner as a module worker of the page itself, as
 * Light's run.svelte.ts starts it today. The program then runs on the
 * page's origin, with the page's cookies attached to every `fetch` it
 * makes there. Light keeps this (it holds no credentials); the cloud must
 * not.
 */
/** @import { RunnerTransport, RunnerHandle, FromRunner } from './transport' */
import { answer, stdinBuffer, PACK_ID } from './stdin.js';

/**
 * @param {string} base the URL `packs/` is under, normally `document.baseURI`
 * @returns {RunnerTransport}
 */
export function inPageTransport(base) {
	/** @type {Set<Worker>} */
	const workers = new Set();
	return {
		name: 'in-page',
		stdin: globalThis.crossOriginIsolated,
		start(pack) {
			if (!PACK_ID.test(pack)) throw new Error(`not a pack id: ${JSON.stringify(pack)}`);
			const worker = new Worker(new URL(`packs/${pack}/runner.js`, base), { type: 'module' });
			workers.add(worker);
			const stdin = stdinBuffer();
			/** @type {RunnerHandle} */
			const handle = {
				onmessage: null,
				onerror: null,
				send: (message) => worker.postMessage({ ...message, stdin }),
				input: (text) => {
					if (stdin) answer(stdin, text);
				},
				terminate: () => {
					worker.terminate();
					workers.delete(worker);
				},
			};
			worker.onmessage = (/** @type {MessageEvent<FromRunner>} */ e) => handle.onmessage?.(e.data);
			worker.onerror = (e) => {
				e.preventDefault();
				handle.onerror?.(e.message || 'the runner failed to load');
			};
			return handle;
		},
		close() {
			for (const worker of workers) worker.terminate();
			workers.clear();
		},
	};
}
