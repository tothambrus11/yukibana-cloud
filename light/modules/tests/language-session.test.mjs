// A language session (runtime/language-session.ts) over a fake server
// worker that records what the session sent and answers as a server
// would: what `initialize` announces, document sync by version, a rename,
// pulled diagnostics keyed by the session's revision, and what a client
// is told when the server goes away.
//
//   node --test light/modules/tests/language-session.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ResponseError } from '../protocol/connection.ts';
import { LanguageSession, RETRIGGER_MS } from '../runtime/language-session.ts';

/** A stand-in for the server's Worker: `sent` is what the session posted, `say` posts as the server. */
function fakeServer() {
	const server = {
		sent: [],
		onmessage: null,
		onerror: null,
		onmessageerror: null,
		postMessage(message) {
			server.sent.push(message);
		},
		terminate() {},
		say(data) {
			server.onmessage?.({ data });
		},
		/** Answers the latest request named `method`. */
		answer(method, result) {
			const request = server.sent.findLast((m) => m.method === method && 'id' in m);
			assert.ok(request, `the session sent no ${method}`);
			server.say({ jsonrpc: '2.0', id: request.id, result });
		},
		/** Answers the latest request named `method` with an error. */
		refuse(method, code, message, data) {
			const request = server.sent.findLast((m) => m.method === method && 'id' in m);
			server.say({ jsonrpc: '2.0', id: request.id, error: { code, message, ...(data !== undefined && { data }) } });
		},
		/** The notifications sent, as `[method, params]`, from the `from`th message on. */
		notified(from = 0) {
			return server.sent.slice(from).filter((m) => !('id' in m)).map((m) => [m.method, m.params]);
		},
	};
	return server;
}

/** Lets the connection's handlers and the session's awaits run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A client that opens `documents` once started and records what the session tells it. */
function fakeClient(session, documents = []) {
	const told = { started: null, diagnostics: [], refreshed: [], closed: 0 };
	const client = {
		capabilities: { textDocument: { synchronization: { didSave: false } } },
		started(capabilities) {
			told.started = capabilities;
			for (const d of documents) session.open(d, 'existing');
		},
		diagnostics: (uri, list) => told.diagnostics.push([uri, list]),
		showDocument: () => false,
		applyEdit: async () => false,
		refreshed: (kind) => told.refreshed.push(kind),
		closed: () => (told.closed += 1),
	};
	return { client, told };
}

/** A session over a fake server, started with a server of `capabilities`; `events` records what the host is told. */
async function started(capabilities, documents = []) {
	const server = fakeServer();
	const events = { states: [], logs: [] };
	const session = new LanguageSession(server, {
		rootUri: 'file:///workspace/',
		settings: { python: { analysis: { typeCheckingMode: 'basic' } } },
		initializationOptions: null,
		clientName: 'a test',
		locale: 'en',
		trace: null,
		events: { state: (s) => events.states.push(s.kind), loading: () => {}, log: (level, text) => events.logs.push([level, text]), status: () => {} },
	});
	const { client, told } = fakeClient(session, documents);
	const running = session.start(client);
	server.answer('initialize', { capabilities, serverInfo: { name: 'fake', version: '1' } });
	await running;
	return { server, session, told, events };
}

const MAIN = { uri: 'file:///workspace/main.py', languageId: 'python', version: 1, text: 'print(1)\n' };
const range = (line, from, to) => ({ start: { line, character: from }, end: { line, character: to } });

test("initialize announces the client's capabilities, the root and the pack's options, and the documents open once the server is ready", async () => {
	const server = fakeServer();
	const session = new LanguageSession(server, {
		rootUri: 'file:///workspace/',
		settings: {},
		initializationOptions: { yukibana: { clangTidy: true } },
		clientName: 'a test',
		locale: 'de',
		trace: null,
		events: { state: () => {}, loading: () => {}, log: () => {}, status: () => {} },
	});
	const { client, told } = fakeClient(session, [MAIN]);
	session.open(MAIN, 'existing');
	assert.equal(session.isOpen(MAIN.uri), false, 'nothing opens before the server is ready');
	session.configure({ yukibana: { clangTidy: false } });
	const running = session.start(client);
	const init = server.sent[0];
	assert.equal(init.method, 'initialize');
	assert.deepEqual(init.params.capabilities, client.capabilities);
	assert.equal(init.params.rootUri, 'file:///workspace/');
	assert.deepEqual(init.params.workspaceFolders, [{ uri: 'file:///workspace/', name: 'workspace' }]);
	assert.deepEqual(init.params.initializationOptions, { yukibana: { clangTidy: true } });
	assert.equal(init.params.locale, 'de');
	server.answer('initialize', { capabilities: { textDocumentSync: 2 } });
	await running;
	assert.deepEqual(told.started, { textDocumentSync: 2 });
	assert.deepEqual(
		server.notified().map(([method]) => method),
		['initialized', 'yukibana/configure', 'textDocument/didOpen'],
		'a change of settings made while the server started is sent once it is ready, before the documents',
	);
	assert.deepEqual(server.notified()[1][1], { yukibana: { clangTidy: false } });
	assert.deepEqual(session.documents(), [MAIN.uri]);
});

test('a server with incremental sync is sent each edit as its ranges, at the version the editor gave', async () => {
	const { server, session } = await started({ textDocumentSync: { change: 2 } }, [MAIN]);
	const from = server.sent.length;
	session.change(MAIN.uri, { version: 2, changes: [{ range: range(0, 6, 7), rangeLength: 1, text: '2' }], text: () => assert.fail('an incremental server is never sent the whole text') });
	assert.deepEqual(server.notified(from), [
		['textDocument/didChange', { textDocument: { uri: MAIN.uri, version: 2 }, contentChanges: [{ range: range(0, 6, 7), rangeLength: 1, text: '2' }] }],
	]);
	assert.throws(() => session.change(MAIN.uri, { version: 2, changes: [], text: () => '' }), RangeError, 'an edit at a version already sent is refused');
	session.change('file:///workspace/closed.py', { version: 9, changes: [], text: () => '' });
	assert.equal(server.sent.length, from + 1, 'an edit of a document not open is not sent');
});

test('a server with full sync is sent the whole text, and one that wants no edits is sent none', async () => {
	const full = await started({ textDocumentSync: 1 }, [MAIN]);
	const from = full.server.sent.length;
	full.session.change(MAIN.uri, { version: 2, changes: [{ range: range(0, 6, 7), rangeLength: 1, text: '2' }], text: () => 'print(2)\n' });
	assert.deepEqual(full.server.notified(from), [['textDocument/didChange', { textDocument: { uri: MAIN.uri, version: 2 }, contentChanges: [{ text: 'print(2)\n' }] }]]);

	const none = await started({}, [MAIN]);
	const before = none.server.sent.length;
	const revision = none.session.revision;
	none.session.change(MAIN.uri, { version: 2, changes: [], text: () => assert.fail('read') });
	assert.equal(none.server.sent.length, before);
	assert.ok(none.session.revision > revision, 'the edit still counts as a change of the documents');
});

test('a rename closes and deletes the old document and opens and creates the new one', async () => {
	const { server, session } = await started({ textDocumentSync: 2 }, [MAIN]);
	const from = server.sent.length;
	const moved = { ...MAIN, uri: 'file:///workspace/app/main.py' };
	session.rename(MAIN.uri, moved);
	assert.deepEqual(server.notified(from), [
		['textDocument/didClose', { textDocument: { uri: MAIN.uri } }],
		['workspace/didChangeWatchedFiles', { changes: [{ uri: MAIN.uri, type: 3 }] }],
		['textDocument/didOpen', { textDocument: moved }],
		['workspace/didChangeWatchedFiles', { changes: [{ uri: moved.uri, type: 1 }] }],
	]);
	assert.deepEqual(session.documents(), [moved.uri]);
	assert.equal(session.isOpen(MAIN.uri), false);
	// The moved document keeps its version: the next edit goes on from it.
	session.change(moved.uri, { version: 2, changes: [], text: () => '' });
	assert.equal(server.sent.at(-1).params.textDocument.version, 2);
});

test('pulled errors are keyed by the revision they answer for, and an edit while the server answers makes them older', async () => {
	const { server, session } = await started({ textDocumentSync: 2, diagnosticProvider: { workspaceDiagnostics: true } }, [MAIN]);
	const asked = session.revision;
	const pull = session.workspaceErrors(new AbortController().signal);
	session.change(MAIN.uri, { version: 2, changes: [], text: () => '' });
	const error = { range: range(0, 0, 5), severity: 1, message: 'undefined name' };
	const warning = { range: range(0, 0, 5), severity: 2, message: 'unused' };
	server.answer('workspace/diagnostic', {
		items: [
			{ kind: 'full', uri: MAIN.uri, version: 1, items: [error, warning] },
			{ kind: 'unchanged', uri: 'file:///workspace/other.py', version: 1, resultId: 'r' },
		],
	});
	const pulled = await pull;
	assert.deepEqual(pulled, { revision: asked, errors: [{ uri: MAIN.uri, diagnostic: error }] }, 'errors only, of full reports');
	assert.ok(session.revision > pulled.revision);
});

test('a pull the server refuses for now is asked again, and one it refuses outright is logged and answers null', async () => {
	const { server, session, events } = await started({ diagnosticProvider: { workspaceDiagnostics: true } }, [MAIN]);
	const pull = session.workspaceErrors(new AbortController().signal);
	server.refuse('workspace/diagnostic', -32802, 'types are loading', { retriggerRequest: true });
	const pulls = () => server.sent.filter((m) => m.method === 'workspace/diagnostic').length;
	await new Promise((resolve) => setTimeout(resolve, RETRIGGER_MS + 50));
	assert.equal(pulls(), 2);
	server.refuse('workspace/diagnostic', -32603, 'it broke');
	assert.equal(await pull, null);
	assert.deepEqual(events.logs.at(-1), ['error', 'workspace/diagnostic: it broke']);

	const without = await started({}, [MAIN]);
	assert.equal(await without.session.workspaceErrors(new AbortController().signal), null, 'a server that cannot pull for the workspace is not asked');
	assert.equal(without.server.sent.some((m) => m.method === 'workspace/diagnostic'), false);
});

test('selection ranges and a call hierarchy are asked only of a server that has them, for a document it has open', async () => {
	const none = await started({}, [MAIN]);
	assert.equal(await none.session.selectionRanges(MAIN.uri, [{ line: 0, character: 1 }], new AbortController().signal), null);
	assert.equal(await none.session.calls('incoming', { name: 'f', kind: 12, uri: MAIN.uri, range: range(0, 0, 1), selectionRange: range(0, 0, 1) }, new AbortController().signal), null);
	assert.equal(none.server.sent.some((m) => m.method === 'textDocument/selectionRange' || m.method.startsWith('callHierarchy/')), false);

	const { server, session } = await started({ selectionRangeProvider: true, callHierarchyProvider: true }, [MAIN]);
	assert.equal(await session.selectionRanges('file:///workspace/closed.py', [{ line: 0, character: 1 }], new AbortController().signal), null);
	const chains = session.selectionRanges(MAIN.uri, [{ line: 0, character: 1 }, { line: 0, character: 3 }], new AbortController().signal);
	server.answer('textDocument/selectionRange', [{ range: range(0, 0, 5) }]);
	assert.equal(await chains, null, 'an answer that does not pair with the positions is none');
	const item = { name: 'f', kind: 12, uri: MAIN.uri, range: range(0, 0, 1), selectionRange: range(0, 0, 1) };
	const calls = session.calls('outgoing', item, new AbortController().signal);
	assert.deepEqual(server.sent.at(-1).params, { item });
	assert.equal(server.sent.at(-1).method, 'callHierarchy/outgoingCalls');
	server.answer('callHierarchy/outgoingCalls', []);
	assert.deepEqual(await calls, []);
});

test("the server's diagnostics, refreshes and its error messages reach the client; a cancelled request is null, a refused one thrown", async () => {
	const { server, session, told } = await started({ textDocumentSync: 2 }, [MAIN]);
	server.say({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: MAIN.uri, diagnostics: [] } });
	assert.deepEqual(told.diagnostics, [[MAIN.uri, []]]);
	server.say({ jsonrpc: '2.0', id: 'r1', method: 'workspace/inlayHint/refresh' });
	await settle();
	assert.deepEqual(told.refreshed, ['inlayHint']);
	const shown = [];
	const listening = session.onShownError((m) => shown.push(m));
	server.say({ jsonrpc: '2.0', method: 'window/showMessage', params: { type: 1, message: 'cannot rename' } });
	listening.dispose();
	server.say({ jsonrpc: '2.0', method: 'window/showMessage', params: { type: 1, message: 'later' } });
	assert.deepEqual(shown, ['cannot rename']);

	const abort = new AbortController();
	const hover = session.askOrThrow('textDocument/hover', {}, abort.signal);
	abort.abort();
	assert.equal(await hover, null);
	const rename = session.askOrThrow('textDocument/rename', {}, new AbortController().signal);
	server.refuse('textDocument/rename', -32603, 'not here');
	await assert.rejects(rename, (e) => e instanceof ResponseError && e.message === 'not here');
});

test('a server that dies closes every document and tells the client and the host', async () => {
	const { server, session, told, events } = await started({ textDocumentSync: 2 }, [MAIN]);
	server.onerror({ message: 'wasm trap', preventDefault() {} });
	assert.equal(session.ready, false);
	assert.deepEqual(session.documents(), []);
	assert.equal(told.closed, 1);
	assert.deepEqual(events.states.slice(-1), ['failed']);
	session.open(MAIN, 'existing');
	assert.equal(session.isOpen(MAIN.uri), false, 'nothing opens on a closed session');
});
