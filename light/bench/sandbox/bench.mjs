// What the sandbox costs: the bench page (dist/) in each mode, in a fresh
// Chrome each time, with the installed C++ pack.
//
//   pnpm run build && node bench.mjs [rounds]
//
// One server answers on every interface; the page is loaded from
// http://localhost:<port> and the frame from http://127.0.0.1:<port>, which
// are two sites, so Chrome puts the frame in a process of its own as it
// would a frame on another domain. Every response is cross-origin isolated.
// Memory is the OS's: the private bytes and working sets of the Chrome
// process and every process under it, sampled after the page loads, after
// the language server has answered, and after the tests ran.
// Chrome is $CHROMIUM or the installed Chrome. Windows only (the sampling).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const packs = normalize(process.env.PACKS ?? join(here, '../../app/static/packs'));
const chrome = process.env.CHROMIUM ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const rounds = Number(process.argv[2] ?? 5);
const MODES = ['inpage', 'relay', 'direct', 'direct-batched'];

if (!existsSync(join(dist, 'index.html'))) throw new Error('No build: pnpm run build first.');
if (!existsSync(join(packs, 'cpp', 'server.js'))) throw new Error(`The cpp pack is not in ${packs}.`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
let packBytes = 0;
const server = createServer((request, response) => {
	const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
	const [root, rest] = path.startsWith('/packs/') ? [packs, path.slice('/packs/'.length)] : [dist, path === '/' ? 'index.html' : path];
	const file = normalize(join(root, rest));
	if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return void response.writeHead(404).end();
	const body = readFileSync(file);
	if (path.startsWith('/packs/')) packBytes += body.length;
	response.writeHead(200, {
		'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'require-corp',
		'Cross-Origin-Resource-Policy': 'cross-origin',
		'Cache-Control': 'no-cache',
	});
	response.end(body);
});
await new Promise((resolve) => server.listen(0, resolve));
const { port } = server.address();

/** Private bytes and working set, in MB, of process `root` and all under it; and how many processes, and renderers. */
function memoryUnder(root) {
	const json = execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,PrivatePageCount,WorkingSetSize,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8', maxBuffer: 64 << 20 });
	const all = JSON.parse(json);
	const children = new Map();
	for (const p of all) children.set(p.ParentProcessId, [...(children.get(p.ParentProcessId) ?? []), p]);
	const tree = [];
	const visit = (pid) => {
		for (const child of children.get(pid) ?? []) {
			tree.push(child);
			visit(child.ProcessId);
		}
	};
	const self = all.find((p) => p.ProcessId === root);
	if (self) tree.push(self);
	visit(root);
	const mb = (bytes) => bytes / (1 << 20);
	return {
		privateMB: mb(tree.reduce((sum, p) => sum + Number(p.PrivatePageCount ?? 0), 0)),
		workingSetMB: mb(tree.reduce((sum, p) => sum + Number(p.WorkingSetSize ?? 0), 0)),
		processes: tree.length,
		renderers: tree.filter((p) => String(p.CommandLine ?? '').includes('--type=renderer')).length,
	};
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function once(mode) {
	const browserServer = await chromium.launchServer({ executablePath: chrome, headless: true });
	const pid = browserServer.process().pid;
	const browser = await chromium.connect(browserServer.wsEndpoint());
	try {
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', (error) => errors.push(String(error)));
		packBytes = 0;
		await page.goto(`http://localhost:${port}/?mode=${mode}&frame=${encodeURIComponent(`http://127.0.0.1:${port}`)}`);
		const isolated = await page.evaluate(() => globalThis.bench.isolated);
		await settle(1500);
		const loaded = memoryUnder(pid);
		const lsp = await page.evaluate(() => globalThis.bench.lsp());
		await settle(1500);
		const afterLsp = memoryUnder(pid);
		const tests = await page.evaluate(() => globalThis.bench.tests());
		await settle(1500);
		const afterTests = memoryUnder(pid);
		const sha256MBps = await page.evaluate(() => globalThis.bench.digest(256));
		return { mode, isolated, lsp, tests, memory: { loaded, afterLsp, afterTests }, packMB: packBytes / (1 << 20), sha256MBps, errors };
	} finally {
		await browser.close();
		await browserServer.close();
	}
}

const results = [];
for (let round = 0; round < rounds; round += 1) {
	for (const mode of MODES) {
		const result = await once(mode);
		results.push(result);
		const l = result.lsp;
		const t = result.tests;
		console.log(
			`${round} ${mode.padEnd(6)} init ${l.initialize.toFixed(0)}ms diag ${l.firstDiagnosticsTest.toFixed(0)}ms compl ${l.completion.median.toFixed(1)}ms edit ${l.editToDiagnostics.median.toFixed(0)}ms | test cold ${t.testCold.toFixed(0)} warm ${t.testWarm.median.toFixed(0)} loud ${t.runLoud.toFixed(0)}ms ok=${t.ok} | mem ${result.memory.afterTests.privateMB.toFixed(0)}MB/${result.memory.afterTests.processes}p`,
		);
		if (!t.ok) console.log(t.states, t.testOutput);
		if (result.errors.length > 0) console.log(result.errors);
	}
}
writeFileSync(join(here, 'results.json'), JSON.stringify(results, null, '\t'));

// ---- Summary: medians over rounds, per mode ----
const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const ROWS = [
	['frame ready (from navigation)', (r) => r.lsp.frameReady],
	['clangd initialize', (r) => r.lsp.initialize],
	['first diagnostics, main.cpp (from navigation)', (r) => r.lsp.firstDiagnosticsMain],
	['first diagnostics, test (from navigation)', (r) => r.lsp.firstDiagnosticsTest],
	['completion, median', (r) => r.lsp.completion.median],
	['completion, p95', (r) => r.lsp.completion.p95],
	['hover, median', (r) => r.lsp.hover.median],
	['semantic tokens, median', (r) => r.lsp.semanticTokens.median],
	['edit → diagnostics, median', (r) => r.lsp.editToDiagnostics.median],
	['edit → diagnostics, p95', (r) => r.lsp.editToDiagnostics.p95],
	['GoogleTest run, cold', (r) => r.tests.testCold],
	['GoogleTest run, warm (median)', (r) => r.tests.testWarm.median],
	['Run, quiet program', (r) => r.tests.runQuiet],
	['Run, 16 MB of output', (r) => r.tests.runLoud],
	['memory after load, private MB', (r) => r.memory.loaded.privateMB],
	['memory after LSP, private MB', (r) => r.memory.afterLsp.privateMB],
	['memory after tests, private MB', (r) => r.memory.afterTests.privateMB],
	['memory after tests, working set MB', (r) => r.memory.afterTests.workingSetMB],
	['processes after tests', (r) => r.memory.afterTests.processes],
	['pack bytes loaded, MB', (r) => r.packMB],
	['SHA-256, MB/s', (r) => r.sha256MBps],
	['renderer processes', (r) => r.memory.afterTests.renderers],
];
const table = [['', ...MODES].join(' | ')];
for (const [label, of] of ROWS) table.push([label, ...MODES.map((mode) => median(results.filter((r) => r.mode === mode).map(of)).toFixed(1))].join(' | '));
console.log(`\n${table.join('\n')}`);
server.close();
