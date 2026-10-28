// The app's stand-in for Monaco's `internal/common/workers.js`
// (src/lib/monaco-workers.ts, swapped in by vite.config.ts), read against
// the installed Monaco: the other internal of Monaco the app depends on,
// beside the ones @yukibana/monaco's adapter reaches (whose canary is
// light/modules/tests/internals.test.mjs). On a Monaco upgrade these say
// whether the stand-in still replaces anything, and whether it is still
// needed, and whether what the stand-in copies (how Monaco gets a worker,
// the two messages it sends it, what it hands the editor's createWebWorker)
// is still what Monaco does: a change there would pass the build and break
// the JSON, HTML and CSS services only in a browser.
//
//   node --test tests/unit/monaco-workers.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CHECKED_WITH } from '../../../modules/monaco/internals.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ts = createRequire(import.meta.url)('typescript');
const monacoEditor = join(here, '../../node_modules/monaco-editor');
const vs = join(monacoEditor, 'esm/vs');
const workers = join(vs, 'internal/common/workers.js');

/**
 * Monaco's `getWorker` and `createWebWorker` in workers.js, as read when the
 * stand-in was written (monaco-editor 0.57.0), printed without comments by
 * TypeScript's printer so that only a change of code differs. The stand-in
 * copies the `MonacoEnvironment.getWorker('workerMain.js', label)` branch
 * (the app sets getWorker), the messages 'ignore' and then createData, and
 * the options worker, host and keepIdleModels.
 */
const RECORDED = `function getWorker(descriptor) {
    const label = descriptor.label;
    const monacoEnvironment = globalThis.MonacoEnvironment;
    if (monacoEnvironment) {
        if (typeof monacoEnvironment.getWorker === "function") {
            return monacoEnvironment.getWorker("workerMain.js", label);
        }
        if (typeof monacoEnvironment.getWorkerUrl === "function") {
            const workerUrl = monacoEnvironment.getWorkerUrl("workerMain.js", label);
            return new Worker(ttPolicy ? ttPolicy.createScriptURL(workerUrl) : workerUrl, { name: label, type: "module" });
        }
    }
    if (descriptor.createWorker) {
        return descriptor.createWorker();
    }
    throw new Error(\`You must define a function MonacoEnvironment.getWorkerUrl or MonacoEnvironment.getWorker\`);
}
function createWebWorker(opts) {
    const worker = Promise.resolve(getWorker({
        label: opts.label ?? "monaco-editor-worker",
        moduleId: opts.moduleId,
        createWorker: opts.createWorker
    })).then((w) => {
        w.postMessage("ignore");
        w.postMessage(opts.createData);
        return w;
    });
    return editor.createWebWorker({
        worker,
        host: opts.host,
        keepIdleModels: opts.keepIdleModels
    });
}`;

/** The functions named `names` in `source`, printed as RECORDED is; a name the module no longer declares is left out. */
function printed(source, names) {
	const file = ts.createSourceFile('workers.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	const printer = ts.createPrinter({ removeComments: true });
	return file.statements
		.filter((s) => ts.isFunctionDeclaration(s) && names.includes(s.name?.text))
		.map((s) => printer.printNode(ts.EmitHint.Unspecified, s, file))
		.join('\n');
}

test("the module the app stands in for is still Monaco's, still exports createWebWorker, and the JSON, HTML and CSS services still import it", () => {
	assert.ok(existsSync(workers), 'monaco-editor/esm/vs/internal/common/workers.js is gone: the plugin in vite.config.ts no longer replaces anything; find what the language services use now');
	assert.match(readFileSync(workers, 'utf8'), /export \{[^}]*\bcreateWebWorker\b[^}]*\}/);
	for (const service of ['json', 'html', 'css']) {
		const manager = readFileSync(join(vs, `languages/features/${service}/workerManager.js`), 'utf8');
		assert.match(manager, /internal\/common\/workers\.js['"]/, `${service}'s worker manager no longer imports workers.js`);
	}
});

test("the stand-in is still needed: Monaco's own workers.js imports the diff editor, which the app leaves out, as a side effect", () => {
	assert.match(
		readFileSync(workers, 'utf8'),
		/^import '[^']*diffEditor\.contribution\.js';$/m,
		'workers.js no longer imports editor contributions: src/lib/monaco-workers.ts and the plugin in vite.config.ts can go',
	);
});

test("Monaco still starts a language service's worker the way the stand-in does: getWorker('workerMain.js', label), then 'ignore', then createData, then worker, host and keepIdleModels", () => {
	assert.equal(
		printed(readFileSync(workers, 'utf8'), ['getWorker', 'createWebWorker']),
		RECORDED,
		"Monaco's workers.js starts its workers differently from what src/lib/monaco-workers.ts copies: bring the stand-in in line with the new code, then record it here",
	);
});

test('a change to how Monaco starts a worker, however small, fails the comparison with the recorded copy', () => {
	const source = RECORDED.replace('w.postMessage("ignore");', 'w.postMessage({ type: "init" });');
	assert.notEqual(printed(source, ['getWorker', 'createWebWorker']), RECORDED);
	assert.equal(printed(`// a comment\n${RECORDED.replaceAll('    ', '\t')}`, ['getWorker', 'createWebWorker']), RECORDED);
});

test('a Monaco upgrade fails until a person has read the stand-in again against the new workers.js', () => {
	const { version } = JSON.parse(readFileSync(join(monacoEditor, 'package.json'), 'utf8'));
	assert.equal(
		version,
		CHECKED_WITH,
		`monaco-editor ${version} is installed, and src/lib/monaco-workers.ts was read against ${CHECKED_WITH}: ` +
			"compare it with the new internal/common/workers.js, then set CHECKED_WITH in light/modules/monaco/internals.ts (whose entries are read again too)",
	);
});
