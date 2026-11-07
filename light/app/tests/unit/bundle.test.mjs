// What the built app is made of (build/_app, written by `npm run build`): it
// carries Yukibana's own language client and not Monaco's (src/lib/lsp/client.ts
// says why), which `editor.main` would bring in as `monaco.lsp`; and what a
// first page load downloads stays within 1% of bundle-baseline.json, so that
// moving the app's decisions into light/modules (light/modules/DESIGN.md)
// cannot make Light heavier unnoticed.
//
//   npm run build && node --test tests/unit/bundle.test.mjs
//
// Without a build there is nothing to read, so the test is skipped and says
// so; with BUNDLE_REQUIRED=1 (CI, after its build step) a missing build fails.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const build = fileURLToPath(new URL('../../build/', import.meta.url));
const app = join(build, '_app');
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

/**
 * The files a first load of the page fetches before it runs: the scripts the
 * prerendered index.html preloads and the stylesheets it links, as paths
 * relative to the build.
 */
function initialSet() {
	const page = readFileSync(join(build, 'index.html'), 'utf8');
	return [...page.matchAll(/<link\b[^>]*>/g)]
		.map(([tag]) => ({ href: /\bhref="\.\/([^"]+)"/.exec(tag)?.[1], rel: /\brel="([^"]+)"/.exec(tag)?.[1] }))
		.filter(({ href, rel }) => href !== undefined && href.startsWith('_app/') && (rel === 'modulepreload' || rel === 'stylesheet'))
		.map(({ href }) => href);
}

test('a first load of the page downloads at most 1% more than the recorded baseline', { skip }, () => {
	const { initialGzipBytes } = JSON.parse(readFileSync(fileURLToPath(new URL('../../bundle-baseline.json', import.meta.url)), 'utf8'));
	const files = initialSet();
	assert.ok(files.some((path) => path.endsWith('.js')), 'index.html preloads no script: the build is incomplete, or its links changed shape');
	const bytes = files.reduce((sum, path) => sum + gzipSync(readFileSync(join(build, path)), { level: 9 }).length, 0);
	const limit = Math.floor(initialGzipBytes * 1.01);
	assert.ok(bytes <= limit, `the initial set is ${bytes} B gzipped, over ${limit} B (bundle-baseline.json's ${initialGzipBytes} B and 1%): ${files.join(', ')}`);
});
