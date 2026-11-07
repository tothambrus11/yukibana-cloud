// Drives the built course page in Chromium with Light's installed packs:
// every exercise whose pack is installed is checked as a student would
// use it. Its starter's Check gives the partial checklist the starter
// earns, with the failures' reasons; Show solution draws the diff, Use
// the solution and Check pass every check; Run with the standard input
// prints what the program should; the progress bar, the badges and the
// drafts survive a reload; a phone gets the textarea and checks the same;
// and the page never has two runners of one pack at once, though every
// exercise runs through one instance and one pool.
//
//   npm run build && node test.mjs
//
// Serves dist/ cross-origin isolated, as the runners' needs ask
// (src/lib/host.ts), and /packs/ from $PACKS or Light's installed packs
// (light/app/static/packs). An exercise whose pack is not installed there
// is skipped, and says so (Swift's pack is large, and often is not).
// Chromium is $CHROMIUM, the one this repository's images install, or
// Playwright's own. Exits non-zero naming every check that failed.
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

/**
 * Each exercise as the test knows it: its pack, which of its checks the
 * starter passes (the rest fail), and what Run prints with the exercise's
 * own standard input once the solution is in.
 */
const EXERCISES = [
	{
		id: 'python-top-words',
		pack: 'python',
		starterPasses: ['test_empty_text'],
		checks: ['test_counts_words', 'test_ignores_case_and_punctuation', 'test_ties_are_alphabetical', 'test_n_larger_than_vocabulary', 'test_empty_text'],
		output: 'the: 4\ndog: 2\nfox: 2',
	},
	{
		id: 'javascript-run-length',
		pack: 'javascript',
		starterPasses: ['encodes the empty string as empty', 'an encoding is at most twice as long'],
		checks: ['encodes runs as count and letter', 'encodes the empty string as empty', 'decodes counts of more than one digit', 'decode undoes encode', 'an encoding is at most twice as long'],
		output: 'aaabccdddd -> 3a1b2c4d -> aaabccdddd\nwwwwwwwwwwwwbx -> 12w1b1x -> wwwwwwwwwwwwbx',
	},
	{
		id: 'rust-roman',
		pack: 'rust',
		starterPasses: ['small_numbers', 'rejects_non_numerals'],
		checks: ['small_numbers', 'subtractive_forms', 'reads_numerals_back', 'rejects_non_numerals', 'round_trips_every_number'],
		output: '3 = III\n1994 = MCMXCIV\n2026 = MMXXVI',
	},
	{
		id: 'cpp-bits',
		pack: 'cpp',
		starterPasses: ['Bits.ZeroHasNoBits'],
		checks: ['Bits.ZeroHasNoBits', 'Bits.CountsEveryBit', 'Bits.PowersOfTwo', 'Bits.NextPowerOfTwo'],
		output: '11: 3 bits set, next power of two 16\n64: 1 bits set, a power of two, next power of two 64\n1000: 6 bits set, next power of two 1024',
	},
	{
		id: 'swift-brackets',
		pack: 'swift',
		starterPasses: ['BracketsTests.testEmptyIsBalanced', 'BracketsTests.testNestedPairs', 'BracketsTests.testUnclosed', 'BracketsTests.testIgnoresOtherCharacters'],
		checks: ['BracketsTests.testEmptyIsBalanced', 'BracketsTests.testNestedPairs', 'BracketsTests.testWrongOrder', 'BracketsTests.testUnclosed', 'BracketsTests.testIgnoresOtherCharacters'],
		output: '([]{}) -> balanced\n([)] -> not balanced\nf(x[0]) { y } -> balanced',
	},
];

const installed = EXERCISES.filter((exercise) => existsSync(join(packs, exercise.pack, 'runner.js')));
for (const exercise of EXERCISES) {
	if (!installed.includes(exercise)) console.log(`# SKIP ${exercise.id}: the ${exercise.pack} pack is not installed in ${packs} (install it, or set PACKS), so its exercise is not run`);
}
if (installed.length === 0) {
	console.error(`No pack of the course is installed in ${packs}: install one, or set PACKS.`);
	process.exit(1);
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

const executablePath = process.env.CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
const failures = [];
let passed = 0;
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
function expect(condition, what) {
	if (!condition) throw new Error(what);
}

/** How long a Check or Run may take: a cold compiler download and start (rustc, clang) is most of it. */
const LONG = 300_000;

/** The exercise `id` of `page`, by its parts. */
const exerciseOf = (page, id) => {
	const card = page.locator(`article.exercise#${id}`);
	return {
		card,
		click: (name) => card.locator(`button.${name}`).click(),
		/** Waits until the exercise is idle again with the verdict `verdict` (after a Check), then a little for Svelte's update. */
		checked: async (verdict) => {
			await page.waitForFunction(([cardId, wanted]) => {
				const element = document.getElementById(cardId);
				return element?.dataset['activity'] === 'idle' && element.dataset['verdict'] === wanted;
			}, [id, verdict], { timeout: LONG });
		},
		/** Waits until the exercise is idle after a Run whose status says it ended. */
		ran: () => page.waitForFunction((cardId) => {
			const element = document.getElementById(cardId);
			return element?.dataset['activity'] === 'idle' && /Exited with code/.test(element.querySelector('.status')?.textContent ?? '');
		}, id, { timeout: LONG }),
		outcomes: () => card.locator('.checklist li').evaluateAll((items) => items.map((item) => ({ id: item.dataset['check'], outcome: item.dataset['outcome'], why: item.querySelector('.why')?.textContent ?? null }))),
		output: async () => ((await card.locator('pre.output').count()) === 0 ? '' : card.locator('pre.output').innerText()),
		/** What the program printed on stdout, without the build's messages (stderr). */
		stdout: () => card.locator('pre.output span.stdout').evaluateAll((spans) => spans.map((span) => span.textContent ?? '').join('')),
		status: () => card.locator('.status').innerText(),
		editorKind: () => card.locator('.editor').getAttribute('data-editor'),
		badge: () => card.locator('.badge').innerText(),
	};
};

/** Where the outcomes differ from what was expected, as a sentence with the output, for a failure message. */
async function describe(exercise, card, outcomes) {
	return `checklist ${JSON.stringify(outcomes)}\n  status: ${await card.status()}\n  output:\n${(await card.output()).slice(-3000)}`;
}

/** Records, per pack, the runner workers alive and the most alive at once. */
function watchRunners(page) {
	const alive = new Map();
	const most = new Map();
	const started = [];
	page.on('worker', (worker) => {
		const pack = /\/packs\/([^/]+)\/runner\.js$/.exec(worker.url())?.[1];
		if (pack === undefined) return;
		started.push(pack);
		alive.set(pack, (alive.get(pack) ?? 0) + 1);
		most.set(pack, Math.max(most.get(pack) ?? 0, alive.get(pack)));
		worker.on('close', () => alive.set(pack, (alive.get(pack) ?? 1) - 1));
	});
	return { most, started };
}

try {
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const page = await context.newPage();
	const pageErrors = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	const runners = watchRunners(page);
	await page.goto(`${origin}/index.html`);
	await page.locator('article.exercise').first().waitFor();

	await check('the page is cross-origin isolated, so programs can read standard input', async () => {
		expect(await page.evaluate(() => crossOriginIsolated), 'crossOriginIsolated is false');
	});

	await check('one instance of the page has every exercise language, and every exercise borrows its one host', async () => {
		const seen = await page.evaluate(() => {
			const { store, sessions } = globalThis.course;
			return { languages: store.instance.languages.map((language) => language.key), sessions: [...sessions.keys()], pool: store.host.pool === store.host.pool };
		});
		expect(JSON.stringify(seen.languages) === JSON.stringify(['python', 'javascript', 'rust', 'cpp', 'swift']), `languages ${JSON.stringify(seen.languages)}`);
		expect(seen.sessions.length === EXERCISES.length, `sessions ${JSON.stringify(seen.sessions)}`);
		expect(seen.pool, 'the host made a second pool');
	});

	await check('nothing starts a runner before the first Run or Check', async () => {
		expect(runners.started.length === 0, `runners started: ${runners.started.join(', ')}`);
	});

	await check('the first editor becomes Monaco once it is on screen, loaded after the page', async () => {
		const first = exerciseOf(page, EXERCISES[0].id);
		await page.waitForFunction((id) => document.querySelector(`#${id} .editor`)?.getAttribute('data-editor') === 'monaco', EXERCISES[0].id, { timeout: 30_000 });
		expect((await first.card.locator('.monaco-editor').count()) === 1, 'no Monaco editor in the first exercise');
	});

	await check('Show solution draws the solution as a diff of the starter', async () => {
		const first = exerciseOf(page, EXERCISES[0].id);
		await first.click('solution');
		const counts = await first.card.locator('.diff figcaption .counts').innerText();
		expect(/−\d+ \+\d+/.test(counts) && !/−0 \+0/.test(counts), `counts "${counts}"`);
		expect((await first.card.locator('.diff .line.added').count()) > 0, 'no added line');
		await first.click('solution');
	});

	for (const exercise of installed) {
		const card = exerciseOf(page, exercise.id);
		await card.card.scrollIntoViewIfNeeded();

		await check(`${exercise.id}: the starter's Check passes exactly the checks it should, and says why the others fail`, async () => {
			await page.waitForFunction((id) => !document.querySelector(`#${id} button.check`)?.disabled, exercise.id, { timeout: 30_000 });
			await card.click('check');
			await card.checked('failed');
			const outcomes = await card.outcomes();
			const wanted = exercise.checks.map((id) => ({ id, outcome: exercise.starterPasses.includes(id) ? 'passed' : 'failed' }));
			expect(JSON.stringify(outcomes.map(({ id, outcome }) => ({ id, outcome }))) === JSON.stringify(wanted), await describe(exercise, card, outcomes));
			expect(outcomes.filter((item) => item.outcome === 'failed').every((item) => item.why !== null && item.why.trim() !== ''), `a failure without its reason: ${await describe(exercise, card, outcomes)}`);
			const badge = await card.badge();
			expect(badge === `${exercise.starterPasses.length} / ${exercise.checks.length}`, `badge "${badge}"`);
		});

		await check(`${exercise.id}: with the solution in, Check passes every check and the exercise is marked passed`, async () => {
			await card.click('solution');
			await card.click('use-solution');
			await expect((await card.card.locator('.diff .identical').count()) === 1, 'the diff still shows changes after Use the solution');
			await card.click('solution');
			await card.click('check');
			await card.checked('passed');
			const outcomes = await card.outcomes();
			expect(outcomes.length === exercise.checks.length && outcomes.every((item) => item.outcome === 'passed'), await describe(exercise, card, outcomes));
			expect((await card.badge()) === 'Passed', `badge "${await card.badge()}"`);
		});

		await check(`${exercise.id}: Run gives the program the standard input and shows what it prints`, async () => {
			await card.click('run');
			await card.ran();
			const output = (await card.stdout()).trim();
			expect(output === exercise.output, `stdout:\n${output}\nall output:\n${await card.output()}\nstatus: ${await card.status()}`);
		});
	}

	await check('two exercises of different packs check at once through the one pool, and both pass', async () => {
		const pair = installed.slice(0, 2);
		if (pair.length < 2) return;
		const cards = pair.map((exercise) => exerciseOf(page, exercise.id));
		await Promise.all(cards.map((card) => card.click('check')));
		await Promise.all(cards.map((card) => card.checked('passed')));
	});

	await check('the page never had two runners of one pack at once', async () => {
		const twice = [...runners.most].filter(([, count]) => count > 1);
		expect(twice.length === 0, `at once: ${JSON.stringify(twice)}`);
	});

	await check('the progress bar counts every passed exercise', async () => {
		const count = await page.locator('.progress .count').innerText();
		expect(count === `${installed.length} of ${EXERCISES.length} passed`, `"${count}"`);
		const filled = await page.locator('.progress li[data-passed="true"]').count();
		expect(filled === installed.length, `${filled} segments filled`);
	});

	await check('after a reload, the progress, the badges and the drafts are still there', async () => {
		await page.reload();
		await page.locator('article.exercise').first().waitFor();
		const count = await page.locator('.progress .count').innerText();
		expect(count === `${installed.length} of ${EXERCISES.length} passed`, `"${count}"`);
		for (const exercise of installed) {
			const card = exerciseOf(page, exercise.id);
			expect((await card.badge()) === 'Passed', `${exercise.id} badge "${await card.badge()}"`);
			const draft = await page.evaluate((id) => globalThis.course.store.progressOf(id)?.draft ?? null, exercise.id);
			const text = await page.evaluate((id) => globalThis.course.sessions.get(id)?.editor?.text() ?? null, exercise.id);
			expect(draft !== null && text === draft, `${exercise.id}: the editor has ${JSON.stringify(text?.slice(0, 60))}, the draft ${JSON.stringify(draft?.slice(0, 60))}`);
		}
	});

	await check('the theme can be chosen, and the page and Monaco follow it', async () => {
		const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		await page.evaluate(() => localStorage.removeItem('yukibana-course/theme'));
		const before = await background();
		// system, then light, then dark
		await page.locator('button.theme').click();
		const light = await background();
		await page.locator('button.theme').click();
		const dark = await background();
		expect((await page.evaluate(() => document.documentElement.dataset['theme'])) === 'dark', 'data-theme is not dark');
		expect(light !== dark, `light ${light}, dark ${dark}, system ${before}`);
		await page.waitForFunction(() => document.querySelector('.monaco-editor')?.classList.contains('vs-dark') === true, null, { timeout: 10_000 });
		await page.locator('button.theme').click();
	});

	await check('no error reached the page', async () => {
		expect(pageErrors.length === 0, pageErrors.join('\n'));
	});
	await context.close();

	const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
	const small = await phone.newPage();
	const smallErrors = [];
	small.on('pageerror', (error) => smallErrors.push(error.message));
	await small.goto(`${origin}/index.html`);
	const typed = installed[0];
	const card = exerciseOf(small, typed.id);
	await card.card.waitFor();

	await check('a phone gets the plain textarea, and no Monaco is loaded', async () => {
		await small.waitForTimeout(1500);
		expect((await card.editorKind()) === 'textarea', `editor ${await card.editorKind()}`);
		expect((await small.locator('.monaco-editor').count()) === 0, 'Monaco is on the page');
		const scripts = await small.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /monaco-editor/.test(name)));
		expect(scripts.length === 0, `loaded ${scripts.join(', ')}`);
	});

	await check(`on a phone, what is typed in the textarea is what Check tests (${typed.id})`, async () => {
		const solution = await small.evaluate((id) => globalThis.course.sessions.get(id)?.spec.solution ?? '', typed.id);
		await card.card.locator('textarea.plain').fill(solution);
		await card.click('check');
		await card.checked('passed');
		const outcomes = await card.outcomes();
		expect(outcomes.every((item) => item.outcome === 'passed'), JSON.stringify(outcomes));
	});

	await check('the phone layout has no horizontal scroll', async () => {
		const wide = await small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		expect(wide <= 0, `${wide}px wider than the screen`);
	});

	await check('no error reached the phone page', async () => {
		expect(smallErrors.length === 0, smallErrors.join('\n'));
	});
	await phone.close();
} finally {
	await browser.close();
	server.close();
}

const skipped = EXERCISES.length - installed.length;
console.log(`\n${passed} passed, ${failures.length} failed${skipped > 0 ? `, ${skipped} exercise(s) skipped (pack not installed)` : ''}`);
if (failures.length > 0) {
	console.error(`${failures.length} check(s) failed:\n${failures.map((name) => `  ${name}`).join('\n')}`);
	process.exit(1);
}
