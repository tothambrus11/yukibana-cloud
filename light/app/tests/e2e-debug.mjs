// Debugs each language's sample in the built app, the way a person would: a
// breakpoint in the entry file's margin (F9), Debug, the call stack and the
// variables in the Debug panel, a step or a second breakpoint into another
// file, Continue (F5) to the end. Where the language debugs its tests (C++),
// a breakpoint in a test, Debug tests from the ⋯ menu, and Continue until
// the tests pass; then, on a Linux target, both disabled, saying why; and
// Test Project (Ctrl+Shift+Enter) on tests the runner refuses says why in
// the Log panel. Where the language runs one test alone (C++), the code
// lens above a test runs only it, its Debug test stops at a breakpoint in
// that test and not at one in the test before it, and with "Stop on failed
// assertion" a failing assertion pauses the test there. Needs the lldb pack
// and each language's.
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
import { buildSetting, choose, closePopovers, LANGUAGE_PICKER, menuItem } from './ui.mjs';

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

/**
 * Per language that debugs its tests: the test file and its line to stop
 * at, the frame it shows and a local there, and what the passing tests
 * print.
 */
const TEST_CASES = {
	// tests/geometry_test.cpp:7 is `EXPECT_DOUBLE_EQ(p.norm(), 5.0);` in TEST(Geometry, NormOfThreeFourIsFive).
	cpp: {
		file: 'geometry_test.cpp',
		line: 7,
		frame: /NormOfThreeFourIsFive.*geometry_test\.cpp:7$/,
		local: 'p',
		output: /\[  PASSED  \] 3 tests\./,
		linux: { target: 'x86_64-linux', reason: 'The debugger runs programs for WebAssembly only, for now: remove the --target line (x86-64 Linux) from compile_flags.txt to debug.' },
		// A second framework in the tests: the runner refuses to build them, and Test is disabled.
		refused: { include: '#include <doctest/doctest.h>\n', reason: 'The tests mix test frameworks: ' },
		// The second test, TEST(Geometry, DistanceIsSymmetric), lines 10 to 15: its lens, a breakpoint at
		// line 13 (`EXPECT_DOUBLE_EQ(distance(a, b), distance(b, a));`), and line 14's assertion made to fail.
		one: {
			lens: 1,
			name: 'Geometry.DistanceIsSymmetric',
			others: ['NormOfThreeFourIsFive', 'DistanceToItselfIsZero'],
			passed: /\[  PASSED  \] 1 test\./,
			line: 13,
			frame: /DistanceIsSymmetric.*geometry_test\.cpp:13$/,
			fail: { line: 14, to: 'distance(a, b), 5.5', frame: /DistanceIsSymmetric.*geometry_test\.cpp:14$/ },
		},
	},
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
	await debugState(page, /exited|ended/, 60_000);
	// The terminal shares the bottom group with the Debug panel.
	await page.locator('.dv-tab', { hasText: 'Terminal' }).first().click();
	const status = page.locator('.terminal .status');
	const done = await status.filter({ hasText: /Exited/ }).waitFor({ timeout: 60_000 }).then(() => true, () => false);
	const shown = (await page.locator('.terminal pre').textContent({ timeout: 5000 }).catch(() => '')) ?? '';
	check(done && c.output.test(shown), `Continue runs the program to its end (${(await status.textContent({ timeout: 5000 }).catch(() => '?'))?.trim()}: ${JSON.stringify(shown.slice(-100))})`);
	check((await page.locator('.debug .frame').count()) === 0, 'the Debug panel shows no stack afterwards');
	check(errors.length === 0, `no page errors (${errors.join('; ')})`);
	await page.close();
}

/** Debug tests: a breakpoint in a test file, Debug tests from the ⋯ menu, then Continue until the tests pass. */
async function runTests(language, c) {
	const where = `${language} tests`;
	const check = (ok, what) => {
		console.log(`${ok ? 'ok  ' : 'FAIL'} ${where}: ${what}`);
		if (!ok) failures.push(`${where}: ${what}`);
	};
	const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto(`http://127.0.0.1:${port}/`);
	await page.evaluate(() => localStorage.clear());
	await page.reload();
	await choose(page, LANGUAGE_PICKER, language);
	await page.locator('footer .state').filter({ hasNotText: /Starting|Loading|stopped/ }).waitFor({ timeout: 240_000 });

	await cursorTo(page, c.line, c.file);
	await page.keyboard.press('F9');
	const dot = await page.locator('.dv-groupview .monaco-editor .debug-breakpoint').first().waitFor({ timeout: 5000 }).then(() => true, () => false);
	check(dot, `F9 sets a breakpoint in ${c.file}`);

	const t0 = Date.now();
	await page.locator('.bar-host button.more').click();
	const item = page.locator('.menu-item', { hasText: /^Debug tests$/ });
	check(await item.isEnabled().catch(() => false), 'the ⋯ menu offers Debug tests, enabled');
	await item.click();
	const paused = await debugState(page, /Paused|ended|could not|failed/, 300_000);
	check(paused === 'Paused at a breakpoint', `Debug tests stops at the breakpoint in the test (${paused}) after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
	const stack = await frames(page);
	check(c.frame.test(stack[0] ?? ''), `the call stack starts in the test (${stack.join(' | ')})`);
	check((await page.locator('.dv-groupview .monaco-editor .debug-stopped-line').count()) > 0, 'the editor shows the line it stopped at');
	const names = await variables(page, c.local);
	check(names.includes(c.local), `the variables include ${c.local} (${names.join(', ')})`);

	await page.keyboard.press('F5');
	await debugState(page, /exited|ended/, 60_000);
	check(await page.locator('.debug .start.tests').isEnabled().catch(() => false), 'the Debug panel offers Debug tests again, beside Debug');
	await page.locator('.dv-tab', { hasText: 'Terminal' }).first().click();
	const status = page.locator('.terminal .status');
	const done = await status.filter({ hasText: /Exited/ }).waitFor({ timeout: 60_000 }).then(() => true, () => false);
	const said = (await status.textContent({ timeout: 5000 }).catch(() => '?'))?.trim() ?? '';
	const shown = (await page.locator('.terminal pre').textContent({ timeout: 5000 }).catch(() => '')) ?? '';
	check(done && /code 0/.test(said) && c.output.test(shown), `Continue runs the tests to their end, passing (${said}: ${JSON.stringify(shown.slice(-100))})`);

	// On a Linux target the runner refuses to debug: Debug and Debug tests
	// stay shown, disabled, with the sentence the runner would print.
	if (c.linux) {
		await choose(page, await buildSetting(page, 'target'), c.linux.target);
		await closePopovers(page);
		const debugButton = page.locator('header .btn.debug');
		await page.waitForFunction(() => document.querySelector('header .btn.debug')?.hasAttribute('disabled'), null, { timeout: 10_000 }).catch(() => {});
		const title = await debugButton.getAttribute('title');
		check((await debugButton.isDisabled()) && title === c.linux.reason, `on ${c.linux.target} Debug is disabled and says why (${title})`);
		const item = await menuItem(page, /^Debug tests$/);
		check((await item.isDisabled()) && (await item.getAttribute('title')) === c.linux.reason, `on ${c.linux.target} Debug tests is disabled and says why (${await item.getAttribute('title')})`);
		await closePopovers(page);
	}
	// Test Project from the editor, with the Test button disabled: the
	// refusal is said in the Log panel, not swallowed.
	if (c.refused) {
		await cursorTo(page, 1, c.file);
		await page.keyboard.press('Home');
		await page.keyboard.type(c.refused.include);
		const testButton = page.locator('header .btn.test');
		const disabled = await page.waitForFunction(() => document.querySelector('header .btn.test')?.hasAttribute('disabled'), null, { timeout: 10_000 }).then(() => true, () => false);
		check(disabled && ((await testButton.getAttribute('title')) ?? '').startsWith(c.refused.reason), `tests that mix frameworks disable Test, saying why (${await testButton.getAttribute('title')})`);
		await page.locator('.dv-groupview .monaco-editor').first().click();
		await page.keyboard.press('Control+Shift+Enter');
		await page.locator('.dv-tab .dock-tab', { hasText: /^Log$/ }).first().click();
		const said = await page.waitForFunction((t) => [...document.querySelectorAll('.log-panel')].some((o) => o.textContent?.includes(t)), c.refused.reason, { timeout: 5_000 }).then(() => true, () => false);
		check(said, 'Ctrl+Shift+Enter in the editor says in the Log panel why the tests cannot run');
	}
	check(errors.length === 0, `no page errors (${errors.join('; ')})`);
	await page.close();
}

/** The code lens commands shown above the tests of the editor, by line from the top: each its link texts ("Run test", "Debug test"). */
const lenses = (page) =>
	page.locator('.dv-groupview .monaco-editor .codelens-decoration').evaluateAll((rows) =>
		rows
			.map((r) => ({ top: r.getBoundingClientRect().top, links: [...r.querySelectorAll('a')].map((a) => a.textContent?.trim() ?? '') }))
			.sort((a, b) => a.top - b.top)
			.map((r) => r.links),
	);

/** Clicks `text` in the `index`th code lens from the top of the editor. */
async function clickLens(page, index, text) {
	const handle = await page.evaluateHandle(
		([i, t]) => {
			const rows = [...document.querySelectorAll('.dv-groupview .monaco-editor .codelens-decoration')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
			return [...(rows[i]?.querySelectorAll('a') ?? [])].find((a) => a.textContent?.trim() === t) ?? null;
		},
		[index, text],
	);
	const link = handle.asElement();
	if (!link) throw new Error(`no "${text}" in code lens ${index}`);
	await link.click();
}

/** The terminal's text once its run has exited (or what it shows after 120 s), and its status line. */
async function finished(page) {
	await page.locator('.dv-tab', { hasText: 'Terminal' }).first().click();
	const status = page.locator('.terminal .status');
	const done = await status.filter({ hasText: /Exited/ }).waitFor({ timeout: 300_000 }).then(() => true, () => false);
	const said = (await status.textContent({ timeout: 5000 }).catch(() => '?'))?.trim() ?? '';
	const shown = (await page.locator('.terminal pre').textContent({ timeout: 5000 }).catch(() => '')) ?? '';
	return { done, said, shown };
}

/** One test alone: its code lens's Run test, its Debug test to a breakpoint inside it, and a stop at its failed assertion. */
async function runOneTest(language, c) {
	const where = `${language} one test`;
	const check = (ok, what) => {
		console.log(`${ok ? 'ok  ' : 'FAIL'} ${where}: ${what}`);
		if (!ok) failures.push(`${where}: ${what}`);
	};
	const one = c.one;
	const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto(`http://127.0.0.1:${port}/`);
	await page.evaluate(() => localStorage.clear());
	await page.reload();
	await choose(page, LANGUAGE_PICKER, language);
	await page.locator('footer .state').filter({ hasNotText: /Starting|Loading|stopped/ }).waitFor({ timeout: 240_000 });

	await page.locator('.explorer').getByText(c.file, { exact: true }).first().click();
	await page.locator('.dv-groupview .monaco-editor .codelens-decoration a').first().waitFor({ timeout: 15_000 }).catch(() => {});
	const shownLenses = await lenses(page);
	check(shownLenses.length === 3 && shownLenses.every((l) => l.join(' | ') === 'Run test | Debug test'), `a "Run test | Debug test" lens above each of the three tests (${JSON.stringify(shownLenses)})`);

	await clickLens(page, one.lens, 'Run test');
	const ran = await finished(page);
	check(ran.done && /code 0/.test(ran.said) && one.passed.test(ran.shown) && ran.shown.includes(one.name) && one.others.every((o) => !ran.shown.includes(o)), `Run test runs ${one.name} and no other test (${ran.said}: ${JSON.stringify(ran.shown.slice(-160))})`);

	// A breakpoint in the test before it, and one in it: Debug test stops at the second, as only that test runs.
	await cursorTo(page, c.line);
	await page.keyboard.press('F9');
	await cursorTo(page, one.line);
	await page.keyboard.press('F9');
	const t0 = Date.now();
	await clickLens(page, one.lens, 'Debug test');
	const paused = await debugState(page, /Paused|ended|could not|failed/, 300_000);
	check(paused === 'Paused at a breakpoint', `Debug test stops at a breakpoint (${paused}) after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
	const stack = await frames(page);
	check(one.frame.test(stack[0] ?? ''), `it stops in that test, not in the one before it (${stack.join(' | ')})`);
	await page.keyboard.press('F5');
	await debugState(page, /exited|ended/, 60_000);
	const debugged = await finished(page);
	check(debugged.done && /code 0/.test(debugged.said) && one.passed.test(debugged.shown), `Continue runs that test to its end, passing (${debugged.said}: ${JSON.stringify(debugged.shown.slice(-100))})`);

	// Stop on failed assertion: the breakpoints gone and an assertion made to fail, the test pauses there.
	await page.locator('.dv-tab .dock-tab', { hasText: /^Debug$/ }).first().click();
	await page.locator('.debug .breakpoints .remove').first().waitFor({ timeout: 5000 }).catch(() => {});
	for (let n = 0; n < 5 && (await page.locator('.debug .breakpoints .remove').count()) > 0; n++) await page.locator('.debug .breakpoints .remove').first().click();
	check((await page.locator('.debug .breakpoints .remove').count()) === 0, 'the Debug panel removes the breakpoints');
	const option = page.locator('.debug .option input[type="checkbox"]');
	check(await option.isVisible().catch(() => false), 'the Debug panel offers "Stop on failed assertion"');
	await option.check();
	// Line 14, from its first character to its end: `EXPECT_DOUBLE_EQ(distance(a, b), 5.0);` made to expect 5.5.
	await cursorTo(page, one.fail.line);
	await page.keyboard.press('End');
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+End');
	await page.keyboard.type(`EXPECT_DOUBLE_EQ(${one.fail.to});`);
	await clickLens(page, one.lens, 'Debug test');
	const stopped = await debugState(page, /Paused|ended|could not|failed/, 300_000);
	check(stopped === 'Paused at a failed assertion', `with it checked, the failing assertion pauses the test (${stopped})`);
	const failedAt = await frames(page);
	check(one.fail.frame.test(failedAt.find((f) => !/test-failed/.test(f)) ?? ''), `the call stack shows the assertion that failed, in the test (${failedAt.join(' | ')})`);
	const selected = await page.locator('.debug .frame.selected').textContent().catch(() => '');
	check(one.fail.frame.test(selected?.replace(/\s+/g, ' ').trim() ?? ''), `the frame shown is the test's, not the runner's hook (${selected})`);
	await page.keyboard.press('F5');
	await debugState(page, /exited|ended/, 60_000);
	const failed = await finished(page);
	check(failed.done && !/code 0/.test(failed.said), `Continue finishes the test, failing (${failed.said})`);
	check(errors.length === 0, `no page errors (${errors.join('; ')})`);
	await page.close();
}

try {
	for (const language of languages) {
		try {
			await run(language, CASES[language]);
			if (TEST_CASES[language]) await runTests(language, TEST_CASES[language]);
			if (TEST_CASES[language]?.one) await runOneTest(language, TEST_CASES[language]);
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
