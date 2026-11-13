// Drives the built two-up page in Chromium with Light's installed packs:
// the second host of DESIGN.md step 8. Two instances on one page, C++ in
// Monaco and Python in a textarea, each run through its own instance and
// both through the page's one runner pool: each shows its own output,
// neither instance knows the other's language, and the page never has two
// runners of one pack at once. (The C++ and Python runners end after each
// run, packs/CONTRACT.md's `reusable` left out, so a pack's runs each start
// one; a pack whose runner is reusable keeps it, which the pool's own tests
// check.)
//
//   npm run build && node test.mjs
//
// Serves dist/ cross-origin isolated, as the runners' needs ask
// (src/host.ts), and /packs/ from $PACKS or Light's installed packs
// (light/app/static/packs: the C++ and Python packs must be installed).
// Chromium is $CHROMIUM, or the one this repository's images install.
// Exits non-zero naming every check that failed.
import { existsSync, readFileSync, statSync } from 'node:fs';
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
for (const pack of ['cpp', 'python']) {
	if (!existsSync(join(packs, pack, 'runner.js'))) {
		console.error(`The ${pack} pack is not installed in ${packs}: install it, or set PACKS.`);
		process.exit(1);
	}
}

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
	const section = page.locator(`.snippet#${id}`);
	return {
		run: () => section.locator('.run').click(),
		status: (pattern, timeout = 300_000) => section.locator('.status').filter({ hasText: pattern }).waitFor({ timeout }),
		statusText: () => section.locator('.status').innerText(),
		output: () => section.locator('.output').innerText(),
		code: () => section.locator('textarea.code'),
	};
};

try {
	const page = await browser.newPage();
	const pageErrors = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	/** The URL of every worker the page started, in order. */
	const workers = [];
	/** Per pack, its runner workers alive now, and the most that were alive at once. */
	const alive = new Map();
	const most = new Map();
	page.on('worker', (worker) => {
		const url = worker.url();
		workers.push(url);
		const pack = /\/packs\/([^/]+)\/runner\.js$/.exec(url)?.[1];
		if (pack === undefined) return;
		alive.set(pack, (alive.get(pack) ?? 0) + 1);
		most.set(pack, Math.max(most.get(pack) ?? 0, alive.get(pack)));
		worker.on('close', () => alive.set(pack, (alive.get(pack) ?? 1) - 1));
	});
	/** The page's runner workers of `pack` it ever started: its runner.js, however it was started. */
	const runnersOf = (pack) => workers.filter((url) => url.endsWith(`/packs/${pack}/runner.js`));
	await page.goto(`${origin}/index.html`);
	const cpp = snippet(page, 'cpp');
	const python = snippet(page, 'python');

	await check('the page is cross-origin isolated, as the runners ask', async () => {
		expect(await page.evaluate(() => crossOriginIsolated), 'crossOriginIsolated is false');
	});

	await check('each instance knows its own language and nothing of the other', async () => {
		const seen = await page.evaluate(() => {
			const { cpp, python, run } = globalThis.twoUp;
			const language = (id) => ({ kind: 'language', id });
			return {
				cpp: cpp.languages.map((l) => l.key),
				python: python.languages.map((l) => l.key),
				cppKnowsPython: cpp.languageOf('python') !== null,
				pythonKnowsCpp: python.languageOf('cpp') !== null,
				cppRunsPython: cpp.has(language('python'), run),
				pythonRunsCpp: python.has(language('cpp'), run),
				cppRuns: cpp.has(language('cpp'), run),
				pythonRuns: python.has(language('python'), run),
			};
		});
		expect(seen.cpp.join() === 'cpp' && seen.python.join() === 'python', `languages: ${JSON.stringify(seen)}`);
		expect(!seen.cppKnowsPython && !seen.pythonKnowsCpp && !seen.cppRunsPython && !seen.pythonRunsCpp, JSON.stringify(seen));
		expect(seen.cppRuns && seen.pythonRuns, JSON.stringify(seen));
	});

	await check('nothing starts a runner before the first Run', async () => {
		await page.locator('.snippet#cpp[data-editor="ready"]').waitFor({ timeout: 30_000 });
		expect(runnersOf('cpp').length === 0 && runnersOf('python').length === 0, `workers: ${workers.join(', ')}`);
	});

	await check('the Python snippet, in a textarea, runs on its own instance and shows its own output', async () => {
		await python.run();
		await python.status('Exited with code 0');
		const output = await python.output();
		expect(output.includes('Python says 110'), `Python's panel: ${JSON.stringify(output)}`);
		expect(!(await cpp.output()).includes('Python'), "C++'s panel shows Python's output");
	});

	await check('the C++ snippet, in Monaco, runs on its own instance and shows its own output', async () => {
		await cpp.run();
		await cpp.status('Exited with code 0');
		const output = await cpp.output();
		expect(output.includes('C++ says 55'), `C++'s panel: ${JSON.stringify(output)}`);
		expect((await python.output()).includes('Python says 110') && !(await python.output()).includes('C++'), "Python's panel changed");
	});

	await check('what is typed in the textarea is what runs', async () => {
		await python.code().fill('print("typed in the textarea")');
		await python.run();
		await python.status('Exited with code 0');
		const output = await python.output();
		expect(output.includes('typed in the textarea') && !output.includes('Python says'), `Python's panel: ${JSON.stringify(output)}`);
	});

	await check('both snippets run again, together, through the one pool: never two runners of a pack at once', async () => {
		await python.code().fill('print("again")');
		await cpp.run();
		await python.run();
		await cpp.status('Exited with code 0');
		await python.status('Exited with code 0');
		expect((await cpp.output()).includes('C++ says 55'), `C++'s panel: ${JSON.stringify(await cpp.output())}`);
		expect((await python.output()).includes('again'), `Python's panel: ${JSON.stringify(await python.output())}`);
		expect(most.get('cpp') === 1 && most.get('python') === 1, `at most ${most.get('cpp')} C++ and ${most.get('python')} Python runners at once: ${workers.filter((url) => url.endsWith('/runner.js')).join(', ')}`);
		expect(runnersOf('cpp').length <= 2 && runnersOf('python').length <= 3, `more runners than runs: ${workers.filter((url) => url.endsWith('/runner.js')).join(', ')}`);
	});

	await check('the page raised no error', async () => {
		expect(pageErrors.length === 0, pageErrors.join('\n'));
	});
} finally {
	await browser.close();
	server.close();
}

if (failures.length > 0) {
	console.error(`\n${failures.length} check(s) failed: ${failures.join('; ')}`);
	process.exit(1);
}
console.log('\nAll checks passed.');
