// The app's stand-in for Monaco's `internal/common/workers.js`
// (src/lib/monaco-workers.ts, swapped in by vite.config.ts), read against
// the installed Monaco: the other internal of Monaco the app depends on,
// beside the ones @yukibana/monaco's adapter reaches (whose canary is
// light/modules/tests/internals.test.mjs). On a Monaco upgrade these say
// whether the stand-in still replaces anything, and whether it is still
// needed.
//
//   node --test tests/unit/monaco-workers.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const vs = join(here, '../../node_modules/monaco-editor/esm/vs');
const workers = join(vs, 'internal/common/workers.js');

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
