// Drives the built page in Chromium with the installed C++ pack: what the
// page promises, each against the library.
//
//   pnpm run build && node test.mjs
//
// Serves dist/ cross-origin isolated and /packs/ from $PACKS or Light's
// installed packs (light/app/static/packs: the cpp pack must be there).
// Chromium is $CHROMIUM (a Chrome or Edge executable will do), or
// playwright-core's own. Exits non-zero naming every check that failed.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const packs = normalize(process.env.PACKS ?? join(here, '../../app/static/packs'));
if (!existsSync(join(dist, 'index.html'))) {
	console.error(`No build in ${dist}: run pnpm run build first.`);
	process.exit(1);
}
if (!existsSync(join(packs, 'cpp', 'server.js'))) {
	console.error(`The cpp pack is not installed in ${packs}: install it (node ../../setup/cli.mjs cpp), or set PACKS.`);
	process.exit(1);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.ttf': 'font/ttf' };
const server = createServer((request, response) => {
	const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
	const [root, rest] = path.startsWith('/packs/') ? [packs, path.slice('/packs/'.length)] : [dist, path.endsWith('/') ? `${path}index.html` : path];
	const file = normalize(join(root, rest));
	if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
		response.writeHead(404).end();
		return;
	}
	response.writeHead(200, {
		'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'require-corp',
		'Cross-Origin-Resource-Policy': 'same-origin',
	});
	response.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
const { port } = server.address();

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
await page.goto(`http://127.0.0.1:${port}/`);

const failures = [];
async function check(name, body) {
	try {
		await body();
		console.log(`ok - ${name}`);
	} catch (error) {
		failures.push(name);
		console.log(`not ok - ${name}\n  ${String(error instanceof Error ? error.message : error).replaceAll('\n', '\n  ')}`);
	}
}
const ANSWER = 120_000;

/** Puts the caret inside the first `word` after `after` in the shown file. */
const caretOn = (word, after = '') =>
	page.evaluate(
		([w, a]) => {
			const { editor } = globalThis.playground;
			const model = editor.getModel();
			const text = model.getValue();
			editor.setPosition(model.getPositionAt(text.indexOf(w, a ? text.indexOf(a) : 0) + 1));
			editor.focus();
		},
		[word, after],
	);
const trigger = (action) => page.evaluate((id) => globalThis.playground.editor.trigger('test', id, {}), action);

await check('the C++ language server starts', async () => {
	await page.locator('#server').filter({ hasText: /is running/ }).waitFor({ timeout: 300_000 });
	await page.evaluate(() => globalThis.playground.ready);
});

await check("hovering a library function shows its declaration and comment from the library's header, found through -Ilib/include", async () => {
	await caretOn('describe', 'square.');
	await trigger('editor.action.showHover');
	await page.locator('.monaco-hover-content').filter({ hasText: /one-line description/ }).first().waitFor({ timeout: ANSWER });
	await page.keyboard.press('Escape');
});

await check("completion after `square.` offers the library class's members", async () => {
	await page.evaluate(() => {
		const { editor, monaco } = { editor: globalThis.playground.editor, monaco: globalThis.monaco };
		const model = editor.getModel();
		const at = model.getPositionAt(model.getValue().indexOf('square.describe') + 'square.'.length);
		editor.executeEdits('test', [{ range: new monaco.Range(at.lineNumber, at.column, at.lineNumber, at.column), text: 'per' }]);
		editor.setPosition({ lineNumber: at.lineNumber, column: at.column + 3 });
		editor.focus();
	});
	await trigger('editor.action.triggerSuggest');
	await page.locator('.suggest-widget .monaco-list-row').filter({ hasText: /perimeter/ }).first().waitFor({ timeout: ANSWER });
	await page.keyboard.press('Escape');
	await page.evaluate(() => globalThis.playground.editor.trigger('test', 'undo', {}));
});

await check("go to definition opens the library's source, and go to declaration its header, both read-only", async () => {
	for (const [action, file] of [
		['editor.action.revealDefinition', 'lib/src/geometry.cpp'],
		['editor.action.revealDeclaration', 'lib/include/geometry.h'],
	]) {
		await caretOn('regular', 'geometry::regular');
		await trigger(action);
		try {
			await page.waitForFunction((f) => globalThis.playground.shown === f, file, { timeout: ANSWER });
		} catch {
			throw new Error(`${action} showed ${await page.evaluate(() => globalThis.playground.shown)}, not ${file}`);
		} finally {
			// Back to main.cpp for what follows, whatever happened.
			var readOnly = await page.evaluate(() => globalThis.playground.editor.getOption(globalThis.monaco.editor.EditorOption.readOnly));
			await page.evaluate(() => globalThis.playground.show('main.cpp'));
		}
		if (!readOnly) throw new Error(`${file} is editable`);
	}
});

await check('Run compiles main.cpp with the library, links them and prints the results', async () => {
	await page.locator('#run').click();
	await page.locator('#run-status').filter({ hasText: /Exited with code 0/ }).waitFor({ timeout: 300_000 });
	const output = await page.locator('#output').innerText();
	for (const expected of ['square: 4 corners, area 4, perimeter 8', '3-gon: 3 corners, area 1.299', '96-gon: 96 corners, area 3.139'])
		if (!output.includes(expected)) throw new Error(`the output has no "${expected}":\n${output}`);
});

await check('an error typed into main.cpp is marked in the editor', async () => {
	await page.evaluate(() => {
		const { editor } = globalThis.playground;
		const model = editor.getModel();
		const end = model.getFullModelRange().getEndPosition();
		editor.executeEdits('test', [{ range: new globalThis.monaco.Range(end.lineNumber, end.column, end.lineNumber, end.column), text: '\ngeometry::Polygon broken = 3;\n' }]);
	});
	await page.waitForFunction(
		() => globalThis.monaco.editor.getModelMarkers({ resource: globalThis.playground.editor.getModel().uri }).some((m) => m.severity === globalThis.monaco.MarkerSeverity.Error),
		null,
		{ timeout: ANSWER },
	);
});

await check('without the pack, the page says which pack is not served and raises no error', async () => {
	const other = await browser.newPage();
	const raised = [];
	other.on('pageerror', (error) => raised.push(String(error)));
	await other.route('**/packs/**', (route) => route.fulfill({ status: 404 }));
	await other.goto(`http://127.0.0.1:${port}/`);
	await other.locator('#server').filter({ hasText: 'The cpp pack is not served at' }).waitFor({ timeout: ANSWER });
	await other.close();
	if (raised.length > 0) throw new Error(raised.join('\n'));
});

// Last of the checks that use the playground: it is gone afterwards.
await check('a playground disposed as a run starts resolves the run as cancelled and leaves no worker of the pack', async () => {
	const ended = await page.evaluate(() => {
		const running = globalThis.playground.run();
		globalThis.playground.dispose();
		return running;
	});
	if (ended.kind !== 'cancelled' || ended.why !== 'disposed') throw new Error(`the run ended as ${JSON.stringify(ended)}`);
	// The language server is given a moment to answer its shutdown; a runner is ended at once.
	const ofThePack = () => page.workers().filter((worker) => new URL(worker.url()).pathname.startsWith('/packs/'));
	for (let waited = 0; ofThePack().length > 0 && waited < 5000; waited += 250) await new Promise((resolve) => setTimeout(resolve, 250));
	if (ofThePack().length > 0) throw new Error(`still running: ${ofThePack().map((worker) => worker.url()).join(', ')}`);
});

await check('the page raised no error', async () => {
	if (errors.length > 0) throw new Error(errors.join('\n'));
});

await browser.close();
server.close();
if (failures.length > 0) {
	console.log(`\n${failures.length} failed`);
	process.exit(1);
}
console.log('\nall passed');
