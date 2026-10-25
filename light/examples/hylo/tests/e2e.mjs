// Drives the built example in Chromium, with Hylo's real compiler: the
// sentences of step HY1 in the architecture plan, on a real page, through
// real nested workers. tests/page.test.mjs says the same in Node with the
// workers stood in for; this is where the compiler, Vite's `?worker`
// bundling and the browser's workers are real.
//
//   npm run build && npm run test:e2e
//
// Serves dist/ itself, cross-origin isolated and with `no-store`, so that
// every compiler the page loads is a request the server counts: a second
// compiler worker would fetch hylo-wasm.wasm a second time. Chromium is
// $CHROMIUM, or the one this repository's images install. Exits non-zero
// naming every check that failed.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
if (!existsSync(join(dist, 'index.html'))) {
	console.error(`No build in ${dist}: run npm run build first.`);
	process.exit(1);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };

/** Requests per kind of file, counted by the server. */
const counts = new Map();
const KINDS = [
	['compiler', /\/hylo-wasm-[\w-]+\.wasm$/],
	['compiler worker', /\/compiler-worker-[\w-]+\.js$/],
	['program worker', /\/program-worker-[\w-]+\.js$/],
	['reading program worker', /\/program\.worker-[\w-]+\.js$/],
];
const count = (kind) => counts.get(kind) ?? 0;

const server = createServer((request, response) => {
	const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
	const file = normalize(join(dist, path.endsWith('/') ? `${path}index.html` : path));
	if (!file.startsWith(dist + sep) || !existsSync(file)) {
		response.writeHead(404).end();
		return;
	}
	for (const [kind, pattern] of KINDS) if (pattern.test(path)) counts.set(kind, count(kind) + 1);
	response.writeHead(200, {
		'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
		'Cache-Control': 'no-store',
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'require-corp',
		'Cross-Origin-Resource-Policy': 'same-origin',
	});
	response.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
const address = server.address();
const origin = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const failures = [];
/** Runs one check, recording its failure by name rather than stopping. */
async function check(name, body) {
	try {
		await body();
		console.log(`ok - ${name}`);
	} catch (error) {
		failures.push(name);
		console.log(`not ok - ${name}\n  ${String(error instanceof Error ? error.message : error).replaceAll('\n', '\n  ')}`);
	}
}
function expect(condition, what) {
	if (!condition) throw new Error(what);
}

/** The snippet `id` of `page`, by its parts. */
const snippet = (page, id) => {
	const section = page.locator(`.snippet[data-snippet="${id}"]`);
	return {
		run: () => section.locator('.run').click(),
		stop: () => section.locator('.stop').click(),
		stopBehind: () => section.locator('.stop-behind').click(),
		type: async (line) => {
			await section.locator('.input').fill(line);
			await section.locator('.input').press('Enter');
		},
		endInput: () => section.locator('.input').press('Control+d'),
		status: (pattern, timeout = 120_000) => section.locator('.status').filter({ hasText: pattern }).waitFor({ timeout }),
		statusText: () => section.locator('.status').innerText(),
		output: () => section.locator('.output').innerText(),
	};
};

/** How many runners the page says it started. */
const runners = (page) => page.evaluate(() => Number(document.body.dataset['runnersStarted'] ?? 0));

const EXITS = { answer: 42, sum: 55, overflow: 134, prelude: 7, square: 49, smaller: 3, nothing: 0, factorial: 120 };

try {
	const page = await browser.newPage();
	const pageErrors = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	await page.goto(`${origin}/index.html`);

	await check('a page creates no runner and fetches no compiler before its first Run', async () => {
		await page.waitForTimeout(500);
		expect((await runners(page)) === 0, `runners started: ${await runners(page)}`);
		expect(count('compiler') === 0 && count('compiler worker') === 0, `compiler fetched ${count('compiler')} times, its worker ${count('compiler worker')}`);
	});

	await check("running snippet 2 while snippet 1 runs never shows 1's output in 2's panel", async () => {
		const mistake = snippet(page, 'mistake');
		const answer = snippet(page, 'answer');
		await mistake.run();
		await answer.run();
		await answer.status(/Waiting for “A type mistake” to finish|Loading|Compiling|Running|Exited/);
		await mistake.status('Exited with code 1');
		await answer.status('Exited with code 42');
		expect((await mistake.output()).includes("no coercion from 'Bool' to 'Int32'"), `the mistake's panel: ${await mistake.output()}`);
		expect(!(await answer.output()).includes('coercion'), `the answer's panel shows the mistake's diagnostic: ${await answer.output()}`);
	});

	await check('cancelling a looping snippet keeps the compiler worker', async () => {
		const forever = snippet(page, 'forever');
		const sum = snippet(page, 'sum');
		const programs = count('program worker');
		await forever.run();
		await forever.status('Running…');
		await sum.run();
		await sum.status('Waiting for “A loop that never ends” to finish.');
		const asked = Date.now();
		await forever.stop();
		await forever.status('Stopped');
		await sum.status('Exited with code 55');
		const waited = Date.now() - asked;
		expect(count('compiler') === 1 && count('compiler worker') === 1, `the compiler was fetched ${count('compiler')} times and its worker ${count('compiler worker')}`);
		expect(count('program worker') === programs + 1, `program workers fetched ${count('program worker') - programs} times after the stop; one new one was expected`);
		expect((await runners(page)) === 1, `runners started: ${await runners(page)}`);
		// Without an answer to `cancel` the pool would wait its grace period (1 s) and start a new runner and compiler.
		console.log(`  # the next snippet had run within ${waited} ms of Stop`);
	});

	await check("a queued snippet's Stop button stops the snippet it waits for, and costs no compiler", async () => {
		const forever = snippet(page, 'forever');
		const nothing = snippet(page, 'nothing');
		await forever.run();
		await forever.status('Running…');
		await nothing.run();
		await nothing.status('Waiting for “A loop that never ends” to finish.');
		await nothing.stopBehind();
		await forever.status('Stopped');
		await nothing.status('Exited with code 0');
		expect(count('compiler') === 1, `the compiler was fetched ${count('compiler')} times`);
	});

	await check('ten snippets on a page create at most one compiler worker', async () => {
		for (const id of Object.keys(EXITS)) await snippet(page, id).run();
		for (const [id, code] of Object.entries(EXITS)) await snippet(page, id).status(`Exited with code ${code}`);
		expect((await snippet(page, 'overflow').output()).includes('The program trapped'), 'the overflow says it trapped');
		expect(count('compiler') === 1, `the compiler was fetched ${count('compiler')} times`);
		expect(count('compiler worker') === 1, `the compiler worker was fetched ${count('compiler worker')} times`);
		expect((await runners(page)) === 1, `runners started: ${await runners(page)}`);
	});

	await check('the docs page raised no error', async () => {
		expect(pageErrors.length === 0, pageErrors.join('\n'));
	});
	await page.close();

	counts.clear();
	const fixture = await browser.newPage();
	await fixture.goto(`${origin}/fixture.html`);

	await check('a snippet waiting on stdin tells a queued snippet why it waits, and stopping it keeps the compiler worker', async () => {
		expect(await fixture.evaluate(() => crossOriginIsolated), 'the fixture page is not cross-origin isolated, so programs cannot read input');
		const greet = snippet(fixture, 'greet');
		const answer = snippet(fixture, 'answer');
		await greet.run();
		await greet.status('Running: waiting for input.');
		expect((await greet.output()).includes('What is your name?'), `greet's panel: ${await greet.output()}`);
		await greet.type('Ada');
		await fixture.locator('.snippet[data-snippet="greet"] .output').filter({ hasText: 'Hello, Ada!' }).waitFor({ timeout: 10_000 });
		await greet.status('Running: waiting for input.');
		await answer.run();
		await answer.status('Waiting for “Greeting”, which is waiting for input.');
		await answer.stopBehind();
		await greet.status('Stopped');
		await answer.status('Running: waiting for input.');
		await answer.endInput();
		await answer.status('Exited with code 42');
		expect(count('compiler') === 1 && count('compiler worker') === 1, `the compiler was fetched ${count('compiler')} times and its worker ${count('compiler worker')}`);
		expect(count('reading program worker') === 2, `program workers fetched: ${count('reading program worker')}; the stopped one and the answer's were expected`);
		expect((await runners(fixture)) === 1, `runners started: ${await runners(fixture)}`);
	});
	await fixture.close();
} finally {
	await browser.close();
	server.close();
}

if (failures.length > 0) {
	console.error(`\n${failures.length} check(s) failed:\n${failures.map((name) => `  - ${name}`).join('\n')}`);
	process.exit(1);
}
console.log('\nevery check passed');
