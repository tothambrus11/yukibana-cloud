// Unit tests of the short forms the app shows in tight places
// (src/lib/format.ts): durations, and language server names in the status bar.
//
//   node --test tests/unit/format.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDuration, serverLabel } from '../../src/lib/format.ts';

test('a compile time reads as the terminal says it: milliseconds under a second, else tenths of seconds', () => {
	const cases = [
		[0, '0 ms'],
		[412, '412 ms'],
		[999.4, '999 ms'],
		[1000, '1.0 s'],
		[2400, '2.4 s'],
		[40659, '40.7 s'],
		[-5, '0 ms'],
		[Number.NaN, '0 ms'],
	];
	for (const [ms, text] of cases) assert.equal(formatDuration(ms), text, String(ms));
});

test("the status bar names each pack's server by its name and major.minor version, once", () => {
	const cases = [
		['clangd clangd version 21.1.8 (https://github.com/llvm/llvm-project 2078da43e25a4623cab2d0d60decddf709aaea28) unix-tidy wasm32-unknown-emscripten', 'clangd 21.1'],
		['basedpyright 1.40.2', 'basedpyright 1.40'],
		['yukibana-typescript-ls 0.1.0 (TypeScript 6.0.3)', 'TypeScript 6.0'],
		['scala3-compiler-js (Scala 3.7.4 presentation front end) 3.7.4', 'Scala 3.7'],
		['javac 25 (teavm-javac, TeaVM 0.12.3) 25', 'javac 25'],
		['tree-sitter-kotlin 0.3.8 (syntax only) 0.3.8', 'tree-sitter-kotlin 0.3'],
		['sourcekit-lsp-lite (sourcekitd 6.3.3) + swift-syntax formatting sourcekitd and swift-frontend 6.3.3', 'sourcekit-lsp-lite 6.3'],
		['GHC 9.12.2', 'GHC 9.12'],
	];
	for (const [server, label] of cases) assert.equal(serverLabel(server), label, server);
});

test('a server that names no version is shown as it named itself', () => {
	assert.equal(serverLabel('language server'), 'language server');
	assert.equal(serverLabel('  phpactor  '), 'phpactor');
});
