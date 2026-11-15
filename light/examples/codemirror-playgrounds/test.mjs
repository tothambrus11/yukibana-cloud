// Drives the built page in Chromium: three playgrounds on one page, each
// answered by its own language server in its own editor alone.
//
//   pnpm run build && node test.mjs
//
// Serves dist/ cross-origin isolated and /packs/ from $PACKS or Light's
// installed packs (light/app/static/packs). Where the C++ pack is not
// installed, or FAKE_SERVER=1, its server is tests/fake-server.js, which
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
console.log(fake ? '# the C++ pack stood in for by tests/fake-server.js: Run is not checked' : `# the C++ pack from ${packs}`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
/** The file a request names: the fake server for the pack's, a pack's file, or the page's. */
function fileOf(path) {
	if (fake && path === '/packs/cpp/server.js') return join(here, 'tests', 'fake-server.js');
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

/** Applies `changes` (CodeMirror change specs, or a function of the document's text returning them) to playground `id`'s view, as one transaction. */
const edit = (id, changes) =>
	page.evaluate(([i, c]) => {
		const { view } = globalThis.playgrounds[i];
		view.dispatch({ changes: c === null ? [] : c });
	}, [id, changes]);
/** Puts playground `id`'s caret inside the first `word` after `after`, and focuses it. */
const caretOn = (id, word, after = '') =>
	page.evaluate(
		([i, w, a]) => {
			const { view } = globalThis.playgrounds[i];
			const text = view.state.doc.toString();
			view.dispatch({ selection: { anchor: text.indexOf(w, a ? text.indexOf(a) : 0) + 1 } });
			view.focus();
		},
		[id, word, after],
	);
/** The text of every element matching `selector` in section `id`. */
const textsIn = (id, selector) => page.locator(`#${id} ${selector}`).allInnerTexts();

await check('the three language servers start, one each', async () => {
	for (const id of IDS) await page.locator(`#${id} .server`).filter({ hasText: /is running/ }).waitFor({ timeout: 300_000 });
	await page.evaluate(() => Promise.all(Object.values(globalThis.playgrounds).map((p) => p.ready)));
	if (fake) {
		const names = await Promise.all(IDS.map((id) => page.locator(`#${id} .server`).innerText()));
		if (new Set(names).size !== 3) throw new Error(`the servers are not three: ${names.join(' / ')}`);
	}
});

await check("a problem typed into one snippet is marked in that snippet's editor, where it is, and in no other", async () => {
	// Two changes in one transaction, before and after the problem: the
	// server rebuilds the text from both ranges, or marks the wrong place.
	await page.evaluate(() => {
		const { view } = globalThis.playgrounds.hello;
		const end = view.state.doc.length;
		view.dispatch({ changes: [{ from: 0, insert: '// first line\n' }, { from: end, insert: '\nint x = oops;\n' }] });
	});
	await page.locator('#hello .cm-lintRange-error').filter({ hasText: 'oops' }).first().waitFor({ timeout: ANSWER });
	for (const id of ['greet', 'squares']) {
		const others = await textsIn(id, '.cm-lintRange-error');
		if (others.length > 0) throw new Error(`${id} shows ${others.length} problems of another snippet`);
	}
});

await check("completion offers what this snippet's server knows, and nothing of another snippet's", async () => {
	await caretOn('squares', 'squared');
	await page.evaluate(() => {
		const { view } = globalThis.playgrounds.squares;
		const at = view.state.doc.toString().indexOf('int i');
		view.dispatch({ changes: { from: at, insert: 'gree' }, selection: { anchor: at + 4 } });
	});
	await page.keyboard.press('Control+Space');
	const list = page.locator('#squares .cm-tooltip-autocomplete');
	if (fake) {
		await list.waitFor({ timeout: ANSWER }).catch(() => {});
		const options = await textsIn('squares', '.cm-tooltip-autocomplete li');
		if (options.some((option) => option.includes('greet'))) throw new Error(`squares was offered another snippet's greet: ${options.join(', ')}`);
	}
	await page.keyboard.press('Escape');
	await page.keyboard.press('Control+z');

	await page.evaluate(() => {
		const { view } = globalThis.playgrounds.greet;
		const at = view.state.doc.toString().indexOf('std::cout');
		view.dispatch({ changes: { from: at, insert: 'gree' }, selection: { anchor: at + 4 } });
		view.focus();
	});
	await page.keyboard.press('Control+Space');
	await page.locator('#greet .cm-tooltip-autocomplete li').filter({ hasText: /greet/ }).first().waitFor({ timeout: ANSWER });
	await page.keyboard.press('Escape');
	await page.keyboard.press('Control+z');
});

await check("hovering a name shows that snippet's server's answer", async () => {
	const box = await page.evaluate(() => {
		const { view } = globalThis.playgrounds.greet;
		const at = view.state.doc.toString().indexOf('greet("') + 2;
		const coords = view.coordsAtPos(at);
		return { x: coords.left + 1, y: (coords.top + coords.bottom) / 2 };
	});
	await page.mouse.move(box.x, box.y);
	const hover = page.locator('#greet .cm-yukibana-markup');
	await hover.first().waitFor({ timeout: ANSWER });
	const text = await hover.first().innerText();
	if (fake) {
		const name = (await page.locator('#greet .server').innerText()).replace(/ is running\.$/, '');
		if (!text.includes(name)) throw new Error(`the hover is not greet's server's (${name}): ${text}`);
	} else if (!/greeting/.test(text)) throw new Error(`the hover has no header comment: ${text}`);
	await page.mouse.move(0, 0);
});

await check('F12 on a name of the header opens the header, read-only, in the same editor', async () => {
	await caretOn('greet', 'greet', 'greet("');
	await page.keyboard.press('F12');
	await page.waitForFunction(() => globalThis.playgrounds.greet.shown === 'greet.h', null, { timeout: ANSWER });
	const readOnly = await page.evaluate(() => globalThis.playgrounds.greet.view.state.readOnly);
	await page.keyboard.type('x');
	const changed = await page.evaluate(() => globalThis.playgrounds.greet.project.snapshot().file('greet.h').includes('x#pragma'));
	await page.evaluate(() => globalThis.playgrounds.greet.show('main.cpp'));
	if (!readOnly || changed) throw new Error('greet.h is editable');
});

if (fake) {
	await check("Shift+Alt+F formats the snippet as its server says", async () => {
		await page.evaluate(() => {
			const { view } = globalThis.playgrounds.squares;
			view.dispatch({ changes: { from: view.state.doc.line(1).to, insert: '   ' } });
			view.focus();
		});
		await page.keyboard.press('Shift+Alt+F');
		await page.waitForFunction(() => !/[ \t]\n/.test(globalThis.playgrounds.squares.view.state.doc.toString()), null, { timeout: ANSWER });
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

await check('disposing one playground leaves the others answering', async () => {
	await page.evaluate(() => globalThis.playgrounds.hello.dispose());
	if ((await page.locator('#hello .cm-editor').count()) !== 0) throw new Error("hello's editor is still there");
	await edit('squares', { from: 0, insert: 'oops ' });
	await page.locator('#squares .cm-lintRange-error').first().waitFor({ timeout: ANSWER });
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
