// Checks that the app fits the screen it is on, at every width a person
// uses it at: no horizontal page scroll, no button, tab, menu item or view
// header whose text wraps onto a second line or is cut off without saying
// so, every control on screen and reachable (in the bar, or in its ⋯ menu),
// and a dock arranged for the width. It walks one page per language through
// the states people see (first load, a run, the compiler views and their
// Options, the Build settings, the ⋯ menu, the language server's menu, the
// Offline dialog, many tabs) at each viewport, and saves a screenshot of
// each. An open popover must fit the window and hold all its text: a phone's
// bottom sheet once ran 90 px off the screen and nothing here looked inside it.
//
//   npm run build && npm run test:e2e:layout -- [--ci] [--all] [--out <dir>] [--state <name> ...]
//
// --out    where the screenshots and report.json go (default
//          /mnt/project-files/light-ux/after; with --ci, none unless given).
// --ci     the five viewports and every state, without screenshots.
// --all    also a small phone (360x740), a phone in landscape (844x390)
//          and a 1440x900 desktop.
// --state  only these states (and the scenarios only if named: modes,
//          switching, dragged, fallback, phone).
//
// Serves app/build with ../serve.py on a free port, as e2e.mjs does, or
// uses BASE_URL (a dev server) when it is set. Exits non-zero, naming every
// violation with its viewport, state and element.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { closePopovers, layoutMode, openBuildSettings, openMore, toggleView } from './ui.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const build = process.env.BUILD_DIR ?? join(here, '..', 'build');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valuesOf = (name) => {
	const out = [];
	for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1] && !argv[i + 1].startsWith('--')) out.push(argv[++i]);
	return out;
};
const ci = flag('--ci');
const out = valuesOf('--out')[0] ?? (ci ? null : '/mnt/project-files/light-ux/after');
const onlyStates = valuesOf('--state');

/**
 * The viewports, named as the screenshots in light-ux/before are. A touch
 * viewport is a phone: `isMobile` and `hasTouch`, so the coarse-pointer
 * rules and the touch-target checks apply.
 */
const VIEWPORTS = [
	{ name: 'phone', width: 390, height: 844, touch: true },
	{ name: 'tablet', width: 768, height: 1024, touch: false },
	{ name: 'narrow', width: 1024, height: 700, touch: false },
	{ name: 'laptop', width: 1280, height: 800, touch: false },
	{ name: 'wide', width: 1920, height: 1080, touch: false },
	...(flag('--all')
		? [
				{ name: 'small-phone', width: 360, height: 740, touch: true },
				{ name: 'landscape', width: 844, height: 390, touch: true },
				{ name: 'desktop', width: 1440, height: 900, touch: false },
			]
		: []),
];

/** The controls of the bar, and where each goes when the bar folds it: `bar` is its place in the bar, `menu` its twin in ⋯ (null: never folded). */
const CONTROLS = [
	{ name: 'Run', bar: 'header button.run', menu: null },
	{ name: 'Test', bar: 'header button.test', menu: null },
	{ name: 'Mutate', bar: 'header button.mutate', menu: '#more-menu [role=menuitem]:has-text("Mutation testing")' },
	{ name: 'Build settings', bar: 'header .build-chip', menu: '#more-menu [role=menuitem]:has-text("Build settings")' },
	{ name: 'LLVM IR', bar: 'header .view-group button[data-view=llvm-ir]', menu: '#more-menu [role=menuitemcheckbox][data-view=llvm-ir]' },
	{ name: 'Assembly', bar: 'header .view-group button[data-view=asm]', menu: '#more-menu [role=menuitemcheckbox][data-view=asm]' },
	{ name: 'Download project', bar: null, menu: '#more-menu [role=menuitem]:has-text("Download project")' },
	{ name: 'Reset project', bar: null, menu: '#more-menu [role=menuitem]:has-text("Reset project")' },
	{ name: 'Restart language server', bar: null, menu: '#more-menu [role=menuitem]:has-text("Restart language server")' },
	{ name: 'Offline', bar: 'header .offline-button', menu: '#more-menu [role=menuitem]:has-text("Offline use")' },
	{ name: 'Theme', bar: 'header .theme-button', menu: '#more-menu [role=menuitem][data-fold="44"]' },
];

/**
 * The states, in the order a page walks through them: each language's page
 * is loaded once and each state's `setup` builds on the one before. `open`
 * runs at every viewport before the checks (a popover or dialog, opened
 * again since the width changes what it holds), `close` after.
 */
const STATES = [
	{ name: 'python-start', language: 'python', reach: true },
	{ name: 'more', language: 'python', open: async (page) => void (await openMore(page)), close: closePopovers },
	{ name: 'server-menu', language: 'python', open: openServerMenu, close: closePopovers },
	{ name: 'offline', language: 'python', open: openOffline, close: async (page) => void (await page.keyboard.press('Escape')) },
	{ name: 'problems', language: 'python', setup: async (page) => page.locator('footer .problems-button').click() },
	{ name: 'python-run', language: 'python', setup: run },
	{ name: 'javascript', language: 'javascript', reach: true },
	{ name: 'cpp-start', language: 'cpp', reach: true },
	{ name: 'build', language: 'cpp', open: async (page) => void (await openBuildSettings(page)), close: closePopovers },
	{ name: 'cpp-ir', language: 'cpp', setup: (page) => showView(page, 'ir') },
	{ name: 'cpp-asm', language: 'cpp', setup: (page) => showView(page, 'asm') },
	{ name: 'asm-options', language: 'cpp', open: openAsmOptions, close: closePopovers },
	{ name: 'cpp-run', language: 'cpp', setup: run },
	{ name: 'tab-overflow', language: 'cpp', setup: openEveryFile },
].filter((s) => !onlyStates.length || onlyStates.includes(s.name));
const scenario = (name) => !onlyStates.length || onlyStates.includes(name);

const violations = [];
const shots = [];

let origin = process.env.BASE_URL?.replace(/\/$/, '');
let server;
if (!origin) {
	const port = await new Promise((resolve) => {
		const s = createServer().listen(0, () => {
			const { port } = s.address();
			s.close(() => resolve(port));
		});
	});
	server = spawn('python3', [join(here, '..', '..', 'serve.py'), build, '--port', String(port)], { stdio: 'ignore' });
	await new Promise((r) => setTimeout(r, 500));
	origin = `http://127.0.0.1:${port}`;
}
if (out) mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
try {
	for (const touch of [true, false]) {
		const viewports = VIEWPORTS.filter((v) => v.touch === touch);
		if (!viewports.length) continue;
		const context = await browser.newContext({ viewport: { width: viewports[0].width, height: viewports[0].height }, isMobile: touch, hasTouch: touch });
		for (const language of [...new Set(STATES.map((s) => s.language))]) {
			const page = await context.newPage();
			const errors = [];
			page.on('pageerror', (e) => errors.push(e.message));
			try {
				await load(page, language);
				for (const state of STATES.filter((s) => s.language === language)) {
					// The setup runs at the first viewport; the states that follow see what it left.
					await page.setViewportSize({ width: viewports[0].width, height: viewports[0].height });
					await settle(page);
					await state.setup?.(page);
					for (const viewport of viewports) await check(page, state, viewport);
				}
			} catch (e) {
				fail('-', language, '-', `the walk stopped: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
			}
			for (const e of errors) fail('-', language, '-', `page error: ${e}`);
			await page.close();
		}
		if (touch && scenario('phone') && viewports.some((v) => v.name === 'phone')) await phone(context);
		if (!touch && scenario('modes')) await modes(context);
		if (!touch && scenario('dragged')) await dragged(context, viewports);
		if (scenario('switching')) await switching(context, viewports);
		if (scenario('fallback')) await fallback(context, viewports);
		await context.close();
	}
} finally {
	await browser.close();
	server?.kill();
}

if (out) writeFileSync(join(out, 'report.json'), JSON.stringify({ origin, viewports: VIEWPORTS, states: STATES.map((s) => s.name), shots, violations }, null, '\t') + '\n');
if (violations.length) {
	console.error(`\n${violations.length} layout violation(s):\n` + violations.map((v) => `  - ${v.viewport} ${v.state}: ${v.what}`).join('\n'));
	process.exit(1);
}
console.log(`\nno layout violations at ${VIEWPORTS.map((v) => v.name).join(', ')}${out ? ` (screenshots in ${out})` : ''}`);

/** Records a violation. */
function fail(viewport, state, element, what) {
	violations.push({ viewport, state, element, what });
	console.log(`FAIL ${viewport} ${state}: ${what}`);
}

/** Opens the app in `language` and waits for its language server. */
async function load(page, language) {
	await page.goto(`${origin}/`);
	await page.locator('header select').first().waitFor();
	if ((await page.locator('header select').first().inputValue()) !== language) await page.selectOption('header select', language);
	await page.locator('footer .state .ok').waitFor({ timeout: 300_000 });
	await settle(page);
}

/** Waits until the dock has decided its mode for this width and the page has drawn it. */
async function settle(page) {
	let last;
	for (let i = 0; i < 20; i++) {
		await page.waitForTimeout(250);
		const now = await layoutMode(page);
		if (now === last) break;
		last = now;
	}
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function openOffline(page) {
	const button = page.locator('header .offline-button');
	if (await button.isVisible()) await button.click();
	else await (await openMore(page)).locator('[role=menuitem]:has-text("Offline use")').click();
	await page.locator('dialog.offline[open]').waitFor();
}

/** Opens the status bar's language server menu. */
async function openServerMenu(page) {
	await page.locator('footer button.server').click();
	await page.locator('#server-menu:popover-open').waitFor();
}

/** Opens the Assembly view's Options menu (the view is open: cpp-asm left it). */
async function openAsmOptions(page) {
	const view = page.locator('.yk-view[data-view="asm"]');
	await view.locator('.yk-view-more').click();
	await view.locator('.yk-view-menu:popover-open').waitFor();
}

/** Runs the project and waits for it to end. */
async function run(page) {
	await page.locator('header button.run').click();
	await page.locator('.terminal .status').filter({ hasText: /Exited|Stopped/ }).waitFor({ state: 'attached', timeout: 300_000 });
}

/** Opens a compiler view and waits for its output. */
async function showView(page, kind) {
	await toggleView(page, kind);
	const view = kind === 'ir' ? 'llvm-ir' : 'asm';
	await page.waitForFunction((v) => (document.querySelector(`.yk-view[data-view="${v}"] .yk-view-editor .view-lines`)?.textContent?.length ?? 0) > 50, view, { timeout: 300_000 });
}

/** Opens every file of the project in a tab, so the editors' tab strip has more tabs than fit. */
async function openEveryFile(page) {
	const explorerTab = page.locator('.dv-tab', { has: page.locator('.dock-tab[title="Explorer"]') });
	if (!(await page.locator('.explorer .row').first().isVisible())) await explorerTab.click();
	const names = await page.locator('.explorer .row .name').allTextContents();
	for (const name of names.filter((n) => n.includes('.'))) {
		await page.locator('.explorer .row .name', { hasText: new RegExp(`^${name.replace(/[.]/g, '\\.')}$`) }).first().click();
		await page.waitForTimeout(150);
		if (!(await page.locator('.explorer .row').first().isVisible())) await explorerTab.click();
	}
}

/** Resizes to `viewport`, opens the state's popover, runs every check and takes the screenshot. */
async function check(page, state, viewport) {
	await page.setViewportSize({ width: viewport.width, height: viewport.height });
	await settle(page);
	await state.open?.(page);
	await page.waitForTimeout(150);
	const found = await page.evaluate(inspect, { touch: viewport.touch });
	for (const v of found) fail(viewport.name, state.name, v.element, `${v.what}: ${v.element}`);
	if (state.reach) for (const v of await reachable(page)) fail(viewport.name, state.name, v, `${v} is neither in the bar nor in ⋯`);
	if (out) {
		const file = join(out, `layout-${state.name}-${viewport.name}.png`);
		await page.screenshot({ path: file });
		shots.push(file);
	}
	console.log(`${found.length ? 'FAIL' : 'ok  '} ${viewport.name} ${state.name}`);
	await state.close?.(page);
}

/** The bar's controls this language has that are on screen neither in the bar nor in ⋯; Run and Test must be in the bar. */
async function reachable(page) {
	const missing = [];
	const menuWanted = [];
	for (const c of CONTROLS) {
		const inBar = c.bar ? await page.locator(c.bar).first().isVisible() : false;
		const exists = (c.bar ? await page.locator(c.bar).count() : 0) + (c.menu ? await page.locator(c.menu).count() : 0) > 0;
		if (!exists || inBar) continue;
		if (!c.menu) missing.push(c.name);
		else menuWanted.push(c);
	}
	if (menuWanted.length) {
		await openMore(page);
		for (const c of menuWanted) if (!(await page.locator(c.menu).first().isVisible())) missing.push(c.name);
		await closePopovers(page);
	}
	return missing;
}

/**
 * Runs in the page: every way the layout can fail the person reading it,
 * as a list of { element, what }. See the file's comment.
 */
function inspect({ touch }) {
	const found = [];
	const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
	const describe = (el) => {
		let s = el.tagName.toLowerCase();
		if (el.id) s += `#${el.id}`;
		const classes = [...el.classList].filter((c) => !c.startsWith('svelte-')).slice(0, 3);
		if (classes.length) s += `.${classes.join('.')}`;
		const text = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
		return text ? `${s} "${text}"` : s;
	};
	const add = (el, what) => found.push({ element: el instanceof Element ? describe(el) : String(el), what });
	/** Drawn on screen: a box, not hidden, not clipped away as screen-reader-only text, not in a closed popover or dialog. */
	const shown = (el) => {
		const r = el.getBoundingClientRect();
		if (r.width < 2 || r.height < 2) return false;
		if (el.closest('[popover]:not(:popover-open), dialog:not([open])')) return false;
		for (let a = el; a; a = a.parentElement) {
			const s = getComputedStyle(a);
			if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
			if (s.clipPath.startsWith('inset(50%')) return false;
		}
		return true;
	};
	/** Scrolled out of a scroll container's view: reachable by scrolling, so not out of bounds. */
	const scrolledAway = (el) => {
		const r = el.getBoundingClientRect();
		for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
			const s = getComputedStyle(a);
			if (!/auto|scroll|hidden/.test(s.overflowX + s.overflowY)) continue;
			const b = a.getBoundingClientRect();
			if (r.right <= b.left + 1 || r.left >= b.right - 1 || r.bottom <= b.top + 1 || r.top >= b.bottom - 1) return true;
		}
		return false;
	};

	// 1. No horizontal scroll, of the page or of the bars.
	if (document.documentElement.scrollWidth > innerWidth || scrollX !== 0) add('html', `the page scrolls sideways (${document.documentElement.scrollWidth} > ${innerWidth})`);
	for (const bar of document.querySelectorAll('header.bar-host, footer.status-bar')) if (bar.scrollWidth > bar.clientWidth + 1) add(bar, `overflows its width (${bar.scrollWidth} > ${bar.clientWidth})`);

	// 2 and 3. One line of text, and nothing cut off without its full text in a title or name.
	const TEXTUAL = 'button, [role=menuitem], [role=menuitemcheckbox], .dock-tab, .chip, .lang-label, .yk-view-head, .yk-view-toggles, .terminal .status, .terminal .status-compact, footer.status-bar > :not([popover])';
	for (const el of document.querySelectorAll(TEXTUAL)) {
		if (!shown(el) || el.closest('.monaco-editor, .terminal pre, .explorer')) continue;
		const rects = [];
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (!node.textContent.trim() || !node.parentElement || !shown(node.parentElement)) continue;
			// A popover inside it (a view's Options in its header, the server menu in the footer) is drawn elsewhere and checked on its own.
			if (node.parentElement.closest('[popover]') !== el.closest('[popover]')) continue;
			const range = document.createRange();
			range.selectNodeContents(node);
			for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5) rects.push(r);
		}
		rects.sort((a, b) => a.top - b.top);
		let lines = 0;
		let bottom = -Infinity;
		for (const r of rects) {
			if (r.top >= bottom - 1) lines++;
			bottom = Math.max(bottom, r.bottom);
		}
		if (lines > 1) add(el, `its text wraps onto ${lines} lines`);
		const s = getComputedStyle(el);
		const scroller = /auto|scroll/.test(s.overflowX);
		if (!scroller && !el.classList.contains('truncate') && el.scrollWidth > el.clientWidth + 1 && s.textOverflow !== 'ellipsis') add(el, `its content is cut off (${el.scrollWidth} > ${el.clientWidth})`);
	}
	for (const el of document.querySelectorAll('.truncate, .dock-tab-label')) {
		if (!shown(el) || el.scrollWidth <= el.clientWidth + 1) continue;
		const full = el.textContent.trim();
		const named = el.closest('[title], [aria-label]');
		const said = `${named?.getAttribute('title') ?? ''} ${named?.getAttribute('aria-label') ?? ''}`;
		if (!said.includes(full)) add(el, 'is cut off and its full text is in no title or name');
	}

	// 4. Every control on screen: in the viewport, and a view header's inside its group.
	const CONTROLS = 'button, select, input, a[href], [role=menuitem], [role=menuitemcheckbox]';
	const places = [...document.querySelectorAll('header.bar-host, footer.status-bar, .yk-view-head, :popover-open, dialog[open], .dv-tabs-and-actions-container')];
	for (const place of places)
		for (const el of place.querySelectorAll(CONTROLS)) {
			if (!shown(el) || scrolledAway(el)) continue;
			const r = el.getBoundingClientRect();
			if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) add(el, `is outside the viewport (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})`);
			// A view's Options menu is in its header but drawn in the top layer, over the other groups: only the window bounds it.
			const group = el.closest('.yk-view-head') && !el.closest('[popover]') ? el.closest('.dv-groupview')?.getBoundingClientRect() : null;
			if (group && (r.left < group.left - 1 || r.right > group.right + 1)) add(el, 'is outside its group');
		}

	// 5. An open popover (a menu, Build settings, a bottom sheet) inside the window, no wider than itself, and all its text inside it.
	for (const pop of document.querySelectorAll(':popover-open')) {
		const p = pop.getBoundingClientRect();
		if (p.left < -1 || p.right > innerWidth + 1 || p.top < -1 || p.bottom > innerHeight + 1) add(pop, `the popover is outside the window (${Math.round(p.left)}..${Math.round(p.right)} of ${innerWidth} wide)`);
		if (pop.scrollWidth > pop.clientWidth + 1) add(pop, `the popover's content is wider than it (${pop.scrollWidth} > ${pop.clientWidth})`);
		const walker = document.createTreeWalker(pop, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (!node.textContent.trim() || !node.parentElement || !shown(node.parentElement) || node.parentElement.closest('.truncate')) continue;
			const range = document.createRange();
			range.selectNodeContents(node);
			const r = range.getBoundingClientRect();
			if (r.width < 0.5) continue;
			if (r.left < Math.max(p.left, 0) - 1 || r.right > Math.min(p.right, innerWidth) + 1) add(node.parentElement, `its text runs out of its popover (${Math.round(r.left)}..${Math.round(r.right)}, the popover ${Math.round(p.left)}..${Math.round(p.right)})`);
		}
	}

	// 6. Header heights: the bar one row; a view's header two rows at most; its state never cut.
	const bar = document.querySelector('header.bar-host');
	const navHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) * rem;
	if (bar && navHeight && bar.getBoundingClientRect().height > navHeight + 1) add(bar, `is taller than one row (${Math.round(bar.getBoundingClientRect().height)} > ${navHeight})`);
	for (const view of document.querySelectorAll('.yk-view')) {
		if (!shown(view)) continue;
		const body = view.querySelector('.yk-view-body');
		const height = body ? body.getBoundingClientRect().top - view.getBoundingClientRect().top : 0;
		if (height > 3.6 * rem + 2 + 1) add(view, `its header is ${Math.round(height)} px tall`);
		const state = view.querySelector('.yk-view-state');
		if (state && shown(state) && state.scrollWidth > state.clientWidth + 1) add(state, 'is cut off');
	}

	// 7. The dock, as its mode arranges it.
	const dock = document.querySelector('[data-layout-mode]');
	const mode = dock?.getAttribute('data-layout-mode');
	const groups = [...document.querySelectorAll('.dv-groupview')].filter(shown);
	const titled = (g, title) => g.querySelector(`.dock-tab[title="${title}"]`) !== null;
	const editors = groups.find((g) => g.querySelector('.dock-editor'));
	if (mode === 'wide') {
		const explorer = groups.find((g) => titled(g, 'Explorer'));
		if (explorer && explorer.getBoundingClientRect().width > 281) add(explorer, `the Explorer is ${Math.round(explorer.getBoundingClientRect().width)} px wide`);
	}
	if ((mode === 'wide' || mode === 'medium') && editors && document.querySelector('.yk-view') && editors.getBoundingClientRect().width < 359) add(editors, `the editors are ${Math.round(editors.getBoundingClientRect().width)} px wide beside the views`);
	if (mode === 'narrow') {
		const stacked = groups.filter((g) => !titled(g, 'Preview'));
		if (stacked.length !== 2) add('dock', `${stacked.length} groups on a narrow screen, not the editors over one bottom group`);
		// The bottom group's tabs are the only way between its panes, so all must show; the editors' strip scrolls, as an editor's does.
		for (const g of stacked.filter((g) => g !== editors)) {
			const strip = g.querySelector('.dv-tabs-container');
			if (strip && strip.scrollWidth > strip.clientWidth + 1) add(g, `its tabs do not fit their strip (${strip.scrollWidth} > ${strip.clientWidth})`);
		}
	}

	// 8. Touch: a finger's room for every control of the bars, tabs and terminal.
	if (touch)
		for (const el of document.querySelectorAll('header.bar-host button, header.bar-host .lang, footer.status-bar button, .dv-tab, .terminal .footer button')) {
			if (!shown(el)) continue;
			const r = el.getBoundingClientRect();
			if (r.width < 24 - 0.5 || r.height < 24 - 0.5) add(el, `is too small to tap (${Math.round(r.width)}x${Math.round(r.height)})`);
			else if (el.closest('header') && r.height < 44 - 0.5) add(el, `is shorter than a finger in the bar (${Math.round(r.height)} px)`);
		}

	// 9. Names: tab close buttons tell their tabs apart; the statuses are announced.
	const closeNames = [...document.querySelectorAll('.dv-tab .dock-tab-close')].filter(shown).map((b) => b.getAttribute('aria-label') ?? '');
	for (const name of new Set(closeNames.filter((n, i) => closeNames.indexOf(n) !== i))) add(name || 'a tab close button', 'two tab close buttons have the same name');
	const problems = document.querySelector('footer .problems-button');
	if (problems && !/errors?/.test(problems.textContent ?? '')) add(problems, 'does not say how many errors');
	for (const el of document.querySelectorAll('footer .state, .terminal .status, .yk-view-state')) if (el.getAttribute('role') !== 'status') add(el, 'is not announced (role=status)');
	return found;
}

/**
 * Scenario: the dock changes mode once per threshold while a window is
 * dragged across it, never while it is wiggled near one, and without
 * errors (a ResizeObserver loop among them).
 */
async function modes(context) {
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	try {
		await page.setViewportSize({ width: 1700, height: 900 });
		await load(page, 'python');
		await page.evaluate(() => {
			window.__modes = [];
			const dock = document.querySelector('[data-layout-mode]');
			new MutationObserver(() => window.__modes.push(dock.getAttribute('data-layout-mode'))).observe(dock, { attributes: true, attributeFilter: ['data-layout-mode'] });
		});
		const drag = async (from, to) => {
			const step = from < to ? 10 : -10;
			for (let w = from; from < to ? w <= to : w >= to; w += step) {
				await page.setViewportSize({ width: w, height: 900 });
				await page.waitForTimeout(16);
			}
			await settle(page);
		};
		await drag(1700, 820);
		const down = await page.evaluate(() => window.__modes.splice(0));
		await drag(820, 1700);
		const up = await page.evaluate(() => window.__modes.splice(0));
		const mode = await layoutMode(page);
		if (down.length > 2 || down.at(-1) !== 'narrow') fail('1700→820', 'modes', 'dock', `dragging narrower changed the mode ${down.length} times (${down.join(' → ')})`);
		if (up.length > 2 || up.at(-1) !== 'wide' || mode !== 'wide') fail('820→1700', 'modes', 'dock', `dragging wider changed the mode ${up.length} times (${up.join(' → ')}), ending ${mode}`);
		for (const [centre, start] of [
			[900, 1000],
			[1600, 1500],
		]) {
			await page.setViewportSize({ width: start, height: 900 });
			await settle(page);
			await page.setViewportSize({ width: centre, height: 900 });
			await settle(page);
			page.evaluate(() => window.__modes.splice(0));
			const before = await layoutMode(page);
			for (const w of [centre - 20, centre + 20, centre - 20, centre + 20, centre]) {
				await page.setViewportSize({ width: w, height: 900 });
				await page.waitForTimeout(400);
			}
			await settle(page);
			const changes = await page.evaluate(() => window.__modes.splice(0));
			if (changes.length) fail(`${centre}±20`, 'modes', 'dock', `wiggling around ${centre} px changed the mode from ${before}: ${changes.join(' → ')}`);
		}
		for (const e of errors) fail('-', 'modes', '-', `error while resizing: ${e}`);
		console.log(`ok   modes: ${down.join(' → ')} going narrower, ${up.join(' → ')} going wider`);
	} catch (e) {
		fail('-', 'modes', '-', `the scenario stopped: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
	}
	await page.close();
}

/**
 * Scenario: the Explorer and the terminal keep the sizes they were dragged
 * to when the Assembly view is opened beside the editors (once it reset
 * both to the mode's defaults) and when it is closed again (once its room
 * was shared out among the whole row), in the medium and the wide
 * arrangement.
 */
async function dragged(context, viewports) {
	const page = await context.newPage();
	try {
		const shown = viewports.filter((v) => v.name === 'laptop' || v.name === 'wide');
		if (!shown.length) return;
		await page.setViewportSize({ width: shown[0].width, height: shown[0].height });
		await load(page, 'cpp');
		for (const viewport of shown) {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			await settle(page);
			if (await page.locator('.yk-view[data-view="asm"]').count()) {
				await toggleView(page, 'asm');
				await settle(page);
			}
			const sizes = () =>
				page.evaluate(() => {
					const group = (title) => document.querySelector(`.dock-tab[title="${title}"]`)?.closest('.dv-groupview')?.getBoundingClientRect();
					const e = group('Explorer');
					const t = group('Terminal');
					return { explorer: e ? { x: e.right, y: e.top + e.height / 2, w: Math.round(e.width) } : null, terminal: t ? { left: t.left, top: t.top, x: t.left + t.width / 2, y: t.top + t.height / 2, w: Math.round(t.width), h: Math.round(t.height) } : null };
				});
			const drag = async (x, y, dx, dy) => {
				await page.mouse.move(x, y);
				await page.mouse.down();
				await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
				await page.mouse.move(x + dx, y + dy, { steps: 4 });
				await page.mouse.up();
				await page.waitForTimeout(200);
			};
			let s = await sizes();
			if (!s.explorer || !s.terminal) throw new Error('no Explorer or Terminal group');
			await drag(s.explorer.x, s.explorer.y, 110, 0);
			s = await sizes();
			const wide = (await layoutMode(page)) === 'wide';
			if (wide) await drag(s.terminal.left, s.terminal.y, 90, 0);
			else await drag(s.terminal.x, s.terminal.top, 0, 120);
			const before = await sizes();
			await showView(page, 'asm');
			await settle(page);
			const after = await sizes();
			await toggleView(page, 'asm');
			await settle(page);
			const closed = await sizes();
			const terminalOf = (v) => (wide ? v.terminal?.w : v.terminal?.h);
			const near = (a, b) => a !== undefined && b !== undefined && Math.abs(a - b) <= 2;
			const kept = (a, b) => near(a.explorer?.w, b.explorer?.w) && near(terminalOf(a), terminalOf(b));
			if (!kept(before, after)) fail(viewport.name, 'dragged', 'dock', `opening Assembly moved the dragged groups: Explorer ${before.explorer?.w} → ${after.explorer?.w} px, terminal ${terminalOf(before)} → ${terminalOf(after)} px`);
			else if (!kept(before, closed)) fail(viewport.name, 'dragged', 'dock', `closing Assembly moved the dragged groups: Explorer ${before.explorer?.w} → ${closed.explorer?.w} px, terminal ${terminalOf(before)} → ${terminalOf(closed)} px`);
			else console.log(`ok   ${viewport.name} dragged: opening and closing Assembly keep the Explorer at ${after.explorer?.w} px and the terminal at ${terminalOf(after)} px`);
		}
	} catch (e) {
		fail('-', 'dragged', '-', `the scenario stopped: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
	}
	await page.close();
}

/**
 * Scenario: the bar folds the same without container queries. MoreMenu.svelte
 * has two equivalent sets of folding rules, and Chromium always takes the
 * container-query one; here a second page is told the browser has none
 * (`CSS.supports('container-type: inline-size')` is false), so the
 * ResizeObserver writes `data-tier` and the other set decides. At every
 * viewport, the same controls must be in the bar, the same in ⋯, and the
 * fallback page must pass the checks the states do.
 */
async function fallback(context, viewports) {
	const normal = await context.newPage();
	const forced = await context.newPage();
	await forced.addInitScript(() => {
		const supports = CSS.supports.bind(CSS);
		CSS.supports = (...args) => (/container-type/.test(args.join(' ')) ? false : supports(...args));
	});
	try {
		for (const page of [normal, forced]) {
			await page.setViewportSize({ width: viewports[0].width, height: viewports[0].height });
			await load(page, 'cpp');
		}
		if (!(await forced.evaluate(() => { const h = document.querySelector('.bar-host'); return h !== null && !h.classList.contains('cq') && h.hasAttribute('data-tier'); })))
			throw new Error('the forced page still uses the container queries');
		const where = async (page) => {
			const seen = {};
			for (const c of CONTROLS) seen[c.name] = { bar: c.bar ? await page.locator(c.bar).first().isVisible() : false };
			await openMore(page);
			for (const c of CONTROLS) seen[c.name].menu = c.menu ? await page.locator(c.menu).first().isVisible() : false;
			await closePopovers(page);
			return seen;
		};
		for (const viewport of viewports) {
			for (const page of [normal, forced]) {
				await page.setViewportSize({ width: viewport.width, height: viewport.height });
				await settle(page);
			}
			const a = await where(normal);
			const b = await where(forced);
			const differ = CONTROLS.filter((c) => a[c.name].bar !== b[c.name].bar || a[c.name].menu !== b[c.name].menu).map((c) => `${c.name} (${JSON.stringify(a[c.name])} with queries, ${JSON.stringify(b[c.name])} without)`);
			for (const d of differ) fail(viewport.name, 'fallback', d, `the bar folds differently without container queries: ${d}`);
			for (const v of await forced.evaluate(inspect, { touch: viewport.touch })) fail(viewport.name, 'fallback', v.element, `${v.what}: ${v.element}`);
			for (const v of await reachable(forced)) fail(viewport.name, 'fallback', v, `${v} is neither in the bar nor in ⋯`);
			if (!differ.length) console.log(`ok   ${viewport.name} fallback folds the bar as the container queries do`);
		}
	} catch (e) {
		fail('-', 'fallback', '-', `the scenario stopped: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
	}
	await normal.close();
	await forced.close();
}

/**
 * Scenario: switching language and back leaves the fixed groups the size
 * they were (the Explorer's width, the terminal's width or height), in
 * every mode.
 */
async function switching(context, viewports) {
	const page = await context.newPage();
	try {
		await page.setViewportSize({ width: viewports[0].width, height: viewports[0].height });
		await load(page, 'python');
		for (const viewport of viewports) {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			await settle(page);
			const sizes = () =>
				page.evaluate(() => {
					const group = (title) => document.querySelector(`.dock-tab[title="${title}"]`)?.closest('.dv-groupview')?.getBoundingClientRect();
					const explorer = group('Explorer');
					const terminal = group('Terminal');
					return { explorer: explorer ? Math.round(explorer.width) : null, terminal: terminal ? [Math.round(terminal.width), Math.round(terminal.height)] : null };
				});
			const before = await sizes();
			for (const language of ['javascript', 'python']) {
				await page.selectOption('header select', language);
				await page.locator('footer .state .ok').waitFor({ timeout: 300_000 });
				await settle(page);
			}
			const after = await sizes();
			const near = (a, b) => (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) <= 2);
			const same = near(before.explorer, after.explorer) && (before.terminal === null ? after.terminal === null : after.terminal !== null && near(before.terminal[0], after.terminal[0]) && near(before.terminal[1], after.terminal[1]));
			if (!same) fail(viewport.name, 'switching', 'dock', `Python → JavaScript → Python moved the fixed groups: ${JSON.stringify(before)} became ${JSON.stringify(after)}`);
			else console.log(`ok   ${viewport.name} switching keeps the Explorer and the terminal their size`);
		}
	} catch (e) {
		fail('-', 'switching', '-', `the scenario stopped: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
	}
	await page.close();
}

/**
 * Scenario, on a phone: the on-screen keyboard folds the bottom group to its
 * tab strip while the editor has focus, and gives it back when it goes; a
 * tap on the front tab of the bottom group does the same.
 */
async function phone(context) {
	const page = await context.newPage();
	try {
		await page.setViewportSize({ width: 390, height: 844 });
		await load(page, 'python');
		const bottom = () =>
			page.evaluate(() => {
				const groups = [...document.querySelectorAll('.dv-groupview')].map((g) => g.getBoundingClientRect()).sort((a, b) => a.top - b.top);
				const editors = document.querySelector('.dock-editor')?.closest('.dv-groupview')?.getBoundingClientRect();
				return { bottom: Math.round(groups.at(-1)?.height ?? 0), editorsHeight: Math.round(editors?.height ?? 0), editorsBottom: Math.round(editors?.bottom ?? 0) };
			});
		const before = await bottom();
		await page.locator('.dock-editor .monaco-editor').first().click();
		const keyboard = (height) =>
			page.evaluate((h) => {
				Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => h });
				visualViewport.dispatchEvent(new Event('resize'));
			}, height);
		await keyboard(450);
		await page.waitForTimeout(400);
		const typing = await bottom();
		if (typing.bottom > 60 || typing.editorsBottom > 451 || typing.editorsHeight < 300) fail('phone', 'keyboard', 'dock', `with the keyboard up the bottom group is ${typing.bottom} px and the editor ${typing.editorsHeight} px ending at ${typing.editorsBottom}`);
		await keyboard(844);
		await page.waitForTimeout(400);
		const back = await bottom();
		if (Math.abs(back.bottom - before.bottom) > 2) fail('phone', 'keyboard', 'dock', `the bottom group came back ${back.bottom} px, not ${before.bottom}`);
		const front = page.locator('.dv-groupview').last().locator('.dv-tab.dv-active-tab');
		await front.tap();
		await page.waitForTimeout(300);
		const tapped = await bottom();
		await front.tap();
		await page.waitForTimeout(300);
		const again = await bottom();
		if (tapped.bottom > 60 || Math.abs(again.bottom - before.bottom) > 2) fail('phone', 'tap', 'dock', `tapping the front tab folds the bottom group to ${tapped.bottom} px and back to ${again.bottom} px (was ${before.bottom})`);
		console.log(`ok   phone: keyboard ${typing.bottom} px, back ${back.bottom}; tap ${tapped.bottom}, back ${again.bottom}`);
	} catch (e) {
		fail('phone', 'keyboard', '-', `the scenario stopped: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
	}
	await page.close();
}
