// What a registry answers for a path, as a table: mostly what it must not do.
//
//   node --test light/registry/
import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_SECURITY_POLICY, plainHeaders, refusal, ruleFor } from './rules.mjs';

const BUILD = `sha256-${'ab'.repeat(32)}`;
const header = (headers) => (name) => headers[name] ?? null;

test('the frame page may be embedded by other sites and is never cached', () => {
	const rule = ruleFor('/frame/v1/frame.html');
	assert.equal(rule?.kind, 'frame-page');
	assert.equal(rule.key, 'frame/v1/frame.html');
	assert.equal(rule.headers['Cross-Origin-Resource-Policy'], 'cross-origin');
	assert.equal(rule.headers['Cross-Origin-Embedder-Policy'], 'require-corp');
	assert.equal(rule.headers['Cache-Control'], 'no-cache');
	assert.equal(rule.headers['Content-Type'], 'text/html; charset=utf-8');
	assert.match(rule.headers['Content-Security-Policy'], /frame-ancestors \*$/);
});

test("the frame page is the one document under /frame/, and the frame's own scripts carry no embedding policy", () => {
	const script = ruleFor('/frame/v1/frame.js');
	assert.equal(script.kind, 'frame-asset');
	assert.equal(script.headers['Content-Security-Policy'], CONTENT_SECURITY_POLICY);
	assert.equal(script.headers['Cross-Origin-Resource-Policy'], 'same-origin');
	assert.equal(ruleFor('/frame/v1/other.html').headers['Content-Type'], 'application/octet-stream');
	assert.equal(ruleFor('/frame/v1/sub/frame.html').headers['Content-Type'], 'application/octet-stream');
});

test("a build's file is immutable and cannot be read or loaded by another site", () => {
	const rule = ruleFor(`/packs/${BUILD}/runner.js`);
	assert.equal(rule?.kind, 'build-file');
	assert.equal(rule.headers['Cache-Control'], 'public, max-age=31536000, immutable');
	assert.equal(rule.headers['Cross-Origin-Resource-Policy'], 'same-origin');
	assert.equal(rule.headers['Access-Control-Allow-Origin'], undefined);
	assert.equal(rule.headers['Content-Type'], 'text/javascript; charset=utf-8');
	assert.equal(ruleFor(`/packs/${BUILD}/sub/dir/clang.wasm`).headers['Content-Type'], 'application/wasm');
});

test('what a page asks to learn whether a registry has a build is readable from any site', () => {
	for (const name of ['pack.json', 'files.json']) {
		const rule = ruleFor(`/packs/${BUILD}/${name}`);
		assert.equal(rule?.kind, 'probe', name);
		assert.equal(rule.headers['Access-Control-Allow-Origin'], '*');
		assert.equal(rule.headers['Cross-Origin-Resource-Policy'], 'cross-origin');
		assert.equal(rule.headers['Cache-Control'], 'public, max-age=31536000, immutable');
	}
	// Only at the build's root: a file of that name deeper down is a file like any other.
	assert.equal(ruleFor(`/packs/${BUILD}/data/pack.json`).kind, 'build-file');
	const index = ruleFor('/index.json');
	assert.equal(index?.kind, 'index');
	assert.equal(index.headers['Access-Control-Allow-Origin'], '*');
	assert.equal(index.headers['Cache-Control'], 'no-cache');
});

test('a pack served by name is revalidated, since the same path may hold another build tomorrow', () => {
	const rule = ruleFor('/packs/cpp/server.js');
	assert.equal(rule?.kind, 'named-file');
	assert.equal(rule.headers['Cache-Control'], 'no-cache');
	assert.equal(rule.headers['Cross-Origin-Resource-Policy'], 'same-origin');
});

test('no pack can put a document on the registry: only scripts, WebAssembly and JSON get their type', () => {
	// The last two: an extension that names something every object has is still only an extension.
	for (const name of ['docs/index.html', 'logo.svg', 'page.xhtml', 'notes.xml', 'style.css', 'README', 'sysroot.tar.gz', '.hidden', 'x.constructor', 'a.__proto__']) {
		assert.equal(ruleFor(`/packs/${BUILD}/${name}`).headers['Content-Type'], 'application/octet-stream', name);
		assert.equal(ruleFor(`/packs/cpp/${name}`).headers['Content-Type'], 'application/octet-stream', name);
	}
	assert.equal(ruleFor(`/packs/${BUILD}/a.JS`).headers['Content-Type'], 'text/javascript; charset=utf-8');
});

test('every file tells the browser not to guess its type, and names no referrer', () => {
	for (const path of ['/frame/v1/frame.html', '/frame/v1/frame.js', `/packs/${BUILD}/pack.json`, `/packs/${BUILD}/x.wasm`, '/packs/cpp/server.js', '/index.json']) {
		const { headers } = ruleFor(path);
		assert.equal(headers['X-Content-Type-Options'], 'nosniff', path);
		assert.equal(headers['Referrer-Policy'], 'no-referrer', path);
	}
});

test('a worker started from a pack file is held to the policy: nothing from, and nothing to, another origin', () => {
	for (const path of ['/frame/v1/frame.js', `/packs/${BUILD}/runner.js`, '/packs/cpp/server.js']) {
		const policy = ruleFor(path).headers['Content-Security-Policy'];
		assert.match(policy, /connect-src 'self' blob: data:(;|$)/, path);
		assert.match(policy, /script-src 'self' blob: data: 'unsafe-eval' 'wasm-unsafe-eval'/, path);
		assert.doesNotMatch(policy, /https?:|\*/, path);
	}
});

test('no path of a registry sets a cookie', () => {
	const paths = ['/', '/index.json', '/frame/v1/frame.html', '/frame/v1/frame.js', `/packs/${BUILD}/pack.json`, `/packs/${BUILD}/a/b.wasm`, '/packs/cpp/server.js', '/nothing'];
	for (const path of paths) {
		const names = Object.keys(ruleFor(path)?.headers ?? plainHeaders()).map((name) => name.toLowerCase());
		assert.ok(!names.includes('set-cookie'), path);
	}
});

test('what is not a file of a registry has no key', () => {
	const not = [
		'/',
		'',
		'packs/cpp/server.js',
		'/index.json/x',
		'/other.json',
		'/frame',
		'/frame/v1',
		'/frame/v1/',
		'/frame/v0/frame.html',
		'/frame/v01/frame.html',
		'/frame/latest/frame.html',
		`/packs/cpp/${'a'.repeat(1024)}`,
		'/packs',
		'/packs/',
		'/packs/cpp',
		'/packs/cpp/',
		`/packs/${BUILD}`,
		`/packs/${BUILD}/`,
		'/packs/Cpp/server.js',
		'/packs/@alice/prolog/server.js',
		`/packs/SHA256-${'ab'.repeat(32)}/pack.json`,
		'/packs/cpp//server.js',
		'/packs/cpp/./server.js',
		'/packs/cpp/../linux/vm.js',
		'/packs/../index.json',
		'/packs/cpp/%2e%2e/secret',
		'/packs/cpp/a%2Fb',
		'/packs/cpp/a\\b',
		'/packs/cpp/a b',
		'/packs/cpp/a\u0000b',
		'/packs/cpp/café.js',
		'/.well-known/anything',
		'/service-worker.js',
	];
	for (const path of not) assert.equal(ruleFor(path), null, JSON.stringify(path));
});

test('a name that only looks like a build is a pack by that name, never immutable', () => {
	// 63 hex digits: not a build's directory, but a legal pack name.
	const rule = ruleFor(`/packs/sha256-${'a'.repeat(63)}/pack.json`);
	assert.equal(rule?.kind, 'named-file');
	assert.equal(rule.headers['Cache-Control'], 'no-cache');
	assert.equal(rule.headers['Access-Control-Allow-Origin'], undefined);
});

test('a registry is only read, and never serves a service worker', () => {
	assert.equal(refusal('GET', header({})), null);
	assert.equal(refusal('HEAD', header({})), null);
	for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
		const refused = refusal(method, header({}));
		assert.equal(refused?.status, 405, method);
		assert.equal(refused.allow, 'GET, HEAD');
	}
	assert.equal(refusal('GET', header({ 'service-worker': 'script' }))?.status, 403);
	assert.equal(refusal('GET', header({ 'service-worker': '' }))?.status, 403);
});

test('an answer that is not a file is text and is never kept', () => {
	const headers = plainHeaders();
	assert.equal(headers['Content-Type'], 'text/plain; charset=utf-8');
	assert.equal(headers['Cache-Control'], 'no-store');
	assert.equal(headers['X-Content-Type-Options'], 'nosniff');
});
