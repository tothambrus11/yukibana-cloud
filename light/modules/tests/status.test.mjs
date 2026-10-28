// A language server's reports about its optional parts (protocol/status.ts),
// read as the app reads them: a malformed one is refused, not drawn.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPartStatus } from '../protocol/status.ts';

test("the C++ pack's report that clang-tidy is ready is one", () => {
	assert.ok(isPartStatus({ id: 'clang-tidy', label: 'clang-tidy', state: 'ready' }));
	assert.ok(isPartStatus({ id: 'clang-tidy', label: 'clang-tidy', state: 'failed', detail: 'clangd-tidy.wasm: 404', extra: 1 }));
});

test('a report with a state no host knows, or without a name, is not one', () => {
	assert.ok(!isPartStatus({ id: 'clang-tidy', label: 'clang-tidy', state: 'busy' }));
	assert.ok(!isPartStatus({ id: 'clang-tidy', state: 'ready' }));
	assert.ok(!isPartStatus({ id: 'clang-tidy', label: 'clang-tidy', state: 'failed', detail: 404 }));
	assert.ok(!isPartStatus(null));
});
