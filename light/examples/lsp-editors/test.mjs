// Drives the built pages in Chromium with Light's installed packs: each
// language's server answering in Monaco (through MonacoBinding) and in the
// textarea page (whose own client draws the answers).
//
//   pnpm run build && node test.mjs [language...]
//
// For every language (or those named), on both pages: the server starts,
// and an error the test types in is reported (Monaco's markers; the
// textarea page's problems list). For Python, on both pages, also: a hover
// over a name, completion offered and accepted, and go to definition into
// another file of the project.
//
// Serves dist/ cross-origin isolated and /packs/ from $PACKS or Light's
// installed packs (light/app/static/packs). Chromium is $CHROMIUM, or
// playwright-core's own. A language whose pack is not installed is skipped,
// and said to be. Exits non-zero naming every check that failed.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const packs = normalize(process.env.PACKS ?? join(here, '../../app/static/packs'));
if (!existsSync(join(dist, 'monaco.html'))) {
	console.error(`No build in ${dist}: run pnpm run build first.`);
	process.exit(1);
}

/** Each language: its pack, and a line that makes its server report an error, added at the end of the entry file. */
const LANGUAGES = [
	{ key: 'python', pack: 'python', broken: '\nbroken: int = "not a number"\n' },
	{ key: 'cpp', pack: 'cpp', broken: '\nint broken = "not a number";\n' },
	{ key: 'rust', pack: 'rust', broken: '\nfn broken( {\n' },
	{ key: 'go', pack: 'go', broken: '\nvar broken int = "not a number"\n' },
	{ key: 'typescript', pack: 'javascript', broken: '\nconst broken: number = "not a number";\n' },
	{ key: 'javascript', pack: 'javascript', broken: '\nconst broken = ;\n' },
];
const asked = process.argv.slice(2);
const languages = LANGUAGES.filter((l) => asked.length === 0 || asked.includes(l.key));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.ttf': 'font/ttf' };

/** The file `path` names: under /packs/ one of the packs', anywhere else one of dist/; null when there is none. */
function fileOf(path) {
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
const address = server.address();
const origin = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const failures = [];
/** Runs one check, recording its failure by name rather than stopping. */
let checks = 0;
async function check(name, body) {
	checks += 1;
	try {
		await body();
		console.log(`ok - ${name}`);
	} catch (error) {
		failures.push(name);
		console.log(`not ok - ${name}\n  ${String(error instanceof Error ? error.message : error).replaceAll('\n', '\n  ')}`);
	}
}

/** How long a server may take to start: the first start downloads a compiler's worth of pack. */
const START = 300_000;
/** How long an answer may take once the server runs. */
const ANSWER = 90_000;

/** Opens `page` (monaco or textarea) for `key`, waiting for its server to run; the page's log is printed when it fails. */
async function open(name, key) {
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(String(error)));
	await page.goto(`${origin}/${name}.html?language=${key}`);
	try {
		await page.locator('body[data-server="running"]').waitFor({ state: 'attached', timeout: START });
	} catch (error) {
		const log = await page.locator('#log').innerText().catch(() => '');
		throw new Error(`${String(error)}\nthe page's log:\n${log}${errors.length ? `\npage errors:\n${errors.join('\n')}` : ''}`);
	}
	return page;
}

// ---- Monaco --------------------------------------------------------------

/** Appends `text` to the editor's model, as typing at its end would. */
const appendInMonaco = (page, text) =>
	page.evaluate((added) => {
		const { editor, monaco } = globalThis.lspMonaco;
		const model = editor.getModel();
		const end = model.getFullModelRange().getEndPosition();
		editor.executeEdits('test', [{ range: new monaco.Range(end.lineNumber, end.column, end.lineNumber, end.column), text: added }]);
		return model.getLineCount();
	}, text);

/** The error markers of the editor's model, as text. */
const monacoErrors = (page) =>
	page.evaluate(() => {
		const { editor, monaco } = globalThis.lspMonaco;
		return monaco.editor
			.getModelMarkers({ resource: editor.getModel().uri })
			.filter((m) => m.severity === monaco.MarkerSeverity.Error)
			.map((m) => `${m.startLineNumber}: ${m.message}`);
	});

/** Puts Monaco's caret on the first `word` of the model after `after`, inside it. */
const caretOnInMonaco = (page, word, after = '') =>
	page.evaluate(
		([w, a]) => {
			const { editor } = globalThis.lspMonaco;
			const model = editor.getModel();
			const text = model.getValue();
			const offset = text.indexOf(w, a ? text.indexOf(a) : 0) + 1;
			const position = model.getPositionAt(offset);
			editor.setPosition(position);
			editor.focus();
		},
		[word, after],
	);

for (const language of languages) {
	if (!existsSync(join(packs, language.pack, 'server.js'))) {
		console.log(`# skipped ${language.key}: the ${language.pack} pack is not installed in ${packs}`);
		continue;
	}
	await check(`Monaco: the ${language.key} server starts and reports an error typed into the entry file`, async () => {
		const page = await open('monaco', language.key);
		try {
			const lines = await appendInMonaco(page, language.broken);
			const deadline = Date.now() + ANSWER;
			let errors = [];
			while (Date.now() < deadline && (errors = await monacoErrors(page)).length === 0) await page.waitForTimeout(500);
			if (errors.length === 0) throw new Error(`no error marker within ${ANSWER / 1000}s of adding ${JSON.stringify(language.broken)} (the model has ${lines} lines)`);
		} finally {
			await page.close();
		}
	});
}

if (languages.some((l) => l.key === 'python') && existsSync(join(packs, 'python', 'server.js'))) {
	await check('Monaco: Python hovers, completes and goes to a definition in another file', async () => {
		const page = await open('monaco', 'python');
		try {
			// Hover over `distance` in main.py: the server's signature of it.
			await caretOnInMonaco(page, 'distance', 'print(');
			await page.evaluate(() => globalThis.lspMonaco.editor.trigger('test', 'editor.action.showHover', {}));
			await page.locator('.monaco-hover-content').filter({ hasText: /distance/ }).first().waitFor({ timeout: ANSWER });

			// Completion of `pri` offers print.
			await appendInMonaco(page, '\npri');
			await page.evaluate(() => {
				const { editor } = globalThis.lspMonaco;
				const model = editor.getModel();
				editor.setPosition(model.getFullModelRange().getEndPosition());
				editor.focus();
				editor.trigger('test', 'editor.action.triggerSuggest', {});
			});
			await page.locator('.suggest-widget .monaco-list-row').filter({ hasText: /^print/ }).first().waitFor({ timeout: ANSWER });
			await page.keyboard.press('Escape');

			// Go to definition of `distance` opens geometry.py.
			await caretOnInMonaco(page, 'distance', 'print(');
			await page.evaluate(() => globalThis.lspMonaco.editor.trigger('test', 'editor.action.revealDefinition', {}));
			await page.waitForFunction(() => globalThis.lspMonaco.editor.getModel().uri.path.endsWith('/geometry.py'), null, { timeout: ANSWER });
			const tab = await page.locator('#files button[aria-pressed="true"]').innerText();
			if (tab !== 'geometry.py') throw new Error(`the pressed tab is ${tab}, not geometry.py`);
		} finally {
			await page.close();
		}
	});
}

// ---- Textarea ------------------------------------------------------------

/** Appends `text` to the textarea, as typing at its end would. */
const appendInTextarea = (page, text) =>
	page.evaluate((added) => {
		const area = document.querySelector('#code');
		area.focus();
		area.setSelectionRange(area.value.length, area.value.length);
		area.setRangeText(added, area.value.length, area.value.length, 'end');
		area.dispatchEvent(new InputEvent('input', { data: null, inputType: 'insertText' }));
	}, text);

/** Puts the textarea's caret inside the first `word` after `after`, and clicks it so the page asks for a hover. */
const caretOnInTextarea = (page, word, after = '') =>
	page.evaluate(
		([w, a]) => {
			const area = document.querySelector('#code');
			const offset = area.value.indexOf(w, a ? area.value.indexOf(a) : 0) + 1;
			area.focus();
			area.setSelectionRange(offset, offset);
			area.dispatchEvent(new MouseEvent('click'));
		},
		[word, after],
	);

for (const language of languages) {
	if (!existsSync(join(packs, language.pack, 'server.js'))) continue;
	await check(`Textarea: the ${language.key} server starts and lists an error typed into the entry file`, async () => {
		const page = await open('textarea', language.key);
		try {
			await appendInTextarea(page, language.broken);
			await page.locator('#problems .problem.error').first().waitFor({ timeout: ANSWER });
		} finally {
			await page.close();
		}
	});
}

if (languages.some((l) => l.key === 'python') && existsSync(join(packs, 'python', 'server.js'))) {
	await check('Textarea: Python hovers, completes and goes to a definition in another file', async () => {
		const page = await open('textarea', 'python');
		try {
			await caretOnInTextarea(page, 'distance', 'print(');
			await page.locator('#hover').filter({ hasText: /distance/ }).waitFor({ timeout: ANSWER });

			await appendInTextarea(page, '\npri');
			await page.keyboard.press('Control+Space');
			const row = page.locator('#completions li').filter({ hasText: /^print/ }).first();
			await row.waitFor({ timeout: ANSWER });
			await row.dispatchEvent('mousedown');
			const text = await page.locator('#code').inputValue();
			if (!/\nprint\S*\s*$/.test(text)) throw new Error(`accepting print left the text ending ${JSON.stringify(text.slice(-20))}`);

			await caretOnInTextarea(page, 'distance', 'print(');
			await page.keyboard.press('F12');
			await page.locator('#hover').filter({ hasText: /Defined in geometry\.py, line \d+/ }).waitFor({ timeout: ANSWER });
		} finally {
			await page.close();
		}
	});
}

await browser.close();
server.close();
if (failures.length > 0) {
	console.log(`\n${failures.length} failed:\n${failures.map((f) => `  ${f}`).join('\n')}`);
	process.exit(1);
}
if (checks === 0) {
	console.log(`\nNothing was checked: no language of ${asked.length > 0 ? asked.join(', ') : 'the list'} has its pack installed in ${packs}.`);
	process.exit(1);
}
console.log('\nall passed');
