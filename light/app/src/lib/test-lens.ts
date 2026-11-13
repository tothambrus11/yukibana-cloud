/**
 * "Run test" and "Debug test" above each test of the file an editor shows:
 * Monaco code lenses over std's `findTests`, which the language's package
 * answers (lang-cpp's test-cases.ts). Offered only where the language
 * finds tests and one can be run alone (`findTests` requires `testCase`),
 * and "Debug test" only where Debug tests is available too (std's
 * `debugTestCase`: refused on a Linux target, as Debug tests is). A lens
 * and not the glyph margin, which is the breakpoints'.
 *
 * Monaco merges these with a language server's lenses (MonacoBinding's).
 */
import { debugTestCase } from '@yukibana/std';
import type { TestSelector } from '@yukibana/protocol';
import { monaco } from './monaco';
import { WORKSPACE } from './project';
import type { Workspace } from './workspace.svelte';
import { subjectOf, yukibana } from './yukibana';

const RUN_TEST = 'yukibana.lens.runTest';
const DEBUG_TEST = 'yukibana.lens.debugTest';

/** `true` iff `value` is a test selector, as a lens's command hands its argument back untyped. */
function isSelector(value: unknown): value is TestSelector {
	if (typeof value !== 'object' || value === null || !('file' in value) || !('suite' in value) || !('name' in value)) return false;
	return typeof value.file === 'string' && (value.suite === null || typeof value.suite === 'string') && typeof value.name === 'string';
}

/**
 * Registers the test lenses of `workspace`'s project, for every editor, and
 * their two commands; the lenses are asked for again after each change of
 * the project, since a change of another file (compile_flags.txt's target,
 * a second framework in tests/) can change what is offered. Returns what
 * takes them away. Called once, by the workspace.
 */
export function registerTestLenses(workspace: Workspace): monaco.IDisposable {
	const changed = new monaco.Emitter<monaco.languages.CodeLensProvider>();
	const provider: monaco.languages.CodeLensProvider = {
		onDidChange: changed.event,
		provideCodeLenses: async (model) => {
			const path = WORKSPACE.pathOf(model.uri.toString());
			const tests = path === null ? [] : await workspace.testsIn(path);
			const subject = subjectOf(workspace.language);
			const debugs = tests.length > 0 && yukibana().has(subject, debugTestCase) && yukibana().availability(subject, debugTestCase, workspace.snapshot()).kind === 'available';
			const lenses = tests.flatMap((test): monaco.languages.CodeLens[] => {
				const range = { startLineNumber: test.line, startColumn: 1, endLineNumber: test.line, endColumn: 1 };
				const run = { range, command: { id: RUN_TEST, title: 'Run test', tooltip: 'Run this test alone', arguments: [test.selector] } };
				return debugs ? [run, { range, command: { id: DEBUG_TEST, title: 'Debug test', tooltip: 'Run this test alone under the debugger', arguments: [test.selector] } }] : [run];
			});
			return { lenses, dispose: () => {} };
		},
	};
	const project = workspace.onChange(() => changed.fire(provider));
	const disposables = [
		monaco.languages.registerCodeLensProvider('*', provider),
		monaco.editor.registerCommand(RUN_TEST, (_, selector: unknown) => {
			if (isSelector(selector)) workspace.runTest(selector);
		}),
		monaco.editor.registerCommand(DEBUG_TEST, (_, selector: unknown) => {
			if (isSelector(selector) && !workspace.debugging) void workspace.debug(selector);
		}),
	];
	return {
		dispose: () => {
			project.dispose();
			for (const d of disposables) d.dispose();
			changed.dispose();
		},
	};
}
