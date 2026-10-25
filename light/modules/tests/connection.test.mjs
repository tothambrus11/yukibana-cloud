// The JSON-RPC connection to a language server (protocol/connection.ts),
// over a fake worker that records what the editor sent and lets a test
// answer as the server would.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Connection, INTERNAL_ERROR, METHOD_NOT_FOUND, REQUEST_CANCELLED, ResponseError } from '../protocol/connection.ts';

/** A stand-in for the server's Worker: `sent` is what the connection posted, `say` posts as the server. */
function fakeServer() {
	const server = {
		sent: [],
		terminated: false,
		onmessage: null,
		onerror: null,
		onmessageerror: null,
		postMessage(message) {
			server.sent.push(message);
		},
		terminate() {
			server.terminated = true;
		},
		say(data) {
			server.onmessage?.({ data });
		},
	};
	return server;
}

/** Lets the connection's async request handlers post their answers. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a request the editor stops waiting for is cancelled at the server and answered as cancelled', async () => {
	const server = fakeServer();
	const connection = new Connection(server, () => {});
	const abort = new AbortController();
	const answer = connection.request('textDocument/hover', { position: { line: 0, character: 0 } }, abort.signal);
	abort.abort();
	await assert.rejects(answer, (e) => e instanceof ResponseError && e.code === REQUEST_CANCELLED);
	assert.deepEqual(server.sent.at(-1), { jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 1 } });
	// The server's late answer is dropped, not delivered to anyone.
	server.say({ jsonrpc: '2.0', id: 1, result: { contents: 'late' } });
});

test('a request made after the editor already gave up is cancelled without reaching the server', async () => {
	const server = fakeServer();
	const connection = new Connection(server, () => {});
	await assert.rejects(connection.request('textDocument/hover', {}, AbortSignal.abort()), (e) => e.code === REQUEST_CANCELLED);
	assert.deepEqual(server.sent, []);
});

test('when the language server dies, every request still waiting fails and later ones fail at once', async () => {
	const server = fakeServer();
	const closes = [];
	const connection = new Connection(server, (error) => closes.push(error?.message ?? null));
	const pending = [connection.request('initialize', {}), connection.request('shutdown', undefined)];
	server.onerror({ message: 'wasm trap', preventDefault() {} });
	for (const request of pending) await assert.rejects(request, /wasm trap/);
	await assert.rejects(connection.request('textDocument/hover', {}), /wasm trap/);
	assert.deepEqual(closes, ['wasm trap']);
	assert.ok(server.terminated);
});

test('stopping the language server fails what was waiting, says it was stopped, and closes only once', async () => {
	const server = fakeServer();
	const closes = [];
	const connection = new Connection(server, (error) => closes.push(error));
	const pending = connection.request('initialize', {});
	connection.dispose();
	connection.dispose(new Error('again'));
	await assert.rejects(pending, /stopped/);
	assert.deepEqual(closes, [null]);
	connection.notify('exit', undefined);
	assert.equal(server.sent.length, 1, 'nothing is posted to a stopped server');
});

test('a server request nobody handles is answered with method not found', async () => {
	const server = fakeServer();
	new Connection(server, () => {});
	server.say({ jsonrpc: '2.0', id: 7, method: 'workspace/unknownThing', params: {} });
	await settle();
	assert.equal(server.sent.length, 1);
	assert.equal(server.sent[0].id, 7);
	assert.equal(server.sent[0].error.code, METHOD_NOT_FOUND);
	assert.equal(METHOD_NOT_FOUND, -32601);
});

test('a handler that throws answers the server with an internal error, and keeps a response error its code', async () => {
	const server = fakeServer();
	const connection = new Connection(server, () => {});
	connection.onRequest('workspace/applyEdit', () => {
		throw new Error('the file is read-only');
	});
	connection.onRequest('window/showDocument', () => {
		throw new ResponseError(-32602, 'no such document');
	});
	server.say({ jsonrpc: '2.0', id: 'a', method: 'workspace/applyEdit', params: {} });
	server.say({ jsonrpc: '2.0', id: 'b', method: 'window/showDocument', params: {} });
	await settle();
	assert.deepEqual(server.sent, [
		{ jsonrpc: '2.0', id: 'a', error: { code: INTERNAL_ERROR, message: 'the file is read-only' } },
		{ jsonrpc: '2.0', id: 'b', error: { code: -32602, message: 'no such document' } },
	]);
	assert.equal(INTERNAL_ERROR, -32603);
});

test("the server's answer resolves the request it answers, and its error rejects with the server's code", async () => {
	const server = fakeServer();
	const connection = new Connection(server, () => {});
	const first = connection.request('initialize', {});
	const second = connection.request('textDocument/rename', {});
	server.say({ jsonrpc: '2.0', id: 2, error: { code: -32803, message: 'cannot rename a keyword' } });
	server.say({ jsonrpc: '2.0', id: 1, result: { capabilities: {} } });
	assert.deepEqual(await first, { capabilities: {} });
	await assert.rejects(second, (e) => e instanceof ResponseError && e.code === -32803 && e.message === 'cannot rename a keyword');
});

test('a notification from the server reaches its handler, and what is not JSON-RPC is ignored', () => {
	const server = fakeServer();
	const connection = new Connection(server, () => {});
	const seen = [];
	connection.onNotification('yukibana/loading', (params) => seen.push(params));
	server.say('not a message');
	server.say(null);
	server.say({ jsonrpc: '2.0', method: 'yukibana/loading', params: { label: 'clangd.wasm', loaded: 1, total: 2 } });
	assert.deepEqual(seen, [{ label: 'clangd.wasm', loaded: 1, total: 2 }]);
	assert.deepEqual(server.sent, []);
});
