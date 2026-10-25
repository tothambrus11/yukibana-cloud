/**
 * Stands in for monaco-editor's `internal/common/workers.js` (see
 * vite.config.ts), which the JSON language service imports for
 * `createWebWorker`. The original (checked in monaco-editor 0.57.0) also
 * imports, as side effects, every editor contribution `editor.main`
 * imports, `widget/diffEditor/diffEditor.contribution` among them. That
 * puts everything monaco.ts deliberately leaves out (the diff editor,
 * sticky scroll, inline completions and the rest) into the bundle. And
 * since the JSON service loads that module only when the first JSON model
 * opens, any service those contributions register arrives after the
 * editor's own have started: creating the next editor then fails with
 * "depends on UNKNOWN service ICodeLensCache" (seen before monaco.ts
 * imported code lenses itself; any other late service fails the same way).
 * Once `workers.js` no longer imports contributions, this file and the
 * plugin in vite.config.ts can go: tests/unit/monaco-workers.test.mjs
 * fails on the Monaco upgrade that does it.
 *
 * This is the same function without the side effects: the worker comes from
 * `MonacoEnvironment.getWorker` (set in monaco.ts), is sent the two messages
 * Monaco's worker bootstrap expects, and is handed to the editor's own
 * `createWebWorker`.
 */
import { editor } from 'monaco-editor/editor/editor.api';

interface Options {
	label?: string;
	moduleId?: string;
	createData?: unknown;
	host?: Record<string, (...args: unknown[]) => unknown>;
	keepIdleModels?: boolean;
}

export function createWebWorker<T extends object>(opts: Options): editor.MonacoWebWorker<T> {
	const environment = (globalThis as { MonacoEnvironment?: { getWorker?(id: string, label: string): Worker | Promise<Worker> } }).MonacoEnvironment;
	if (!environment?.getWorker) throw new Error('MonacoEnvironment.getWorker is not set');
	const worker = Promise.resolve(environment.getWorker('workerMain.js', opts.label ?? 'monaco-editor-worker')).then((w) => {
		w.postMessage('ignore');
		w.postMessage(opts.createData);
		return w;
	});
	return editor.createWebWorker<T>({ worker, ...(opts.host ? { host: opts.host } : {}), ...(opts.keepIdleModels !== undefined ? { keepIdleModels: opts.keepIdleModels } : {}) });
}
