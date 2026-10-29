// Checks that a tab's project lives in its URL (src/lib/project-link.ts):
// every tab keeps its own, a tab's link opened elsewhere (a browser
// restoring its session, or a person given the link) brings that project
// back as an independent copy, an edit made just before a reload is not
// lost, Share copies the link, a link pasted into a tab's address bar opens
// there, and a damaged link is reported without losing the app. Needs no
// pack: nothing here asks a language server.
//
//   npm run build && npm run test:e2e:links
//
// Serves app/build with ../serve.py on a free port, as e2e.mjs does, or
// uses BASE_URL (a dev server) when it is set. Exits non-zero, naming every
// failed check.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { decodeProject } from '../src/lib/project-link.ts';
import { choose, LANGUAGE_PICKER, menuItem } from './ui.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const build = process.env.BUILD_DIR ?? join(here, '..', 'build');
const failures = [];
const check = (ok, what) => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
	if (!ok) failures.push(what);
};

let base = process.env.BASE_URL;
let server;
if (!base) {
	const port = await new Promise((resolve) => {
		const s = createServer().listen(0, () => {
			const { port } = s.address();
			s.close(() => resolve(port));
		});
	});
	server = spawn('python3', [join(here, '..', '..', 'serve.py'), build, '--port', String(port)], { stdio: 'ignore' });
	await new Promise((r) => setTimeout(r, 500));
	base = `http://127.0.0.1:${port}/`;
}

/** The project a page's URL holds, decoded as the app decodes it. */
const projectIn = (page) => decodeProject(new URL(page.url()).hash);
/** The text of the editor's visible lines, spaces as typed. */
const editorText = async (page) => ((await page.locator('.dv-groupview .view-lines').first().textContent()) ?? '').replaceAll(' ', ' ');

/**
 * Whether the editor comes to show `text` within a few seconds: a page in
 * the background paints late, and checks run on several at once.
 */
const shows = (page, text) =>
	page
		.waitForFunction((t) => (document.querySelector('.dv-groupview .view-lines')?.textContent ?? '').replaceAll('\u00a0', ' ').includes(t), text, { timeout: 5_000 })
		.then(() => true, () => false);

/** Waits for a project's files in the explorer and for the URL to hold the project. */
async function ready(page, file) {
	await page.locator('.explorer .row .name', { hasText: file }).first().waitFor({ timeout: 30_000 });
	await page.waitForFunction(() => location.hash.startsWith('#project=z.'), null, { timeout: 10_000 });
}

/** Types `text` at the end of the active file and waits until the URL holds it. */
async function typeAtEnd(page, text) {
	await page.locator('.dv-groupview .monaco-editor').first().click();
	await page.keyboard.press('Control+End');
	await page.keyboard.type(text);
	const needle = text.trim();
	for (let i = 0; i < 50; i++) {
		const project = await projectIn(page).catch(() => null);
		if (project && Object.values(project.files).some((t) => t.includes(needle))) return true;
		await page.waitForTimeout(100);
	}
	return false;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
try {
	// One browser profile with two tabs, each on its own project.
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
	const one = await context.newPage();
	await one.goto(base);
	await one.evaluate(() => localStorage.clear());
	await one.goto(base); // a fresh start: the sample
	await choose(one, LANGUAGE_PICKER, 'python');
	await ready(one, 'main.py');
	check((await projectIn(one)).language === 'python', 'a tab opened without a link holds its project in its URL at once, before any edit');
	check(await typeAtEnd(one, '\n# tab one\n'), 'an edit reaches the URL');

	const two = await context.newPage();
	await two.goto(base);
	await ready(two, 'main.py');
	check(await shows(two, '# tab one'), 'a new tab without a link starts from the project edited last');
	await choose(two, LANGUAGE_PICKER, 'javascript');
	await ready(two, 'main.js');
	await two.waitForFunction(() => location.hash.length > 10 && document.title.includes('JavaScript'));
	check(await typeAtEnd(two, '\n// tab two\n'), 'the second tab, switched to JavaScript, holds its own project in its URL');
	check(/main\.js · JavaScript · Yukibana Light/.test(await two.title()), `the tab's title names its file and language (${await two.title()})`);
	check((await projectIn(one)).language === 'python' && (await shows(one, '# tab one')), 'the first tab is unchanged by the second');

	// The browser restores its session: each tab's URL, in a browser with none of their storage.
	const urls = [one.url(), two.url()];
	const restored = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const [r1, r2] = [await restored.newPage(), await restored.newPage()];
	await r1.goto(urls[0]);
	await r2.goto(urls[1]);
	await ready(r1, 'main.py');
	await ready(r2, 'main.js');
	check((await r1.locator('header .lang-label .full').textContent()) === 'Python' && (await shows(r1, '# tab one')), 'the first link brings back its Python project as it was');
	check((await r2.locator('header .lang-label .full').textContent()) === 'JavaScript' && (await shows(r2, '// tab two')), 'the second link brings back its JavaScript project as it was');

	// Whoever opens a shared link edits their own copy.
	check(await typeAtEnd(r1, '\n# their copy\n'), 'the copy opened from the link can be edited');
	check(!(await editorText(one)).includes('# their copy') && !(await projectIn(one)).files['main.py'].includes('# their copy'), "editing the copy changes nothing of the original tab's project");
	check(await r2.evaluate(() => localStorage.getItem('yukibana.code.v1.project.javascript') === null), 'only opening a link, without editing it, saves nothing for the next new tab');
	await restored.close();

	// An edit typed just before a reload, before the URL could be written, is kept.
	await one.locator('.dv-groupview .monaco-editor').first().click();
	await one.keyboard.press('Control+End');
	await one.keyboard.type('\n# just before reload\n');
	await one.reload();
	await ready(one, 'main.py');
	await one.locator('.dv-groupview .monaco-editor').first().click();
	await one.keyboard.press('Control+End');
	check(await shows(one, '# just before reload'), 'an edit made just before a reload is kept');
	check((await projectIn(one)).files['main.py'].includes('# just before reload'), 'and its URL holds it again');

	// Share: the link, on the clipboard, and a word that it was copied.
	await one.locator('header button.share').click();
	await one.locator('.toast.shown').waitFor({ timeout: 5_000 });
	const copied = await one.evaluate(() => navigator.clipboard.readText());
	check(copied === one.url() && copied.includes('#project=z.'), 'Share copies the link to the project');
	check(/Link copied/.test((await one.locator('.toast').textContent()) ?? ''), 'and says so');

	// A link pasted into the address bar of a tab that is open opens there.
	await one.evaluate((hash) => (location.hash = hash), new URL(urls[1]).hash);
	await one.locator('.explorer .row .name', { hasText: 'main.js' }).first().waitFor({ timeout: 30_000 });
	check(await shows(one, '// tab two'), "a link pasted into an open tab's address bar opens its project there");
	await context.close();

	// A damaged link: said in the Log panel; the app starts as without one.
	const damaged = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	const url = urls[0];
	await damaged.goto(url.slice(0, url.length - 20));
	await damaged.locator('.explorer .row .name').first().waitFor({ timeout: 30_000 });
	await damaged.locator('.dv-tab .dock-tab', { hasText: /^Log$/ }).first().click();
	const said = await damaged.waitForFunction(() => [...document.querySelectorAll('.log-panel')].some((o) => o.textContent?.includes('Could not open the project in this link')), null, { timeout: 10_000 }).then(() => true, () => false);
	check(said, 'a link cut short is reported in the Log panel, and the app still starts');
	await damaged.close();

	// The Share button at each width: with its word, as an icon, or in ⋯.
	const widths = await browser.newPage();
	await widths.goto(base);
	await ready(widths, '');
	for (const [width, expected] of [[1280, 'word'], [768, 'icon'], [390, 'menu']]) {
		await widths.setViewportSize({ width, height: 800 });
		await widths.waitForTimeout(200);
		const button = widths.locator('header .bar button.share');
		const visible = await button.isVisible();
		const word = visible && (await button.locator('.share-word').isVisible());
		const shown = !visible ? 'menu' : word ? 'word' : 'icon';
		let ok = shown === expected;
		if (expected === 'menu') ok &&= await (await menuItem(widths, 'Share link')).isVisible();
		await widths.keyboard.press('Escape');
		check(ok, `at ${width} px the Share button is shown as ${expected} (${shown})`);
	}
	await widths.close();
} finally {
	await browser.close();
	server?.kill();
}

if (failures.length) {
	console.log(`\n${failures.length} failed:\n${failures.map((f) => `  ${f}`).join('\n')}`);
	process.exit(1);
}
