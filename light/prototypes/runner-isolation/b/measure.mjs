// Measures option B (a runner frame on a packs origin) against the in-page
// worker Light uses today, on the experiment's criteria (README.md):
//
//   1. security: what a program's fetch to the host sends and can read
//   2. javascript Test and Mutate (nested workers) pass in the frame
//   3. stdin works when the host is isolated
//   4. median added latency of run start and of a 1000-line stdout burst
//   5. lines of transport code (hosting requirements are in README.md)
//
//   node measure.mjs [--packs DIR] [--runs 20]
//
// Needs the javascript pack built (app/static/packs/javascript, or --packs),
// Chromium at $CHROMIUM (default /opt/pw-browsers/chromium) and
// playwright-core or playwright where Node finds it ($PLAYWRIGHT names one).
// It starts serve.py itself.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
	const i = process.argv.indexOf(name);
	return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PACKS = resolve(arg('--packs', join(HERE, '../../../app/static/packs')));
const RUNS = Number(arg('--runs', '20'));
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';

function playwright() {
	const require = createRequire(import.meta.url);
	for (const name of [process.env.PLAYWRIGHT, 'playwright-core', 'playwright', '/opt/node-tools/node_modules/playwright']) {
		if (!name) continue;
		try {
			return require(name);
		} catch {}
	}
	throw new Error('playwright-core not found: npm i playwright-core, or set PLAYWRIGHT to its path');
}
const { chromium } = playwright();

// Two sites (the experiment's ports and names), and one site with two
// origins (what packs.<cloud's domain> would be). *.localhost is loopback
// and a secure context in Chromium, so both pairs can be isolated.
const PAIRS = {
	'cross-site': { host: 'http://127.0.0.1:8101', packs: 'http://localhost:8102' },
	'same-site': { host: 'http://app.yukibana.localhost:8101', packs: 'http://packs.yukibana.localhost:8102' },
};
const SECRET = 'teacher-session-secret';

const server = spawn('python3', [join(HERE, 'serve.py'), '--packs', PACKS], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, fail) => {
	server.stdout.once('data', ok);
	server.once('exit', (code) => fail(new Error(`serve.py exited with ${code}`)));
});
const browser = await chromium.launch({ executablePath: CHROMIUM });
const log = async () => (await fetch('http://127.0.0.1:8101/__log?clear')).json();

let failures = 0;
function check(name, ok, detail = '') {
	if (!ok) failures++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}

/** A page of `pair`'s host, isolated or not, in a fresh context (its own cookies), with both transports open. */
async function hostPage(pair, mode) {
	const context = await browser.newContext();
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	await page.goto(`${PAIRS[pair].host}/${mode}/host.html`);
	await page.waitForFunction(() => document.title === 'ready');
	const frameUrl = `${PAIRS[pair].packs}/run-frame.html`;
	const framed = await page.evaluate((u) => window.yk.open(u), frameUrl);
	const inPage = await page.evaluate(() => window.yk.open('in-page'));
	await page.evaluate((u) => window.yk.open(u), `${frameUrl}?batch`);
	const isolated = await page.evaluate(() => window.yk.isolated);
	return { context, page, errors, frameUrl, framed, inPage, isolated, keys: { 'in-page': 'in-page', framed: frameUrl, 'framed, batched': `${frameUrl}?batch` } };
}
const run = (page, key, type, files, entry = 'main.js', inputs = [], timeoutMs = 120000) =>
	page.evaluate(([k, t, f, e, i, ms]) => window.yk.run(k, t, f, e, i, ms), [key, type, files, entry, inputs, timeoutMs]);

// ---------------------------------------------------------------- 1. security
const probe = (host) => ({
	'main.js': `const HOST = ${JSON.stringify(host)};
const r = { origin: self.origin, isolated: self.crossOriginIsolated, document: typeof document, localStorage: typeof localStorage, cookieStore: typeof cookieStore };
async function probe(name, init) {
  try {
    const res = await fetch(HOST + '/whoami?probe=' + name, init);
    r[name] = { type: res.type, status: res.status, body: await res.text() };
  } catch (e) { r[name] = 'threw ' + e.name; }
}
await probe('default', {});
await probe('include', { credentials: 'include' });
await probe('no-cors', { mode: 'no-cors', credentials: 'include' });
await probe('post', { method: 'POST', mode: 'no-cors', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'role=admin' });
try { const c = await caches.open('probe'); await c.put(new Request('/packs/javascript/runner.js'), new Response('poisoned')); r.caches = 'writable'; await caches.delete('probe'); } catch (e) { r.caches = 'threw ' + e.name; }
try { indexedDB.open('probe'); r.indexedDB = 'opens'; } catch (e) { r.indexedDB = 'threw ' + e.name; }
console.log(JSON.stringify(r));
`,
});

const security = {};
for (const pair of Object.keys(PAIRS)) {
	for (const mode of ['coi', 'plain']) {
		const h = await hostPage(pair, mode);
		await log();
		for (const name of ['in-page', 'framed']) {
			const out = await run(h.page, h.keys[name], 'run', probe(PAIRS[pair].host));
			const seen = await log();
			let r = {};
			try {
				r = JSON.parse(out.stdout.trim().split('\n').pop());
			} catch {
				r = { unparsed: out.stdout + out.stderr };
			}
			const read = ['default', 'include', 'no-cors', 'post'].filter((p) => typeof r[p] === 'object' && r[p].body.includes(SECRET));
			const sentLax = seen.filter((s) => s.cookie.includes('sb-access-token')).map((s) => `${s.method} ${s.probe}`);
			const sentNone = seen.filter((s) => s.cookie.includes('probe-none')).map((s) => `${s.method} ${s.probe}`);
			security[`${pair} ${mode} ${name}`] = { origin: r.origin, read, sentLax, sentNone, caches: r.caches, indexedDB: r.indexedDB, document: r.document, localStorage: r.localStorage, requests: seen.length };
		}
		if (mode === 'coi') {
			const frame = h.page.frames().find((f) => f.url() === h.frameUrl);
			const inFrame = await frame.evaluate(() => ({ cookie: document.cookie, localStorage: localStorage.length }));
			security[`${pair} frame document`] = inFrame;
		}
		await h.context.close();
	}
}
console.log('\n1. security: what a program fetching the host gets (read: probes whose body held the session; sent*: probes that carried the cookie)');
console.table(security);
for (const [key, s] of Object.entries(security)) {
	if (!key.endsWith(' framed') || !key.startsWith('cross-site')) continue;
	check(`${key}: the program reads no session and sends no SameSite=Lax session cookie`, s.read.length === 0 && s.sentLax.length === 0, JSON.stringify(s));
}
for (const [key, s] of Object.entries(security)) {
	if (key.endsWith(' in-page')) check(`${key}: (control) the in-page worker does read the session`, s.read.length > 0, JSON.stringify(s.read));
}

// ------------------------------------------------- 2 and 3: test, mutate, stdin
const SAMPLE = JSON.parse(readFileSync(join(HERE, 'sample.json'), 'utf8'));
const STDIN = { 'main.js': "const a = prompt('a?'); const b = prompt('b?');\nconsole.log(`got ${a} and ${b}`, typeof SharedArrayBuffer);\n" };
const plain = (s) => s.replace(/\x1b\[[0-9;:]*[A-Za-z]/g, '');
console.log('\n2-3. test, mutate (nested workers) and stdin through the frame');
for (const mode of ['coi', 'plain']) {
	const h = await hostPage('cross-site', mode);
	check(`${mode}: the host is ${mode === 'coi' ? '' : 'not '}isolated, the frame says stdin ${h.framed.stdin}`, h.isolated === (mode === 'coi') && h.framed.stdin === h.isolated);
	const t = await run(h.page, h.frameUrl, 'test', SAMPLE);
	check(`${mode} framed: Test passes`, t.code === 0 && /ℹ fail 0/.test(plain(t.stdout)), `code=${t.code} ${t.error ?? ''} ${plain(t.stdout).split('\n').filter((l) => /ℹ (pass|fail)/.test(l)).join(' ')}`);
	const m0 = performance.now();
	const m = await run(h.page, h.frameUrl, 'mutate', SAMPLE);
	const score = plain(m.stdout).match(/Mutation score: ([\d.]+%)/)?.[1];
	check(`${mode} framed: Mutate runs its mutants in nested workers of the frame and scores 77.78%`, m.code === 0 && score === '77.78%', `code=${m.code} score=${score} ${Math.round(performance.now() - m0)} ms ${m.error ?? ''} ${plain(m.stderr).slice(0, 200)}`);
	const mi = await run(h.page, 'in-page', 'mutate', SAMPLE);
	check(`${mode} in-page: (control) Mutate scores the same`, plain(mi.stdout).match(/Mutation score: ([\d.]+%)/)?.[1] === score);
	const s = await run(h.page, h.frameUrl, 'run', STDIN, 'main.js', ['Ada\n', '36\n']);
	const want = mode === 'coi' ? 'a?b?got Ada and 36 function\n' : null;
	check(`${mode} framed: stdin ${mode === 'coi' ? 'reads two lines, SharedArrayBuffer in the runner' : 'is end of file, as in the page without isolation'}`, want ? s.stdout === want : s.code !== null && !/got Ada/.test(s.stdout), JSON.stringify(s.stdout + s.stderr));
	if (mode === 'coi') {
		const frame = h.page.frames().find((f) => f.url() === h.frameUrl);
		await frame.evaluate(() => {
			window.__sab = 'nothing';
			addEventListener('message', (e) => e.data?.sab && (window.__sab = 'received'));
			addEventListener('messageerror', () => (window.__sab = 'messageerror'));
		});
		await h.page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ sab: new SharedArrayBuffer(8) }, '*'));
		await h.page.waitForTimeout(300);
		const got = await frame.evaluate(() => window.__sab);
		check('coi: a SharedArrayBuffer posted from the host to the frame arrives as a messageerror (separate agent clusters), so stdin lives in the frame', got === 'messageerror', got);
	}
	if (h.errors.length) check(`${mode}: no page errors`, false, h.errors.join(' | '));
	await h.context.close();
}

// ------------------------------------------------------------------ 4. latency
const HELLO = { 'main.js': "console.log('hello');\n" };
const BURST = { 'main.js': "for (let i = 0; i < 1000; i++) console.log('line ' + i + ' of the burst, some forty characters');\n" };
/** The q-quantile of xs, linearly interpolated (q = 0.5 is the median). */
const quantile = (xs, q) => {
	const s = [...xs].sort((a, b) => a - b);
	const i = (s.length - 1) * q;
	return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i));
};
const median = (xs) => quantile(xs, 0.5);
const r1 = (x) => Math.round(x * 10) / 10;
// The quartiles and the share of fast starts are there because run start
// was once bimodal (15 or 55 ms, in-page and framed alike): serve.py's
// Nagle delay on kept-alive connections, fixed there. They show a relapse.
console.log(`\n4. latency, ms, median [p25, p75] of ${RUNS} interleaved runs (start: start() to first stdout; burst: first to last of 1000 lines, then exit)`);
const latency = {};
const spread = {};
for (const mode of ['coi', 'plain']) {
	const h = await hostPage('cross-site', mode);
	const samples = { 'in-page': { start: [], burst: [], total: [] }, framed: { start: [], burst: [], total: [] }, 'framed, batched': { start: [], burst: [], total: [] }, 'framed, new frame per run': { start: [] } };
	const order = ['in-page', 'framed', 'framed, batched'];
	// Warm both up once (first-load costs are the same files from the same server).
	await run(h.page, 'in-page', 'run', HELLO);
	await run(h.page, h.frameUrl, 'run', HELLO);
	await run(h.page, h.keys['framed, batched'], 'run', HELLO);
	for (let i = 0; i < RUNS; i++) {
		for (const name of [...order.slice(i % 3), ...order.slice(0, i % 3)]) {
			const a = await run(h.page, h.keys[name], 'run', HELLO);
			samples[name].start.push(a.t.first - a.t.start);
			const b = await run(h.page, h.keys[name], 'run', BURST);
			if (b.stdout.split('\n').length !== 1001) throw new Error(`${name}: burst lost lines`);
			samples[name].burst.push(b.t.exit - b.t.first);
			samples[name].total.push(b.t.exit - b.t.start);
		}
		const c = await h.page.evaluate(([u, f]) => window.yk.coldRun(u, 'run', f, 'main.js'), [h.frameUrl, HELLO]);
		samples['framed, new frame per run'].start.push(c.t.first - c.t.start);
	}
	for (const [name, s] of Object.entries(samples)) {
		latency[`${mode} ${name}`] = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, r1(median(v))]));
		spread[`${mode} ${name}`] = {
			...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, `${r1(median(v))} [${r1(quantile(v, 0.25))}, ${r1(quantile(v, 0.75))}]`])),
			'fast starts (< 30 ms)': `${s.start.filter((x) => x < 30).length}/${s.start.length}`,
		};
	}
	const base = latency[`${mode} in-page`];
	for (const name of ['framed', 'framed, batched']) {
		const framed = latency[`${mode} ${name}`];
		latency[`${mode} ${name} - in-page`] = { start: r1(framed.start - base.start), burst: r1(framed.burst - base.burst), total: r1(framed.total - base.total) };
		latency[`${mode} ${name} / in-page`] = { start: r1((framed.start / base.start) * 100) + ' %', burst: r1((framed.burst / base.burst) * 100) + ' %', total: r1((framed.total / base.total) * 100) + ' %' };
	}
	await h.context.close();
}
console.table(spread);
console.table(latency);

// ----------------------------------------------- 5a. which headers are needed
// With the host isolated, the frame served without each of its headers in
// turn (serve.py's omit- prefix), and once without the iframe's allow.
console.log('\n5a. hosting: the frame on an isolated host, without each header in turn');
{
	const h = await hostPage('cross-site', 'coi');
	const packs = PAIRS['cross-site'].packs;
	const variants = {
		'every header': [`${packs}/run-frame.html?all`, {}],
		'no CORP on run-frame.html': [`${packs}/omit-frame-corp/run-frame.html`, {}],
		'no COEP on run-frame.html': [`${packs}/omit-frame-coep/run-frame.html`, {}],
		'no COEP on frame.js and the packs': [`${packs}/omit-files-coep/run-frame.html`, {}],
		'no allow="cross-origin-isolated"': [`${packs}/run-frame.html?noallow`, { isolate: false }],
	};
	const hosting = {};
	for (const [name, [url, options]] of Object.entries(variants)) {
		const opened = await h.page.evaluate(([u, o]) => window.yk.open(u, o).then((t) => t, (e) => ({ error: String(e.message) })), [url, options]);
		if ('error' in opened) {
			hosting[name] = { frame: 'blocked', stdin: '', run: opened.error.slice(0, 60) };
			continue;
		}
		const s = await run(h.page, url, 'run', STDIN, 'main.js', ['Ada\n', '36\n'], 20000);
		hosting[name] = { frame: 'loads', stdin: opened.stdin, run: s.error ?? JSON.stringify(s.stdout.trim()) };
	}
	console.table(hosting);
	check('hosting: every header given, the frame is isolated and reads stdin', hosting['every header'].stdin === true && hosting['every header'].run.includes('got Ada and 36'));
	await h.context.close();
}

// -------------------------------------------------------------- 5. code size
const code = (file) =>
	readFileSync(join(HERE, file), 'utf8')
		.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, '')
		.split('\n')
		.filter((l) => l.trim() && !/^\s*\/\//.test(l)).length;
const files = ['stdin.js', 'in-page.js', 'framed.js', 'frame.js', 'run-frame.html', 'transport.d.ts'];
console.log('\n5. lines of code (no blank or comment lines)');
console.table(Object.fromEntries(files.map((f) => [f, code(f)])));
console.log(`option B transport, host + frame, beyond in-page: ${code('framed.js') + code('frame.js') + code('run-frame.html')} lines`);

await browser.close();
server.kill();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
