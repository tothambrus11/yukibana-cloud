// Drives the built article in Chromium with Light's installed packs and
// checks that every widget does what the article says it does: the C++
// explorer compiles, maps source lines to assembly and follows the
// optimisation level; each language of the comparison runs and prints the
// same line, and shows its compiler's output where it has a view; the
// debugger stops at a breakpoint, shows the locals, steps and continues;
// AddressSanitizer reports the heap overflow the plain run misses.
//
//   npm run build && node test.mjs
//
// Serves dist/ cross-origin isolated (COOP and COEP on every response), and
// /packs/ from $PACKS or Light's installed packs (light/app/static/packs).
// The cpp, rust, python, javascript and lldb packs must be installed. The
// Swift pack is optional: without packs/swift its checks are skipped, each
// saying so, and the page is checked to say plainly that it is missing.
// Exits non-zero naming every check that failed.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const packs = normalize(process.env.PACKS ?? join(here, '../../app/static/packs'));
if (!existsSync(join(dist, 'index.html'))) {
	console.error(`No build in ${dist}: run npm run build first.`);
	process.exit(1);
}
const installed = (pack, file = 'runner.js') => existsSync(join(packs, pack, file));
for (const [pack, file] of [['cpp', 'runner.js'], ['rust', 'runner.js'], ['python', 'runner.js'], ['javascript', 'runner.js'], ['lldb', 'debugger.js']]) {
	if (!installed(pack, file)) {
		console.error(`The ${pack} pack is not installed in ${packs}: install it, or set PACKS.`);
		process.exit(1);
	}
}
const swift = installed('swift');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };

/** The file `path` names: under /packs/ one of the packs', anywhere else one of dist/; null when there is none. */
function fileOf(path) {
	const [root, rest] = path.startsWith('/packs/') ? [packs, path.slice('/packs/'.length)] : [dist, path.endsWith('/') ? `${path}index.html` : path];
	const file = normalize(join(root, rest));
	return file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile() ? file : null;
}

const server = createServer((request, response) => {
	const file = fileOf(decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname));
	const isolated = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' };
	if (file === null) {
		response.writeHead(404, isolated).end();
		return;
	}
	response.writeHead(200, { ...isolated, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': String(statSync(file).size) });
	if (request.method === 'HEAD') response.end();
	else createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
const address = server.address();
const origin = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;

/** Chromium: Playwright's own (PLAYWRIGHT_BROWSERS_PATH), else $CHROMIUM or the one this repository's images install. */
async function launch() {
	try {
		return await chromium.launch();
	} catch {
		return chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
	}
}

const browser = await launch();
const failures = [];
const skipped = [];
let passed = 0;
/** Runs one check, recording its failure by name rather than stopping. */
async function check(name, body) {
	const started = Date.now();
	try {
		await body();
		passed += 1;
		console.log(`ok - ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
	} catch (error) {
		failures.push(name);
		console.log(`not ok - ${name}\n  ${String(error instanceof Error ? error.message : error).replaceAll('\n', '\n  ')}`);
	}
}
/** Records a check that cannot run here, and why. */
function skip(name, why) {
	skipped.push(name);
	console.log(`ok - ${name} # SKIP ${why}`);
}
function expect(condition, what) {
	if (!condition) throw new Error(what);
}

const LONG = 600_000;
const SUM = 'sum of squares 1..100 = 338350';

try {
	const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
	const pageErrors = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	/** Per pack, its runner workers alive now, and the most that were alive at once. */
	const alive = new Map();
	const most = new Map();
	const workers = [];
	page.on('worker', (worker) => {
		const url = worker.url();
		workers.push(url);
		const pack = /\/packs\/([^/]+)\/runner\.js$/.exec(url)?.[1];
		if (pack === undefined) return;
		alive.set(pack, (alive.get(pack) ?? 0) + 1);
		most.set(pack, Math.max(most.get(pack) ?? 0, alive.get(pack)));
		worker.on('close', () => alive.set(pack, (alive.get(pack) ?? 1) - 1));
	});
	await page.goto(`${origin}/index.html`);

	await check('the page is cross-origin isolated, as the debugger and standard input need', async () => {
		expect(await page.evaluate(() => crossOriginIsolated), 'crossOriginIsolated is false');
	});

	await check('no widget further down has asked for a compiler or a runner before the reader scrolls to it', async () => {
		expect(!workers.some((url) => /\/packs\/(rust|python|javascript|swift|lldb)\//.test(url)), `workers at load: ${workers.join(', ')}`);
		expect(!workers.some((url) => url.endsWith('/runner.js')), `a runner started before any Run: ${workers.join(', ')}`);
	});

	// 1. The C++ explorer.
	const explore = page.locator('#explore');
	const asm = explore.locator('.asm');
	const asmText = () => asm.innerText();

	await check('the C++ widget shows clang’s WebAssembly at -O0, with the loop in it', async () => {
		await explore.locator('.explore[data-result="output"] .asm-line').first().waitFor({ timeout: LONG });
		const text = await asmText();
		expect(/sum_of_squares\(unsigned int\):/.test(text), `no demangled label: ${text.slice(0, 300)}`);
		expect(/\bloop\b/.test(text), 'no loop instruction at -O0');
		expect((await explore.locator('.explore-meta').innerText()).includes('wasm32'), 'no target in the header');
	});

	await check('pointing at a source line lights up the assembly it became, and pointing at assembly lights up its line', async () => {
		await explore.locator('[data-editor-for="explore-cpp"] .monaco-editor').waitFor({ timeout: 60_000 });
		const bands = await explore.locator('.asm-line.band').count();
		expect(bands > 5, `only ${bands} output lines are mapped to the source`);
		const line = explore.locator('[data-editor-for="explore-cpp"] .view-line').nth(6);
		await line.hover();
		await page.waitForTimeout(150);
		const lit = await explore.locator('.asm-line.band-on').count();
		expect(lit > 0, 'hovering `total += i * i;` lit no assembly line');
		await explore.locator('.asm-line.band').nth(3).hover();
		await page
			.waitForFunction(() => document.querySelectorAll('#explore [data-editor-for="explore-cpp"] .band-on').length > 0, undefined, { timeout: 5_000 })
			.catch(() => {
				throw new Error('hovering an assembly line lit no source line');
			});
	});

	await check('-O2 rewrites compile_flags.txt, and the loop becomes its closed form', async () => {
		await explore.locator('fieldset', { hasText: 'Optimisation' }).getByText('-O2', { exact: true }).click();
		await explore.locator('.explore:not([data-pending])').waitFor({ timeout: LONG });
		await page.waitForFunction(() => !/\bloop\b/.test(document.querySelector('#explore .asm')?.textContent ?? 'loop'), undefined, { timeout: LONG });
		await explore.locator('.note').waitFor({ timeout: 30_000 });
		expect((await explore.locator('.pane-title').first().innerText()).includes('-O2'), 'the level shown is not -O2');
	});

	await check('the LLVM IR view shows the function as IR', async () => {
		await explore.locator('fieldset', { hasText: 'View' }).getByText('LLVM IR', { exact: true }).click();
		await page.waitForFunction(() => /define .*sum_of_squares/.test(document.querySelector('#explore .asm')?.textContent ?? ''), undefined, { timeout: LONG });
	});

	await check('the C++ widget’s program runs and prints the sum', async () => {
		await explore.locator('button[data-action="run"]').click();
		await explore.locator('.status.ok').waitFor({ timeout: LONG });
		expect((await explore.locator('.run-output').innerText()).includes(SUM), await explore.locator('.run-output').innerText());
	});

	// 2. Five languages.
	const compare = page.locator('#compare');
	await compare.scrollIntoViewIfNeeded();
	const tab = (key) => compare.locator(`.tab[data-language="${key}"]`);
	const panel = (key) => compare.locator(`.tab-panel[data-language="${key}"]`);
	const runIn = async (key) => {
		await tab(key).click();
		await panel(key).locator('button[data-action="run"]').click();
		await panel(key).locator('.status.ok, .status.bad').waitFor({ timeout: LONG });
		return panel(key).locator('.run-output').innerText();
	};
	const viewIn = async (key) => {
		await panel(key).locator('.explore[data-result="output"], .explore[data-result="failed"], .explore[data-result="broken"], [data-result="no-views"]').first().waitFor({ timeout: LONG });
		return panel(key);
	};

	for (const [key, label, view] of [
		['cpp', 'C++', /i32\.(mul|add)|call/],
		['rust', 'Rust', /sum_of_squares|main/],
		['python', 'Python', /BINARY_OP|INPLACE_ADD|LOAD_FAST/],
	]) {
		await check(`${label} prints the same line as the others`, async () => {
			const output = await runIn(key);
			expect(output.includes(SUM), `${label}'s output: ${JSON.stringify(output)}`);
		});
		await check(`${label}'s tab shows its compiler's output`, async () => {
			const shown = await viewIn(key);
			const text = await shown.locator('.explore').innerText();
			expect((await shown.locator('.explore').getAttribute('data-result')) === 'output', `${label}: ${text.slice(0, 400)}`);
			expect(view.test(text), `${label}'s view lacks ${view}: ${text.slice(0, 400)}`);
		});
	}

	await check('Rust’s level is sent with the views: opt-level 3 emits fewer instructions than 0', async () => {
		await tab('rust').click();
		const count = async () => Number(/(\d+) instructions/.exec(await panel('rust').locator('.explore-meta').innerText())?.[1] ?? NaN);
		const before = await count();
		await panel('rust').locator('fieldset', { hasText: 'Optimisation' }).getByText('3', { exact: true }).click();
		await page.waitForFunction((n) => {
			const meta = document.querySelector('.tab-panel[data-language="rust"] .explore-meta')?.textContent ?? '';
			const found = /(\d+) instructions/.exec(meta);
			return found !== null && Number(found[1]) !== n && !document.querySelector('.tab-panel[data-language="rust"] .explore[data-pending]');
		}, before, { timeout: LONG });
		const after = await count();
		expect(after < before, `opt-level 0: ${before} instructions, opt-level 3: ${after}`);
	});

	await check('JavaScript prints the same line, and its tab says it has no compiler output to show', async () => {
		const output = await runIn('javascript');
		expect(output.includes(SUM), `JavaScript's output: ${JSON.stringify(output)}`);
		expect(await panel('javascript').locator('[data-result="no-views"]').isVisible(), 'no "no views" message');
	});

	if (swift) {
		await check('Swift prints the same line as the others', async () => {
			const output = await runIn('swift');
			expect(output.includes(SUM), `Swift's output: ${JSON.stringify(output)}`);
		});
		await check("Swift's tab shows its compiler's output", async () => {
			const shown = await viewIn('swift');
			expect((await shown.locator('.explore').getAttribute('data-result')) === 'output', await shown.locator('.explore').innerText());
		});
	} else {
		skip('Swift prints the same line as the others', `the Swift pack is not installed (${join(packs, 'swift')} is absent)`);
		skip("Swift's tab shows its compiler's output", 'the Swift pack is not installed');
		await check('without the Swift pack, the Swift tab says so instead of failing silently', async () => {
			await tab('swift').click();
			await panel('swift').locator('button[data-action="run"]').click();
			await panel('swift').locator('.status.bad').waitFor({ timeout: 120_000 });
			const said = `${await panel('swift').locator('.status').innerText()} ${await panel('swift').locator('.explore').innerText().catch(() => '')}`;
			expect(/not installed|not there|404|could not|missing/i.test(said), `the Swift tab said: ${said}`);
		});
	}

	await check('the scoreboard lists what each language printed', async () => {
		for (const key of ['cpp', 'rust', 'python', 'javascript']) {
			const row = await compare.locator(`.scoreboard tr[data-language="${key}"]`).innerText();
			expect(row.includes(SUM), `${key}'s row: ${row}`);
		}
	});

	// 3. The debugger.
	const debug = page.locator('#debug');
	await debug.scrollIntoViewIfNeeded();
	const stoppedAt = async (line) => {
		await debug.locator('[data-debug-status="stopped"]').waitFor({ timeout: LONG });
		await page.waitForFunction((n) => [...document.querySelectorAll('#debug .frame.on .frame-where')].some((e) => e.textContent === `main.cpp:${n}`), line, { timeout: 60_000 });
	};
	const local = async (name) => (await debug.locator(`.variable[data-name="${name}"] > .variable-row .variable-value`).first().innerText()).trim();

	await check('Debug stops at the breakpoint on line 6, in insertion_sort, with i = 1', async () => {
		await debug.locator('[data-editor-for="debug-cpp"] .monaco-editor').waitFor({ timeout: 60_000 });
		expect((await debug.locator('.glyph-breakpoint').count()) === 1, 'the breakpoint on line 6 is not in the gutter');
		await debug.locator('button[data-action="debug"]').click();
		await stoppedAt(6);
		expect((await debug.locator('.frames').innerText()).includes('insertion_sort'), await debug.locator('.frames').innerText());
		await debug.locator('.variable[data-name="i"]').waitFor({ timeout: 30_000 });
		expect((await local('i')) === '1', `i = ${await local('i')}`);
		expect((await debug.locator('.line-stopped').count()) === 1, 'the stopped line is not marked in the editor');
	});

	await check('Step over moves to line 7, and key now holds values[1], 2', async () => {
		await debug.locator('button[data-action="next"]').click();
		await stoppedAt(7);
		await page.waitForFunction(() => document.querySelector('#debug .variable[data-name="key"] .variable-value')?.textContent?.trim() === '2', undefined, { timeout: 30_000 });
	});

	await check('Continue runs to the breakpoint again, one pass later: i = 2', async () => {
		await debug.locator('button[data-action="continue"]').click();
		await page.waitForFunction(() => document.querySelector('#debug .variable[data-name="i"] .variable-value')?.textContent?.trim() === '2', undefined, { timeout: 60_000 });
		await stoppedAt(6);
	});

	await check('a pointer local opens to what it points at', async () => {
		await debug.locator('.variable[data-name="values"] .twisty').first().click();
		await page.waitForFunction(() => document.querySelectorAll('#debug .variable[data-name="values"] ul .variable').length > 0, undefined, { timeout: 30_000 });
	});

	await check('clearing the breakpoint in the gutter and continuing runs the program to its end', async () => {
		const number = debug.locator('[data-editor-for="debug-cpp"] .line-numbers', { hasText: /^6$/ });
		await number.click();
		await page.waitForFunction(() => document.querySelectorAll('#debug .glyph-breakpoint').length === 0, undefined, { timeout: 10_000 });
		await debug.locator('button[data-action="continue"]').click();
		await debug.locator('[data-debug-status="ended"]').waitFor({ timeout: LONG });
		await page.waitForFunction(() => (document.querySelector('#debug .run-output')?.textContent ?? '').includes('1 2 5 7 9'), undefined, { timeout: 60_000 });
	});

	// 4. AddressSanitizer.
	const sanitize = page.locator('#sanitize');
	await sanitize.scrollIntoViewIfNeeded();

	await check('without a sanitizer the overflow goes unnoticed: the program exits 0', async () => {
		await sanitize.locator('button[data-action="run"]').click();
		await sanitize.locator('.status.ok, .status.bad').waitFor({ timeout: LONG });
		expect(await sanitize.locator('.status.ok').isVisible(), await sanitize.locator('.status').innerText());
		expect((await sanitize.locator('.run-output').innerText()).includes('last score: 40'), await sanitize.locator('.run-output').innerText());
	});

	await check('with AddressSanitizer the same program stops at the bad write, naming the line', async () => {
		await sanitize.locator('fieldset', { hasText: 'Sanitizer' }).getByText('AddressSanitizer', { exact: true }).click();
		expect((await sanitize.locator('.flags').innerText()).includes('-fsanitize=address'), await sanitize.locator('.flags').innerText());
		await sanitize.locator('button[data-action="run"]').click();
		await sanitize.locator('.status.ok, .status.bad').waitFor({ timeout: LONG });
		await page.waitForFunction(() => document.querySelector('#sanitize')?.getAttribute('data-report') === 'heap-buffer-overflow', undefined, { timeout: 60_000 });
		const output = await sanitize.locator('.run-output').innerText();
		expect(/ERROR: AddressSanitizer: heap-buffer-overflow/.test(output), output.slice(0, 600));
		expect(/main\.cpp:7/.test(output), `the report does not name main.cpp:7: ${output.slice(0, 900)}`);
		expect(await sanitize.locator('.status.bad').isVisible(), 'the run did not fail');
		expect((await sanitize.locator('.source-link').count()) > 0, 'no source location became a link');
	});

	await check('the page never had two runners of one pack at once', async () => {
		const over = [...most].filter(([, n]) => n > 1);
		expect(over.length === 0, `at once: ${JSON.stringify(Object.fromEntries(most))}`);
	});

	await check('the dark scheme applies to the page and the editors', async () => {
		await page.locator('.theme-switch button', { hasText: 'Dark' }).click();
		const colours = await page.evaluate(() => ({ page: getComputedStyle(document.body).backgroundColor, editor: getComputedStyle(document.querySelector('#explore .monaco-editor-background') ?? document.body).backgroundColor }));
		expect(colours.page === 'rgb(15, 17, 21)', `page: ${colours.page}`);
		expect(colours.editor === 'rgb(21, 23, 28)', `editor: ${colours.editor}`);
		if (process.env.SCREENSHOTS) await page.screenshot({ path: join(process.env.SCREENSHOTS, 'dark.png'), fullPage: true });
		await page.locator('.theme-switch button', { hasText: 'Light' }).click();
		if (process.env.SCREENSHOTS) await page.screenshot({ path: join(process.env.SCREENSHOTS, 'light.png'), fullPage: true });
	});

	await check('the page raised no error', async () => {
		expect(pageErrors.length === 0, pageErrors.join('\n'));
	});
} finally {
	await browser.close();
	server.close();
}

console.log(`\n${passed} passed, ${skipped.length} skipped, ${failures.length} failed.`);
if (failures.length > 0) {
	console.error(`Failed: ${failures.join('; ')}`);
	process.exit(1);
}
