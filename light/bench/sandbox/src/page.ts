/**
 * The bench page. `?mode=inpage` starts the packs' workers in the page, as
 * every host does today; `?mode=relay` and `?mode=direct` start them in a
 * runner frame on another site (`&frame=<origin>`, see frame.ts). Everything
 * else is the same code: clangd through a LanguageSession, Test and Run
 * through an instance of the language package over a RunnerPool.
 *
 * bench.mjs calls `bench.lsp()` then `bench.tests()`, reading memory from
 * the OS between them; each returns times in milliseconds.
 */
import { createInstance, pathOf, snapshotOf, type Files, type Subject } from '@yukibana/core';
import { LANGUAGES } from '@yukibana/lang-cpp';
import type { Requires } from '@yukibana/protocol';
import { isFinal, LanguageSession, PackLocator, RunnerPool, workerTransport, type RunEvent, type RunState, type WorkerFactory } from '@yukibana/runtime';
import { NO_PROPERTIES, packLanguage, pageExplorers, run, test, type ExplorerWorkers, type PackHost } from '@yukibana/std';
import { FILES, loud } from './project.ts';
import { RemoteWorker } from './remote.ts';

type Mode = 'inpage' | 'relay' | 'direct' | 'direct-batched';
const query = new URL(location.href).searchParams;
const mode = (query.get('mode') ?? 'inpage') as Mode;
const frameOrigin = query.get('frame') ?? location.origin;
const ROOT = 'file:///workspace/';
const uri = (path: string): string => new URL(path, ROOT).href;
const now = (): number => performance.now();
let frameReadyAt = 0;

// ---- Where workers start ----------------------------------------------------

let frame: Window | null = null;
const frameReady: Promise<void> =
	mode === 'inpage'
		? Promise.resolve()
		: new Promise((resolve) => {
				addEventListener('message', function ready(event: MessageEvent<{ type?: string }>) {
					if (event.origin !== frameOrigin || event.data?.type !== 'frame-ready') return;
					removeEventListener('message', ready);
					frameReadyAt = now();
					resolve();
				});
				const element = document.createElement('iframe');
				element.src = `${frameOrigin}/frame.html`;
				// What the sandbox adds: no top navigation, popups or forms; scripts on the frame's own origin.
				element.setAttribute('sandbox', 'allow-scripts allow-same-origin');
				element.allow = 'cross-origin-isolated';
				element.style.display = 'none';
				document.body.append(element);
				frame = element.contentWindow;
			});

const packsBase = new URL('/packs/', mode === 'inpage' ? location.origin : frameOrigin);
const factory: WorkerFactory = (url, { name }) =>
	mode === 'inpage' ? new Worker(url, { type: 'module', name }) : (new RemoteWorker(frame!, frameOrigin, url, name, mode) as unknown as Worker);

// ---- The host the instance runs on ------------------------------------------

const NEEDS: Requires = { runner: { default: { crossOriginIsolated: 'optional-stdin', sameOriginPacks: true } } };
const locator = PackLocator.unpinned(packsBase);
// A framed transport is judged against the frame: its origin is the packs'. It has no stdin here (a production frame would make the buffer itself).
const context = mode === 'inpage' ? { origin: location.origin, crossOriginIsolated } : { origin: frameOrigin, crossOriginIsolated: false };
const pool = new RunnerPool({ transport: workerTransport({ context, factory }) });
const host: PackHost = {
	packs: locator,
	requires: NEEDS,
	pool,
	explorers: (): Promise<ExplorerWorkers> => pageExplorers(),
	madeExplorers: null,
};

const spec = LANGUAGES.cpp.spec;
const language = packLanguage(spec, () => Promise.resolve({ sample: FILES, properties: NO_PROPERTIES, serverSettings: {}, configFiles: [] }));
const instance = createInstance<PackHost>({ languages: [language], providers: LANGUAGES.cpp.providers(language), host });
const subject: Subject = { kind: 'language', id: language.key };

// ---- Statistics --------------------------------------------------------------

interface Summary {
	n: number;
	median: number;
	p95: number;
	mean: number;
}
const summary = (values: number[]): Summary => {
	const sorted = [...values].sort((a, b) => a - b);
	const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
	return { n: values.length, median: at(0.5), p95: at(0.95), mean: values.reduce((a, b) => a + b, 0) / values.length };
};

// ---- The language server -----------------------------------------------------

let session: LanguageSession | null = null;
const diagnosticWaiters = new Map<string, Array<(at: number) => void>>();
const nextDiagnostics = (path: string): Promise<number> =>
	new Promise((resolve) => {
		const list = diagnosticWaiters.get(uri(path)) ?? [];
		list.push(resolve);
		diagnosticWaiters.set(uri(path), list);
	});

async function lsp(): Promise<Record<string, unknown>> {
	await frameReady;
	const serverUrl = await locator.file(language.pack, 'server.js');
	const started = now();
	const made = new LanguageSession(factory(serverUrl, { name: 'cpp lsp' }) as never, {
		rootUri: ROOT,
		settings: {},
		initializationOptions: null,
		clientName: 'sandbox bench',
		locale: 'en',
		trace: null,
		events: { state: () => {}, loading: () => {}, log: () => {}, status: () => {} },
	});
	session = made;
	const firstTest = nextDiagnostics('tests/bits_test.cpp');
	const firstMain = nextDiagnostics('main.cpp');
	await made.start({
		capabilities: {
			textDocument: {
				publishDiagnostics: {},
				completion: { completionItem: { snippetSupport: true } },
				hover: { contentFormat: ['markdown', 'plaintext'] },
				semanticTokens: { requests: { full: true }, tokenTypes: [], tokenModifiers: [], formats: ['relative'] },
			},
		},
		started: () => {
			for (const [path, text] of Object.entries(FILES)) made.open({ uri: uri(path), languageId: path.endsWith('.txt') ? 'plaintext' : 'cpp', version: 1, text }, 'existing');
		},
		diagnostics: (at) => {
			const time = now();
			for (const resolve of diagnosticWaiters.get(at)?.splice(0) ?? []) resolve(time);
		},
		showDocument: () => false,
		applyEdit: async () => false,
		refreshed: () => {},
		closed: () => {},
	});
	const initialized = now();
	const [testDiagnostics, mainDiagnostics] = await Promise.all([firstTest, firstMain]);

	const signal = new AbortController().signal;
	const main = FILES['main.cpp'] ?? '';
	const lines = main.split('\n');
	const coutLine = lines.findIndex((line) => line.includes('std::cout'));
	const coutColumn = (lines[coutLine] ?? '').indexOf('cout');
	const popColumn = (lines[coutLine] ?? '').indexOf('popcount') + 2;

	const timed = async (count: number, ask: () => Promise<unknown>): Promise<number[]> => {
		await ask(); // the first answer warms the server's caches; not counted
		const times: number[] = [];
		for (let i = 0; i < count; i += 1) {
			const start = now();
			await ask();
			times.push(now() - start);
		}
		return times;
	};
	const at = { textDocument: { uri: uri('main.cpp') } };
	const completion = await timed(40, () => made.askOrThrow('textDocument/completion', { ...at, position: { line: coutLine, character: coutColumn } }, signal));
	const hover = await timed(40, () => made.askOrThrow('textDocument/hover', { ...at, position: { line: coutLine, character: popColumn } }, signal));
	const tokens = await timed(20, () => made.askOrThrow('textDocument/semanticTokens/full', at, signal));
	// An edit as typing makes it, then the diagnostics it leads to.
	const edits: number[] = [];
	let text = main;
	for (let version = 2; version < 22; version += 1) {
		const line = text.split('\n').length - 1;
		const insert = `// ${version}\n`;
		text += insert;
		const waiting = nextDiagnostics('main.cpp');
		const start = now();
		const current = text;
		made.change(uri('main.cpp'), { version, changes: [{ range: { start: { line, character: 0 }, end: { line, character: 0 } }, rangeLength: 0, text: insert }], text: () => current });
		edits.push((await waiting) - start);
	}
	return {
		frameReady: frameReadyAt,
		serverStarted: started,
		initialize: initialized - started,
		firstDiagnosticsMain: mainDiagnostics,
		firstDiagnosticsTest: testDiagnostics,
		completion: summary(completion),
		hover: summary(hover),
		semanticTokens: summary(tokens),
		editToDiagnostics: summary(edits),
	};
}

// ---- Test and Run ------------------------------------------------------------

type Ended = RunState | { kind: 'refused'; reason: string };
interface Performed {
	ms: number;
	state: Ended;
	output: number;
	text: string;
}

let runs = 0;
async function perform(token: typeof test | typeof run, files: Files): Promise<Performed> {
	const snapshot = snapshotOf(files, (runs += 1));
	const start = now();
	let output = 0;
	let text = '';
	const state = await new Promise<Ended>((resolve) => {
		const onEvent = (event: RunEvent): void => {
			if (event.type === 'state' && isFinal(event.state)) resolve(event.state);
			else if (event.type === 'output') {
				for (const piece of event.pieces) {
					output += piece.length;
					if (text.length < 4000) text += piece;
				}
			} else if (event.type === 'problem' || event.type === 'notice') text += `[${event.type}] ${event.text}\n`;
		};
		instance.perform(subject, token, { files: snapshot.files(), entry: pathOf(spec.entry), options: null, snippet: 'bench', onEvent }, snapshot, new AbortController().signal).then(
			(outcome) => {
				if (outcome.kind !== 'done') resolve({ kind: 'refused', reason: outcome.reason });
			},
			(error: unknown) => resolve({ kind: 'refused', reason: String(error) }),
		);
	});
	return { ms: now() - start, state, output, text };
}

async function tests(): Promise<Record<string, unknown>> {
	await frameReady;
	const cold = await perform(test, FILES);
	const warm: Performed[] = [];
	for (let i = 0; i < 3; i += 1) warm.push(await perform(test, FILES));
	const quiet = [await perform(run, FILES), await perform(run, FILES)];
	const megabytes = 16;
	const noisyFiles = { ...FILES, 'main.cpp': loud(megabytes) };
	const noisy = [await perform(run, noisyFiles), await perform(run, noisyFiles)];
	const all = [cold, ...warm, ...quiet, ...noisy];
	return {
		testCold: cold.ms,
		testWarm: summary(warm.map((r) => r.ms)),
		runQuiet: Math.min(...quiet.map((r) => r.ms)),
		runLoud: Math.min(...noisy.map((r) => r.ms)),
		loudBytes: noisy[0]?.output ?? 0,
		ok: all.every((r) => r.state.kind === 'ended'),
		states: all.map((r) => r.state.kind),
		testOutput: cold.text.slice(0, 1500),
	};
}

Object.assign(globalThis, { bench: { lsp, tests, mode, isolated: crossOriginIsolated } });

/** SHA-256 throughput of this browser, in MB/s, over `megabytes` MB: what checking a pack's files against published hashes would cost. */
async function digest(megabytes: number): Promise<number> {
	const bytes = new Uint8Array(megabytes << 20);
	for (let i = 0; i < bytes.length; i += 4096) bytes[i] = i & 0xff;
	await crypto.subtle.digest('SHA-256', bytes.subarray(0, 1 << 20));
	const start = now();
	await crypto.subtle.digest('SHA-256', bytes);
	return megabytes / ((now() - start) / 1000);
}
Object.assign((globalThis as unknown as { bench: object }).bench, { digest });
