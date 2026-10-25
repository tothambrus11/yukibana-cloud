// What the built app is made of (build/_app, written by `npm run build`): it
// carries Yukibana's own language client and not Monaco's (src/lib/lsp/client.ts
// says why), which `editor.main` would bring in as `monaco.lsp`.
//
//   npm run build && node --test tests/unit/bundle.test.mjs
//
// Without a build there is nothing to read, so the test is skipped and says
// so; with BUNDLE_REQUIRED=1 (CI, after its build step) a missing build fails.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../../build/_app/', import.meta.url));
const built = existsSync(app);
if (!built && process.env.BUNDLE_REQUIRED === '1') throw new Error(`BUNDLE_REQUIRED=1, but ${app} does not exist: run npm run build first.`);
const skip = built ? false : `${app} does not exist: run npm run build first`;

/** Every uncompressed file under `dir`, as paths; the .br and .gz copies say the same thing. */
function files(dir) {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && !/\.(br|gz)$/.test(entry.name))
		.map((entry) => join(entry.parentPath, entry.name));
}

test("the built app does not carry Monaco's own language client", { skip }, () => {
	const scripts = files(app).filter((path) => path.endsWith('.js'));
	assert.ok(scripts.length > 0, `${app} has no scripts: the build is incomplete`);
	// Its name survives minification as a key of `monaco.lsp`, and
	// `_capabilitiesRegistry` as a string the client's field initialisers
	// pass (checked against a minified bundle of the client, 0.57.0).
	for (const marker of ['MonacoLspClient', '_capabilitiesRegistry']) {
		const carrying = files(app).filter((path) => readFileSync(path, 'latin1').includes(marker));
		assert.deepEqual(carrying, [], `these built files contain ${marker}`);
	}
});
