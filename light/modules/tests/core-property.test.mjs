// Properties as lenses (core/property.ts): a `file` property reads its value
// from one line of a file and writes it back keeping every other byte, as
// compile_flags.txt has to be kept (it is the single source of truth for a
// C++ project's target); a `meta` property maps onto a field of the saved
// project, with unset told from the default.
//
//   node --test light/modules/tests/core-property.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metaKey, pathOf, readProperty, writeProperty } from '../core/index.ts';
import { snapshotOf } from './core-fakes.mjs';

const TARGETS = ['wasm32-wasi', 'x86_64-linux', 'aarch64-linux'];
const flags = pathOf('compile_flags.txt');

/** A target property over the `--target=` line of compile_flags.txt, a small model of lang-cpp/targets.ts. */
const target = {
	id: '@yukibana/test#target',
	label: 'Target',
	storage: {
		kind: 'file',
		path: flags,
		read(text) {
			const line = text?.split('\n').find((l) => l.startsWith('--target='));
			if (line === undefined) return { kind: 'default' };
			const value = line.slice('--target='.length);
			return TARGETS.includes(value) ? { kind: 'value', value } : { kind: 'unrecognised', raw: line };
		},
		write(text, value) {
			const lines = (text ?? '').split('\n');
			const at = lines.findIndex((l) => l.startsWith('--target='));
			if (at === -1) return `--target=${value}\n${text ?? ''}`;
			lines[at] = `--target=${value}`;
			return lines.join('\n');
		},
	},
	choices: () => TARGETS,
	relevant: () => ({ kind: 'available' }),
	default: 'wasm32-wasi',
};

const isLevel = (u) => u === '-Onone' || u === '-O' || u === '-Osize';
const optimization = {
	id: '@yukibana/test#optimization',
	label: 'Optimization',
	storage: { kind: 'meta', binding: { key: metaKey('optimization'), parse: (u) => (isLevel(u) ? u : null), write: (v) => v } },
	choices: () => ['-Onone', '-O', '-Osize'],
	relevant: () => ({ kind: 'available' }),
	default: '-Onone',
};

test('a file property writes its value into the file and keeps every other byte, comments and spacing included', () => {
	const text = '# chosen by hand\n-std=c++20\r\n--target=wasm32-wasi\n\n  -Wall  \n-I include';
	const snapshot = snapshotOf({ 'compile_flags.txt': text });
	assert.deepEqual(readProperty(snapshot, target), { kind: 'value', value: 'wasm32-wasi' });
	const edit = writeProperty(snapshot, target, 'x86_64-linux');
	assert.deepEqual(edit, { kind: 'file', path: 'compile_flags.txt', text: text.replace('--target=wasm32-wasi', '--target=x86_64-linux') });
	assert.deepEqual(readProperty(snapshotOf({ 'compile_flags.txt': edit.text }), target), { kind: 'value', value: 'x86_64-linux' });
	const back = writeProperty(snapshotOf({ 'compile_flags.txt': edit.text }), target, 'wasm32-wasi');
	assert.equal(back.text, text, 'a round trip gives the file back byte for byte');
});

test('a file property reads the default from an absent file or one that says nothing, and creates the line on write', () => {
	assert.deepEqual(readProperty(snapshotOf({}), target), { kind: 'default' });
	assert.deepEqual(readProperty(snapshotOf({ 'compile_flags.txt': '-std=c++20\n' }), target), { kind: 'default' });
	assert.deepEqual(writeProperty(snapshotOf({}), target, 'aarch64-linux'), { kind: 'file', path: 'compile_flags.txt', text: '--target=aarch64-linux\n' });
});

test('a hand-edited line the property does not know is unrecognised, shown as written, until a write replaces it', () => {
	const snapshot = snapshotOf({ 'compile_flags.txt': '--target=riscv64-linux\n-O2\n' });
	assert.deepEqual(readProperty(snapshot, target), { kind: 'unrecognised', raw: '--target=riscv64-linux' });
	assert.equal(writeProperty(snapshot, target, 'x86_64-linux').text, '--target=x86_64-linux\n-O2\n');
});

test('a value outside the choices is refused, and nothing is written', () => {
	assert.throws(() => writeProperty(snapshotOf({}), target, 'riscv64-linux'), RangeError);
});

test('a meta property maps onto a field of the saved project, with unset and unparseable read as the default', () => {
	assert.deepEqual(readProperty(snapshotOf({}, { optimization: '-O' }), optimization), { kind: 'value', value: '-O' });
	assert.deepEqual(readProperty(snapshotOf({}, {}), optimization), { kind: 'default' });
	assert.deepEqual(readProperty(snapshotOf({}, { optimization: 3 }), optimization), { kind: 'default' }, 'a stored value of another shape');
	assert.deepEqual(writeProperty(snapshotOf({}), optimization, '-Osize'), { kind: 'meta', key: 'optimization', value: '-Osize' });
});
