// Debugs each language's sample in the built app, the way a person would: a
// breakpoint in the entry file's margin (F9), Debug, the call stack and the
// variables in the Debug panel, a step or a second breakpoint into another
// file, Continue (F5) to the end. Needs the lldb pack and each language's.
//
//   npm run build && node tests/e2e-debug.mjs [language ...]
//
// Serves app/build (or BUILD_DIR) with ../serve.py on a free port. Exits
// non-zero naming every check that failed.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { choose, LANGUAGE_PICKER } from './ui.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const build = process.env.BUILD_DIR ?? join(here, '..', 'build');

/**
 * Per language: the entry file's line to stop at and the frame it shows, a
 * local there; then how to get into another file (`stepIn`, F11, or a
 * breakpoint set on `line` of `file` while stopped, then F5), the frame and
 * the variables there, and the program's output.
 */
const CASES = {
	// main.cpp:8 is `std::printf("%f\n", distance(points[0], points[1]));`
	cpp: { line: 8, frame: /^main\b.*main\.cpp:8$/, local: 'points', stepIn: true, inner: /^distance\b.*geometry\.cpp:8$/, innerVars: ['a', 'b'], stepOut: /^main\b.*main\.cpp:8$/, output: /5\.000000\s+5\.000000/ },
	// main.swift:3 is the print of distance(a, b); Geometry.swift:16 is distance's body.
	swift: { line: 3, frame: /main\.swift:3$/, into: { file: 'Geometry.swift', line: 16 }, inner: /distance.*Geometry\.swift:16$/, innerVars: ['a', 'b'], output: /\(0\.0, 0\.0\) to \(3\.0, 4\.0\): 5\.0\s+5\.0/ },
};

const only = process.argv.slice(2);
const languages = Object.keys(CASES).filter((l) => (only.length ? only.includes(l) : existsSync(join(build, 'packs', l, 'runner.js'))));
const failures = [];

const port = await new Promise((resolve) => {
	const s = createServer().listen(0, () => {
		const { port } = s.address();
		s.close(() => resolve(port));
	});
});
const server = spawn('python3', [join(here, '..', '..', 'serve.py'), build, '--port', String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });

/** Opens `file` from the explorer (when given) and moves the cursor to `line`. */
async function cursorTo(page, line, file) {
	if (file) await page.locator('.explorer').getByText(file, { exact: true }).first().click();
	await page.locator('.dv-groupview .monaco-editor').first().click();
	await page.keyboard.press('Control+g');
	await page.keyboard.type(String(line));
	await page.keyboard.press('Enter');
}

/** The Debug panel's status line, once it matches `pattern` (or null after `timeout`). */
async function debugState(page, pattern, timeout = 120_000) {
	const state = page.locator('.debug .state');
	return state
		.filter({ hasText: pattern })
		.waitFor({ timeout })
		.then(async () => (await state.textContent())?.trim() ?? '', () => null);
}

const frames = (page) => page.locator('.debug .frame').evaluateAll((rows) => rows.map((r) => `${r.querySelector('.fn')?.textContent?.trim()} ${r.querySelector('.where')?.textContent?.trim()}`));

/** The names in the Variables tree, once `name` is among them (or what is there after 15 s). */
async function variables(page, name) {
	await page.locator('.debug .var .name', { hasText: name }).first().waitFor({ timeout: 15_000 }).catch(() => {});
	return page.locator('.debug .var .name').allTextContents();
}

async function run(language, c) {
	const check = (ok, what) => {
		console.log(`${ok ? 'ok  ' : 'FAIL'} ${language}: ${what}`);
		if (!ok) failures.push(`${language}: ${what}`);
	};
	const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto(`http://127.0.0.1:${port}/`);
	await page.evaluate(() => localStorage.clear());
	await page.reload();
	await choose(page, LANGUAGE_PICKER, language);
	await page.locator('footer .state').filter({ hasNotText: /Starting|Loading|stopped/ }).waitFor({ timeout: 240_000 });

	await cursorTo(page, c.line);
	await page.keyboard.press('F9');
	const dot = await page.locator('.dv-groupview .monaco-editor .debug-breakpoint').first().waitFor({ timeout: 5000 }).then(() => true, () => false);
	check(dot, 'F9 sets a breakpoint, shown in the margin');

	const t0 = Date.now();
	await page.locator('header .btn.debug').click();
	const paused = await debugState(page, /Paused|ended|could not|failed/, 300_000);
	check(paused === 'Paused at a breakpoint', `Debug stops at the breakpoint (${paused}) after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
	const stack = await frames(page);
	check(c.frame.test(stack[0] ?? ''), `the call stack starts at the breakpoint (${stack.join(' | ')})`);
	check((await page.locator('.dv-groupview .monaco-editor .debug-stopped-line').count()) > 0, 'the editor shows the line it stopped at');
	if (c.local) {
		const names = await variables(page, c.local);
		check(names.includes(c.local), `the variables include ${c.local} (${names.join(', ')})`);
	}

	if (c.stepIn) {
		await page.keyboard.press('F11');
		check((await debugState(page, /after a step/, 60_000)) !== null, 'Step Into stops');
	} else {
		await cursorTo(page, c.into.line, c.into.file);
		await page.keyboard.press('F9');
		await page.keyboard.press('F5');
		check((await debugState(page, /Paused at a breakpoint/, 60_000)) !== null, `a breakpoint set while paused, in ${c.into.file}, stops the program`);
	}
	const inside = await frames(page);
	check(c.inner.test(inside[0] ?? ''), `it is in the other file (${inside.join(' | ')})`);
	const vars = await variables(page, c.innerVars[0]);
	check(c.innerVars.every((v) => vars.includes(v)), `that frame's variables are shown (${vars.join(', ')})`);

	if (c.stepOut) {
		await page.keyboard.press('Shift+F11');
		await debugState(page, /after a step/, 60_000);
		const back = await frames(page);
		check(c.stepOut.test(back[0] ?? ''), `Step Out returns (${back.join(' | ')})`);
	}

	// Breakpoints stay where they are; the program passes them no more.
	await page.keyboard.press('F5');
	const status = page.locator('.terminal .status');
	const done = await status.filter({ hasText: /Exited/ }).waitFor({ timeout: 60_000 }).then(() => true, () => false);
	const shown = (await page.locator('.terminal pre').textContent({ timeout: 5000 }).catch(() => '')) ?? '';
	check(done && c.output.test(shown), `Continue runs the program to its end (${(await status.textContent({ timeout: 5000 }).catch(() => '?'))?.trim()}: ${JSON.stringify(shown.slice(-100))})`);
	check((await page.locator('.debug .frame').count()) === 0, 'the Debug panel shows no stack afterwards');
	check(errors.length === 0, `no page errors (${errors.join('; ')})`);
	await page.close();
}

try {
	for (const language of languages) {
		try {
			await run(language, CASES[language]);
		} catch (e) {
			console.log(`FAIL ${language}: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
			failures.push(`${language}: ${e}`);
		}
	}
} finally {
	await browser.close();
	server.kill();
}
if (failures.length) {
	console.log(`\n${failures.length} failed:\n${failures.map((f) => `  ${f}`).join('\n')}`);
	process.exit(1);
}
