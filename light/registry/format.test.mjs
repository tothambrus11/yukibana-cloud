// What a build's pack.json and files.json may say, as tables.
//
//   node --test light/registry/
import assert from 'node:assert/strict';
import test from 'node:test';
import { derivedFrom, manifestProblems, pathProblem, readFilesJson, readPackJson, tableProblems, writeFilesJson, writePackJson } from './format.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const USED = `sha256-${'c'.repeat(64)}`;

/** A manifest with nothing wrong, with `changes` laid over it. */
const manifest = (changes = {}) => ({
	format: 1,
	id: 'cpp',
	name: 'C++',
	version: '3.2.0',
	protocol: 1,
	requires: { runner: { default: { crossOriginIsolated: 'optional-stdin', sameOriginPacks: true } } },
	uses: { linux: { digest: USED, optional: false } },
	files: { sha256: A, count: 2, bytes: 14 },
	...changes,
});

test('the paths the installed packs have are paths of a build', () => {
	for (const file of ['runner.js', 'wasm/clang.wasm', 'sysroot.tar.gz', 'LICENSE-llvm.txt', 'a/b/c/d_e-f.1.json', '.hidden', 'docs/pack.json', 'CON1.js', 'console.js']) {
		assert.equal(pathProblem(file), null, file);
	}
});

test('a path that cannot be kept on every file system, or that leaves the build, is refused by name', () => {
	const refused = {
		'': 'non-empty',
		'/etc/passwd': 'relative',
		'../x.js': 'leaves',
		'a/../../x.js': 'normal form',
		'a//b.js': 'normal form',
		'./a.js': 'normal form',
		'a/': 'normal form',
		'a\\b.js': 'character',
		'a b.js': 'character',
		'c++/v1/vector': 'character',
		'naïve.js': 'character',
		'C:/x.js': 'character',
		'a/b.': 'ending in a dot',
		'nul': 'device name',
		'lib/AUX.wasm': 'device name',
		'com1.tar.gz': 'device name',
		'pack.json': 'describes the build',
		'Files.JSON': 'describes the build',
		'pack.json.br': 'compressed copy of what does',
		'FILES.json.gz': 'compressed copy of what does',
		['a/'.repeat(300)]: 'longer',
	};
	for (const [file, why] of Object.entries(refused)) assert.match(pathProblem(file) ?? 'no problem', new RegExp(why), JSON.stringify(file));
	assert.match(pathProblem(7), /non-empty string/);
});

test('a compressed copy is told from its name, and only a .br or .gz is one', () => {
	assert.equal(derivedFrom('wasm/clang.wasm.br'), 'wasm/clang.wasm');
	assert.equal(derivedFrom('runner.js.gz'), 'runner.js');
	assert.equal(derivedFrom('sysroot.tar.gz'), 'sysroot.tar');
	assert.equal(derivedFrom('runner.js'), null);
	assert.equal(derivedFrom('archive.zst'), null);
});

test('one build cannot hold two files a case-insensitive disk would merge, a file that is also a directory, or a file beside its own compressed copy', () => {
	assert.deepEqual(tableProblems(['a.js', 'b/c.wasm', 'sysroot.tar.gz', 'other.tar.br']), []);
	assert.match(tableProblems(['Runner.js', 'runner.js'])[0], /differ only in case/);
	assert.match(tableProblems(['lib', 'lib/a.js'])[0], /is a file, and a directory of/);
	assert.match(tableProblems(['LIB', 'lib/a.js'])[0], /is a file, and a directory of/);
	assert.match(tableProblems(['a.wasm', 'a.wasm.br'])[0], /compressed copy of "a.wasm"/);
	assert.match(tableProblems(['a.wasm', 'A.WASM.GZ'])[0], /compressed copy of "a.wasm"/);
});

test('files.json is the same bytes whatever order the files were found in, and reads back as written', () => {
	const files = [
		{ path: 'wasm/a.wasm', sha256: B, size: 4 },
		{ path: 'runner.js', sha256: A, size: 10 },
		{ path: 'Zeta.js', sha256: A, size: 0 },
	];
	const text = writeFilesJson(files);
	assert.equal(text, writeFilesJson([...files].reverse()));
	assert.equal(text, `{\n"Zeta.js": { "sha256": "${A}", "size": 0 },\n"runner.js": { "sha256": "${A}", "size": 10 },\n"wasm/a.wasm": { "sha256": "${B}", "size": 4 }\n}\n`);
	const read = readFilesJson(text);
	assert.equal(read.ok, true);
	assert.deepEqual([...read.files.keys()], ['Zeta.js', 'runner.js', 'wasm/a.wasm']);
	assert.equal(read.count, 3);
	assert.equal(read.bytes, 14);
	assert.equal(writeFilesJson([]), '{}\n');
	assert.deepEqual(readFilesJson('{}\n'), { ok: true, files: new Map(), count: 0, bytes: 0 });
});

test('files.json is never written for files that cannot be one build', () => {
	assert.throws(() => writeFilesJson([{ path: '../x', sha256: A, size: 1 }]), /leaves the build/);
	assert.throws(() => writeFilesJson([{ path: 'a.js', sha256: 'abc', size: 1 }]), /no sha256 and size/);
	assert.throws(() => writeFilesJson([{ path: 'a.js', sha256: A, size: -1 }]), /no sha256 and size/);
	assert.throws(
		() =>
			writeFilesJson([
				{ path: 'a.js', sha256: A, size: 1 },
				{ path: 'a.js.br', sha256: A, size: 1 },
			]),
		/compressed copy/,
	);
});

test('a files.json that lists what a build may not hold is refused, with every problem named', () => {
	const refused = {
		'not json': /not JSON/,
		'[]': /not an object/,
		[`{"../x.js":{"sha256":"${A}","size":1}}`]: /leaves the build/,
		[`{"a.js":{"sha256":"${A.toUpperCase()}","size":1}}`]: /no sha256 and size/,
		[`{"a.js":{"sha256":"${A}","size":1.5}}`]: /no sha256 and size/,
		[`{"a.js":{"sha256":"${A}","size":1},"A.JS":{"sha256":"${A}","size":1}}`]: /differ only in case/,
		[`{"a.js":{"sha256":"${A}","size":1},"a.js.gz":{"sha256":"${A}","size":1}}`]: /compressed copy/,
		[`{"pack.json":{"sha256":"${A}","size":1}}`]: /describes the build/,
	};
	for (const [text, why] of Object.entries(refused)) {
		const read = readFilesJson(text);
		assert.equal(read.ok, false, text);
		assert.match(read.problems.join('; '), why, text);
	}
	const both = readFilesJson(`{"../x.js":{"sha256":"${A}","size":1},"b.js":7}`);
	assert.equal(both.problems.length, 2);
});

test('a file named __proto__ is a file like any other', () => {
	const read = readFilesJson(`{"__proto__":{"sha256":"${A}","size":3}}`);
	assert.equal(read.ok, true);
	assert.deepEqual(read.files.get('__proto__'), { sha256: A, size: 3 });
});

test('pack.json is the same bytes however the manifest was put together, and reads back as written', () => {
	const text = writePackJson(manifest());
	const shuffled = Object.fromEntries(Object.entries(manifest()).reverse());
	shuffled.requires = { runner: { default: { sameOriginPacks: true, crossOriginIsolated: 'optional-stdin' } } };
	assert.equal(writePackJson(shuffled), text);
	assert.equal(text.endsWith('}\n'), true);
	assert.equal(text.includes('\r'), false);
	assert.deepEqual(Object.keys(JSON.parse(text)), ['format', 'id', 'name', 'version', 'protocol', 'requires', 'uses', 'files']);
	const read = readPackJson(text);
	assert.equal(read.ok, true);
	assert.deepEqual(read.manifest, manifest());
});

test('a field the tool does not know is kept, after the ones it does', () => {
	const text = writePackJson(manifest({ tests: { layout: 'flat' }, about: 'x' }));
	assert.deepEqual(Object.keys(JSON.parse(text)).slice(-2), ['about', 'tests']);
	assert.equal(readPackJson(text).ok, true);
});

test('a pack.json that does not say what a build must is refused, field by field', () => {
	const refused = [
		[{ format: 2 }, /format 2, and this tool reads format 1/],
		[{ id: 'Cpp' }, /its id "Cpp" is not a pack's/],
		[{ id: '../cpp' }, /is not a pack's/],
		[{ id: USED }, /is not a pack's/],
		[{ name: ' ' }, /no name/],
		[{ version: '' }, /its version ""/],
		[{ version: '1.0 beta' }, /its version/],
		[{ protocol: 0 }, /not a major version/],
		[{ protocol: '1' }, /not a major version/],
		[{ requires: [] }, /requires is not an object/],
		[{ build: 'abc' }, /it has a build field/],
		[{ uses: null }, /uses is not an object/],
		[{ uses: { cpp: { digest: USED, optional: false } } }, /uses itself/],
		[{ uses: { 'Linux!': { digest: USED, optional: false } } }, /not a pack's id/],
		[{ uses: { linux: { digest: 'c'.repeat(64), optional: false } } }, /its use of linux/],
		[{ uses: { linux: { digest: USED } } }, /its use of linux/],
		[{ files: { sha256: A, count: 2 } }, /its files is not/],
		[{ files: { sha256: 'x', count: 2, bytes: 1 } }, /its files is not/],
	];
	for (const [changes, why] of refused) {
		const problems = manifestProblems(manifest(changes));
		assert.match(problems.join('; '), why, JSON.stringify(changes));
		assert.throws(() => writePackJson(manifest(changes)), RangeError, JSON.stringify(changes));
		assert.equal(readPackJson(JSON.stringify(manifest(changes))).ok, false, JSON.stringify(changes));
	}
	assert.equal(manifestProblems(manifest({ id: 'x', name: '', version: '', protocol: 0 })).length, 3);
	assert.deepEqual(manifestProblems(null), ['it is not an object']);
	assert.match(readPackJson('{').problems[0], /pack\.json is not JSON/);
});
