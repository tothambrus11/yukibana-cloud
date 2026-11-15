// Drives the built page in Chromium: three playgrounds in one Monaco on
// one page, each answered by its own language server in its own editor
// alone.
//
//   pnpm run build && node test.mjs
//
// Serves dist/ cross-origin isolated and /packs/ from $PACKS or Light's
// installed packs (light/app/static/packs). Where the C++ pack is not
// installed, or FAKE_SERVER=1, its server is the CodeMirror example's
// stand-in (../codemirror-playgrounds/tests/fake-server.js), which
// answers from its own documents under a name of its own: everything but
// Run is checked against it, which is what CI does. With the pack, the
// same checks run against clangd and Run is checked too. Chromium is
// $CHROMIUM (a Chrome or Edge executable will do), or playwright-core's
// own. Exits non-zero naming every check that failed.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const packs = resolve(process.env.PACKS ?? join(here, '../../app/static/packs'));
const fake = process.env.FAKE_SERVER === '1' || !existsSync(join(packs, 'cpp', 'server.js'));
if (!existsSync(join(dist, 'index.html'))) {
	console.error(`No build in ${dist}: run pnpm run build first.`);
	process.exit(1);
}
console.log(fake ? '# the C++ pack stood in for by ../codemirror-playgrounds/tests/fake-server.js: Run is not checked' : `# the C++ pack from ${packs}`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
/** The file a request names: the fake server for the pack's, a pack's file, or the page's. */
function fileOf(path) {
	if (fake && path === '/packs/cpp/server.js') return join(here, '../codemirror-playgrounds/tests/fake-server.js');
	const [root, rest] = path.startsWith('/packs/') ? [packs, path.slice('/packs/'.length)] : [dist, path.endsWith('/') ? `${path}index.html` : path];
	const file = normalize(join(root, rest));
	return file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile() ? file : null;
}
const server = createServer((request, response) => {
	const file = fileOf(decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname));
	if (file === null) {
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
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
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
const ANSWER = fake ? 10_000 : 120_000;
const IDS = ['hello', 'greet', 'squares'];

/** Puts playground `id`'s caret inside the first `word` after `after` in its shown file, and focuses its editor. */
const caretOn = (id, word, after = '') =>
	page.evaluate(
		([i, w, a]) => {
			const { editor } = globalThis.playgrounds[i];
			const model = editor.getModel();
			const text = model.getValue();
			editor.setPosition(model.getPositionAt(text.indexOf(w, a ? text.indexOf(a) : 0) + 1));
			editor.focus();
		},
		[id, word, after],
	);
/** Inserts `text` before the first `before` of playground `id`'s shown file (at its end when `before` is null), the caret after it. */
const insert = (id, text, before) =>
	page.evaluate(
		([i, t, b]) => {
			const { editor } = globalThis.playgrounds[i];
			const model = editor.getModel();
			const at = b === null ? model.getFullModelRange().getEndPosition() : model.getPositionAt(model.getValue().indexOf(b));
			editor.executeEdits('test', [{ range: new globalThis.monaco.Range(at.lineNumber, at.column, at.lineNumber, at.column), text: t }]);
			editor.setPosition(model.getPositionAt(model.getOffsetAt(at) + t.length));
			editor.focus();
		},
		[id, text, before],
	);
/** Runs editor action `action` in playground `id`. */
const trigger = (id, action) => page.evaluate(([i, a]) => globalThis.playgrounds[i].editor.trigger('test', a, {}), [id, action]);
/** The text of playground `id`'s shown file. */
const textOf = (id) => page.evaluate((i) => globalThis.playgrounds[i].editor.getModel().getValue(), id);
/** The errors marked in playground `id`'s shown file, as their messages. */
const errorsIn = (id) =>
	page.evaluate((i) => {
		const { monaco, playgrounds } = globalThis;
		return monaco.editor.getModelMarkers({ resource: playgrounds[i].editor.getModel().uri }).filter((marker) => marker.severity === monaco.MarkerSeverity.Error).map((marker) => marker.message);
	}, id);
/** The name the stand-in server of playground `id` gave itself. */
const serverOf = async (id) => (await page.locator(`#${id} .server`).innerText()).replace(/ is running\.$/, '');

await check('the three language servers start, one each', async () => {
	for (const id of IDS) await page.locator(`#${id} .server`).filter({ hasText: /is running/ }).waitFor({ timeout: 300_000 });
	await page.evaluate(() => Promise.all(Object.values(globalThis.playgrounds).map((p) => p.ready)));
	if (fake) {
		const names = await Promise.all(IDS.map(serverOf));
		if (new Set(names).size !== 3) throw new Error(`the servers are not three: ${names.join(' / ')}`);
	}
});

await check('every playground has a main.cpp of its own: three models, no two at one address', async () => {
	const uris = await page.evaluate(() => Object.values(globalThis.playgrounds).map((p) => p.editor.getModel().uri.toString()));
	if (new Set(uris).size !== 3 || uris.some((uri) => !uri.endsWith('/main.cpp'))) throw new Error(uris.join(' / '));
});

await check("a problem typed into one snippet is marked in that snippet's editor and in no other", async () => {
	await insert('hello', '\nint x = oops;\n', null);
	await page.waitForFunction(() => globalThis.monaco.editor.getModelMarkers({ resource: globalThis.playgrounds.hello.editor.getModel().uri }).length > 0, null, { timeout: ANSWER });
	if ((await errorsIn('hello')).length === 0) throw new Error('hello shows no error');
	// The others' servers have answered for their own files by now (they are running), and say nothing of hello's.
	for (const id of ['greet', 'squares']) {
		const others = await errorsIn(id);
		if (others.length > 0) throw new Error(`${id} shows ${others.length} problems of another snippet: ${others.join('; ')}`);
	}
});

await check("completion offers what this snippet's server knows, and nothing of another snippet's", async () => {
	const rows = page.locator('.suggest-widget .monaco-list-row');
	await insert('squares', 'gree', 'int i');
	await trigger('squares', 'editor.action.triggerSuggest');
	if (fake) {
		// The stand-in offers every word of its own documents: squares' has no greet.
		await rows.filter({ hasText: /squared/ }).first().waitFor({ timeout: ANSWER }).catch(() => {});
		await insert('squares', 't', 'int i');
		await page.waitForTimeout(500);
		const offered = await rows.filter({ hasText: /greet/ }).allInnerTexts();
		if (offered.length > 0) throw new Error(`squares was offered another snippet's names: ${offered.join(', ')}`);
		await trigger('squares', 'undo');
	}
	await page.keyboard.press('Escape');
	await trigger('squares', 'undo');

	await insert('greet', 'gree', 'std::cout');
	await trigger('greet', 'editor.action.triggerSuggest');
	await rows.filter({ hasText: /greet/ }).first().waitFor({ timeout: ANSWER });
	await page.keyboard.press('Escape');
	await trigger('greet', 'undo');
});

await check("hovering a name shows that snippet's server's answer, once", async () => {
	await caretOn('greet', 'greet', 'greet("');
	await trigger('greet', 'editor.action.showHover');
	const hover = page.locator('.monaco-hover-content').filter({ hasText: fake ? /said by/ : /greeting/ });
	await hover.first().waitFor({ timeout: ANSWER });
	const text = await hover.first().innerText();
	if (fake) {
		// One part per server that answered: greet's alone.
		const said = text.match(/said by fake-\w+/g) ?? [];
		const name = await serverOf('greet');
		if (said.length !== 1 || said[0] !== `said by ${name}`) throw new Error(`the hover is not greet's server's alone (${name}): ${text}`);
	}
	await page.keyboard.press('Escape');
});

await check('F12 on a name of the header opens the header, read-only, in the same editor', async () => {
	await caretOn('greet', 'greet', 'greet("');
	await trigger('greet', 'editor.action.revealDefinition');
	try {
		await page.waitForFunction(() => globalThis.playgrounds.greet.shown === 'greet.h', null, { timeout: ANSWER });
	} finally {
		// Back to main.cpp for what follows, whatever happened.
		var readOnly = await page.evaluate(() => globalThis.playgrounds.greet.editor.getOption(globalThis.monaco.editor.EditorOption.readOnly));
		var label = await page.locator('#greet .file').innerText();
		await page.locator('#greet .file').click();
	}
	if (!readOnly || !label.includes('greet.h')) throw new Error(`greet.h is ${readOnly ? 'read-only' : 'editable'}, under the name "${label}"`);
	if ((await page.evaluate(() => globalThis.playgrounds.greet.shown)) !== 'main.cpp') throw new Error("the file's name did not go back to main.cpp");
});

if (fake) {
	// Monaco asks one formatter per model, not every one registered: each playground's must be its own.
	await check('Format Document formats each snippet as its own server says, the first made and the last', async () => {
		for (const id of ['squares', 'hello']) {
			await insert(id, '   ', '\n');
			await trigger(id, 'editor.action.formatDocument');
			await page.waitForFunction((i) => !/[ \t]\n/.test(globalThis.playgrounds[i].editor.getModel().getValue()), id, { timeout: ANSWER }).catch(() => {
				throw new Error(`${id} was not formatted`);
			});
		}
	});
} else {
	await check('Run in each snippet prints what that snippet prints', async () => {
		for (const [id, expected] of [
			['greet', 'Hello, second snippet!'],
			['squares', '5 squared is 25'],
		]) {
			await page.locator(`#${id} .run`).click();
			await page.locator(`#${id} .run-status`).filter({ hasText: /Exited with code 0/ }).waitFor({ timeout: 300_000 });
			const output = await page.locator(`#${id} .output`).innerText();
			if (!output.includes(expected)) throw new Error(`${id}'s output has no "${expected}":\n${output}`);
		}
	});
}

await check('F2 renames a name in its own snippet, and in no other that has the same name', async () => {
	const before = await textOf('greet');
	await caretOn('squares', 'main');
	await trigger('squares', 'editor.action.rename');
	const input = page.locator('.rename-box input');
	await input.waitFor({ timeout: ANSWER });
	await input.fill('start');
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => globalThis.playgrounds.squares.editor.getModel().getValue().includes('int start()'), null, { timeout: ANSWER });
	if ((await textOf('greet')) !== before) throw new Error("greet's main.cpp changed too");
	await trigger('squares', 'undo');
});

await check('disposing one playground leaves the others answering, and takes its models with it', async () => {
	const models = await page.evaluate(() => {
		globalThis.playgrounds.hello.dispose();
		return globalThis.monaco.editor.getModels().map((model) => model.uri.path);
	});
	// greet's three files and squares' one.
	if (models.length !== 4) throw new Error(`the models left are ${models.join(', ')}`);
	await insert('squares', 'oops ', '#include');
	await page.waitForFunction(() => globalThis.monaco.editor.getModelMarkers({ resource: globalThis.playgrounds.squares.editor.getModel().uri }).length > 0, null, { timeout: ANSWER });
});

await check('nothing threw, and nothing was logged as an error', async () => {
	if (errors.length > 0) throw new Error(errors.join('\n'));
});

await browser.close();
server.close();
if (failures.length > 0) {
	console.error(`\n${failures.length} check(s) failed: ${failures.join('; ')}`);
	process.exit(1);
}
