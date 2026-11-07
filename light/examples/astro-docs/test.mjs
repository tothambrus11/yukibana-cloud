// Drives the built docs site in Chromium, served by `astro preview` with
// Light's installed packs: every playground on every page runs and shows
// what it should, the page reads as text before hydration, and nothing
// of a playground loads until it is in view (nor its compiler until Run).
//
//   node test.mjs            # builds first; SKIP_BUILD=1 to use dist/ as it is
//
// The packs are $PACKS or light/app/static/packs (packs.ts). The packs
// $REQUIRE_PACKS names (comma-separated; default javascript,cpp,rust,python)
// must be installed; a playground of any other pack that is not installed
// is skipped with a message naming it, and counted as skipped (CI fetches
// what the pack store has, .github/workflows/light-ci.yml). JavaScript is
// always required: the site's other pages are JavaScript. Chromium is $CHROMIUM, or the one this repository's images
// install. Exits non-zero naming every check that failed, and prints the
// JavaScript each page loads (gzip) for README.md's bundle note.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { installed, linkPacks, PACKS } from './packs.ts';

const here = dirname(fileURLToPath(import.meta.url));
const astro = join(here, 'node_modules/.bin/astro');

if (process.env.SKIP_BUILD !== '1') {
	const built = spawnSync(astro, ['build'], { cwd: here, stdio: ['ignore', 'ignore', 'inherit'] });
	if (built.status !== 0) {
		console.error('astro build failed');
		process.exit(1);
	}
}
linkPacks(join(here, 'dist'));
const required = new Set(['javascript', ...(process.env.REQUIRE_PACKS ?? 'javascript,cpp,rust,python').split(',').map((pack) => pack.trim()).filter((pack) => pack !== '')]);
for (const pack of required) {
	if (!installed(pack)) {
		console.error(`The ${pack} pack is not installed in ${PACKS}: install it, set PACKS, or leave it out of REQUIRE_PACKS.`);
		process.exit(1);
	}
}
/** Why a check of `pack` is skipped, or null when the pack is installed. */
const missing = (pack) => (installed(pack) ? null : `the ${pack} pack is not installed in ${PACKS} (build light/packs/${pack}, or light/scripts/pack-store.sh fetch ${pack} --any); its playground is built, not run`);

/** A port nothing listens on now. */
const freePort = () =>
	new Promise((resolve) => {
		const probe = createServer().listen(0, '127.0.0.1', () => {
			const { port } = probe.address();
			probe.close(() => resolve(port));
		});
	});
const port = await freePort();
const preview = spawn(astro, ['preview', '--host', '127.0.0.1', '--port', String(port)], { cwd: here, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
	const timer = setTimeout(() => reject(new Error('astro preview did not start in 30 s')), 30_000);
	preview.stdout.on('data', (chunk) => {
		if (String(chunk).includes(`${port}`)) {
			clearTimeout(timer);
			resolve(undefined);
		}
	});
	preview.on('exit', (code) => reject(new Error(`astro preview exited with ${code}`)));
});
const origin = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const failures = [];
let passed = 0;
let skipped = 0;
/** Runs one check, recording its failure by name rather than stopping. */
async function check(name, body) {
	try {
		await body();
		passed += 1;
		console.log(`ok - ${name}`);
	} catch (error) {
		failures.push(name);
		console.log(`not ok - ${name}\n  ${String(error instanceof Error ? error.message : error).replaceAll('\n', '\n  ')}`);
	}
}
function skip(name, why) {
	skipped += 1;
	console.log(`ok - ${name} # SKIP ${why}`);
}
function expect(condition, what) {
	if (!condition) throw new Error(what);
}

/** The five lines every word-frequency program prints for the page's input. */
const WORDS = 'the 5\na 2\ncat 2\ndog 2\non 2\n';
/** How long a first run may take: it downloads and starts the compiler (Rust's is the largest). */
const FIRST_RUN_MS = 600_000;

/** Opens `path` in a new page, recording every script it fetches (URL and gzip size). */
async function open(path, options = {}) {
	const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, ...options });
	const page = await context.newPage();
	const scripts = [];
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('response', async (response) => {
		const url = new URL(response.url());
		if (url.origin !== origin || !/\.m?js$/.test(url.pathname)) return;
		try {
			scripts.push({ path: url.pathname, gzip: gzipSync(await response.body()).length, at: Date.now() });
		} catch {
			// A worker's script, whose body the page cannot read: counted by URL only.
			scripts.push({ path: url.pathname, gzip: 0, at: Date.now() });
		}
	});
	await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
	return { page, scripts, errors, close: () => context.close() };
}

/** The playground whose figure has `id` (or the `nth` without one), by its parts. */
function playground(page, selector) {
	const figure = page.locator(selector);
	return {
		figure,
		/** Resolves once hydrated and its language is loaded (Run is enabled or says why not). */
		ready: async () => {
			await figure.scrollIntoViewIfNeeded();
			await figure.locator('.pg[data-hydrated] .pg-status').waitFor({ timeout: 30_000 });
			await page.waitForFunction((element) => !element.querySelector('.pg-status')?.textContent?.startsWith('Loading'), await figure.elementHandle(), { timeout: 30_000 });
		},
		click: (button) => figure.locator(`.pg-bar .${button}`).click(),
		/** Waits until the run's state is final, and returns its state, status line and output. */
		finished: async (timeout = FIRST_RUN_MS) => {
			await page.waitForFunction((element) => ['ended', 'failed', 'unavailable', 'stopped'].includes(element.querySelector('.pg')?.dataset.state ?? ''), await figure.elementHandle(), { timeout, polling: 250 });
			return {
				state: await figure.locator('.pg').getAttribute('data-state'),
				status: await figure.locator('.pg-status').innerText(),
				// What the program printed: its standard output, not the compiler's messages on stderr.
				output: (await figure.locator('.pg-output .stdout').allTextContents()).join(''),
				all: (await figure.locator('.pg-output').count()) > 0 ? await figure.locator('.pg-output').innerText() : '',
			};
		},
		output: async () => ((await figure.locator('.pg-output').count()) > 0 ? figure.locator('.pg-output').innerText() : ''),
		/** Replaces `from` with `to` in the editor, as typing would. */
		edit: async (from, to) => {
			const editing = await figure.locator('.pg-edit').getAttribute('aria-pressed');
			if (editing !== 'true') await figure.locator('.pg-edit').click();
			const editor = figure.locator('textarea.pg-editor');
			const text = await editor.inputValue();
			expect(text.includes(from), `the code has no ${JSON.stringify(from)}`);
			await editor.fill(text.replace(from, to));
		},
	};
}

/** Runs the playground and expects exit 0 and output `expected` (a string, or a test of the output). */
async function runs(pg, expected, button = 'pg-run') {
	await pg.click(button);
	const result = await pg.finished();
	expect(result.state === 'ended' && /code 0\b/.test(result.status), `the run did not exit with 0: ${result.state}: ${result.status}\n${result.all}`);
	if (typeof expected === 'string') expect(result.output === expected, `the output was ${JSON.stringify(result.output)}, not ${JSON.stringify(expected)}`);
	else expect(expected(result.output, result.all), `unexpected output: ${JSON.stringify(result.all)}`);
	return result;
}

const sizes = [];
/** Records what `scripts` add up to, for the bundle note. */
function record(page, label, scripts) {
	const files = scripts.filter((script) => !script.path.startsWith('/packs/'));
	sizes.push({ page, label, files: files.length, gzip: files.reduce((sum, script) => sum + script.gzip, 0), names: files.map((script) => `${script.path.split('/').pop()} ${(script.gzip / 1024).toFixed(1)}`) });
}

try {
	await check('with JavaScript off, the cookbook reads as text: every language’s code, highlighted, and its input, and no buttons', async () => {
		const { page, close } = await open('/cookbook/word-frequency/', { javaScriptEnabled: false });
		// Hidden tabs' text is there too, for a reader without CSS.
		const text = (await page.locator('main').textContent()) ?? '';
		for (const needle of ['createInterface', 'std::getline', 'readLine()', 'BufRead', 'collections']) expect(text.includes(needle), `no ${needle} on the page`);
		expect((await page.locator('.astro-code').count()) >= 5, 'fewer than five highlighted blocks');
		expect((await page.locator('.pg-stdin-text').first().innerText()).includes('The cat sat on the mat.'), 'the input is not shown');
		expect((await page.locator('.pg-bar button').count()) === 0, 'buttons are shown that cannot work');
		await close();
	});

	await check('a page with no playground in view loads no playground code', async () => {
		const short = await open('/cookbook/word-frequency/', { viewport: { width: 1200, height: 260 } });
		record('/cookbook/word-frequency/', 'on load, no playground in view (a 260 px window)', short.scripts);
		const loaded = short.scripts.map((script) => script.path);
		expect(!loaded.some((path) => path.includes('PlaygroundIsland') || path.includes('preact')), `fetched before any playground was in view: ${loaded.join(', ')}`);
		await short.close();
	});

	const cookbook = await open('/cookbook/word-frequency/');
	const { page } = cookbook;
	await check('the site is cross-origin isolated, so programs can read their input', async () => {
		expect(await page.evaluate(() => crossOriginIsolated), 'crossOriginIsolated is false');
	});
	await check('a page loads no language package and no pack until a playground needs one', async () => {
		const loaded = cookbook.scripts.map((script) => script.path);
		record('/cookbook/word-frequency/', 'on load (the JavaScript tab is in view)', cookbook.scripts);
		expect(!loaded.some((path) => path.startsWith('/packs/')), `packs fetched before any Run: ${loaded.filter((path) => path.startsWith('/packs/'))}`);
		for (const lang of ['lang-cpp', 'lang-rust', 'lang-swift', 'lang-python']) expect(!loaded.some((path) => path.includes(lang)), `${lang} was fetched before its tab was opened`);
	});

	const tabs = [
		{ label: 'JavaScript', id: 'wf-js', pack: 'javascript', chunk: 'lang-javascript' },
		{ label: 'C++', id: 'wf-cpp', pack: 'cpp', chunk: 'lang-cpp' },
		{ label: 'Swift', id: 'wf-swift', pack: 'swift', chunk: 'lang-swift' },
		{ label: 'Rust', id: 'wf-rust', pack: 'rust', chunk: 'lang-rust' },
		{ label: 'Python', id: 'wf-python', pack: 'python', chunk: 'lang-python' },
	];
	for (const tab of tabs) {
		const name = `the ${tab.label} tab hydrates when chosen and its word count prints the five lines`;
		const why = missing(tab.pack);
		if (why !== null) {
			skip(name, why);
			continue;
		}
		await check(name, async () => {
			await page.locator('.tab', { hasText: tab.label }).click();
			const pg = playground(page, `figure#${tab.id}`);
			await pg.ready();
			const started = Date.now();
			await runs(pg, WORDS);
			console.log(`  # ${tab.label}: first run ${((Date.now() - started) / 1000).toFixed(1)} s, compiler download included`);
		});
	}
	await check('a program reads the input as the reader edited it', async () => {
		await page.locator('.tab', { hasText: 'JavaScript' }).click();
		const figure = page.locator('figure#wf-js');
		await figure.locator('textarea.pg-stdin-text').fill('snow snow flower\n');
		await runs(playground(page, 'figure#wf-js'), 'snow 2\nflower 1\n');
	});
	if (missing('python') !== null) skip('an edited program runs as edited, and Reset brings the page’s code back', missing('python'));
	else await check('an edited program runs as edited, and Reset brings the page’s code back', async () => {
		const pg = playground(page, 'figure#wf-python');
		await page.locator('.tab', { hasText: 'Python' }).click();
		await pg.edit('[:5]', '[:2]');
		await runs(pg, 'the 5\na 2\n');
		await page.locator('figure#wf-python .pg-reset').click();
		await runs(pg, WORDS);
	});
	await cookbook.close();

	const home = await open('/');
	record('/', 'on load (its playground is in view)', home.scripts);
	await check('the overview’s TypeScript playground runs', async () => {
		const pg = playground(home.page, 'figure.playground');
		await pg.ready();
		await runs(pg, 'Hello, snow!\nHello, flower!\n');
	});
	await home.close();

	const web = await open('/web/live-canvas/');
	record('/web/live-canvas/', 'on load', web.scripts);
	await check('Show page builds the TypeScript page into a sandboxed frame, with its console under it', async () => {
		const pg = playground(web.page, 'figure#flake');
		await pg.ready();
		await pg.click('pg-run');
		await web.page.locator('figure#flake .pg-output', { hasText: 'drew 6 arms, 3 levels deep' }).waitFor({ timeout: 120_000 });
		const frame = web.page.locator('figure#flake iframe.live-frame');
		expect((await frame.getAttribute('sandbox')) === 'allow-scripts allow-forms allow-modals', 'the frame is not sandboxed as it should be');
		const canvas = await frame.contentFrame().locator('canvas#flake').boundingBox();
		expect(canvas !== null && canvas.width > 100, 'the frame shows no canvas');
	});
	await check('the page rebuilds as the reader types', async () => {
		const pg = playground(web.page, 'figure#flake');
		await pg.edit('const arms = 6;', 'const arms = 8;');
		await web.page.locator('figure#flake .pg-output', { hasText: 'drew 8 arms, 3 levels deep' }).waitFor({ timeout: 60_000 });
	});
	await check('a page that does not build says why and keeps the last page shown', async () => {
		const pg = playground(web.page, 'figure#flake');
		await pg.edit('const arms = 8;', "const arms = 8;\nimport './missing.ts';");
		await web.page.locator('figure#flake .pg-status', { hasText: 'did not build' }).waitFor({ timeout: 60_000 });
		expect((await web.page.locator('figure#flake iframe.live-frame').count()) === 1, 'the last page is gone');
		await pg.edit("const arms = 8;\nimport './missing.ts';", 'const arms = 8;');
		await web.page.locator('figure#flake .pg-output', { hasText: 'drew 8 arms' }).waitFor({ timeout: 60_000 });
	});
	await check('the p5.js sketch runs in its frame', async () => {
		const pg = playground(web.page, 'figure#snowfall');
		await pg.ready();
		await pg.click('pg-run');
		await web.page.locator('figure#snowfall .pg-output', { hasText: 'snowing 60 flakes' }).waitFor({ timeout: 120_000 });
		expect((await web.page.locator('figure#snowfall iframe.live-frame').contentFrame().locator('canvas').count()) === 1, 'the sketch made no canvas');
	});
	await web.close();

	if (missing('python') !== null) {
		for (const name of ['Python reads the CSV the page ships and prints the table', 'the chart continues the table snippet: its code runs first, then the bars', 'the chart uses the reader’s edit of the table snippet']) skip(name, missing('python'));
	} else {
		const data = await open('/python/csv-table/');
		record('/python/csv-table/', 'on load', data.scripts);
		const TABLE = 'station     Dec   Jan   Feb  total\nAomori      129   207   170    506\nSapporo      96   121   112    329\nNiigata      24    48    36    108\n';
		await check('Python reads the CSV the page ships and prints the table', async () => {
			const pg = playground(data.page, 'figure#table');
			await pg.ready();
			await runs(pg, TABLE);
		});
		await check('the chart continues the table snippet: its code runs first, then the bars', async () => {
			const pg = playground(data.page, 'figure.playground >> nth=1');
			await pg.ready();
			await runs(pg, (output) => output.startsWith(TABLE) && output.includes('Aomori   ████████████████████████ 506 cm') && output.includes('Niigata  █████ 108 cm'));
		});
		await check('the chart uses the reader’s edit of the table snippet', async () => {
			await playground(data.page, 'figure#table').edit('key=lambda station: -totals[station]', 'key=lambda station: station');
			await runs(playground(data.page, 'figure.playground >> nth=1'), (output) => output.indexOf('Aomori   █') < output.indexOf('Niigata  █') && output.indexOf('Niigata  █') < output.indexOf('Sapporo  █'));
		});
		await data.close();
	}

	const chain = await open('/chaining/');
	record('/chaining/', 'on load', chain.scripts);
	await check('a snippet that continues another runs both, in order', async () => {
		const pg = playground(chain.page, 'figure#counts');
		await pg.ready();
		await runs(pg, (output) => {
			const quoted = output.replaceAll('"', "'");
			return quoted.includes("'snow', 'snow', 'and'") && quoted.indexOf("'snow', 'snow'") < quoted.indexOf("'snow', 3");
		});
	});
	await check('a snippet continues a snippet that was never hydrated, with the text the page was built with', async () => {
		// The report continues "tokens" and "counts"; only "counts" has hydrated, maybe "tokens" too: reload to be sure neither has.
		await chain.page.goto(`${origin}/chaining/#report`, { waitUntil: 'networkidle' });
		const pg = playground(chain.page, 'figure#report');
		await pg.ready();
		await runs(pg, (output) => output.endsWith('the    ****\nfield  **\nsnow   **\n'));
	});
	await check('Test runs the test file over the continued snippets, and fails once the reader breaks one', async () => {
		const pg = playground(chain.page, 'figure#words-test');
		await pg.ready();
		await runs(pg, (_output, all) => /pass\D*2/i.test(all) || all.includes('✔'), 'pg-test');
		await playground(chain.page, 'figure#tokens').ready();
		await playground(chain.page, 'figure#tokens').edit('text.toLowerCase()', 'text');
		await pg.click('pg-test');
		const result = await pg.finished();
		expect(result.state === 'ended' && !/code 0\b/.test(result.status), `the broken test still passed: ${result.status}\n${result.all}`);
	});
	await chain.close();
} finally {
	await browser.close();
	preview.kill();
}

console.log('\n# JavaScript fetched by the site (gzip, packs excluded)');
for (const size of sizes) console.log(`#   ${size.page.padEnd(28)} ${size.label}: ${size.files} files, ${(size.gzip / 1024).toFixed(1)} KiB${size.files > 0 ? ` (${size.names.join(', ')})` : ''}`);
console.log(`\n# ${passed} passed, ${skipped} skipped, ${failures.length} failed`);
if (failures.length > 0) {
	console.log(`# failed:\n${failures.map((name) => `#   ${name}`).join('\n')}`);
	process.exit(1);
}
