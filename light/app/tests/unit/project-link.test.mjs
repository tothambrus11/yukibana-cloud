// Unit tests of a project as a link (src/lib/project-link.ts): that a
// project survives the trip through the URL, that a damaged or foreign link
// is refused saying why, and that a project saved before links (version 0)
// or in an older version of the schema is read as the current version.
//
//   node --test tests/unit/project-link.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base64url, CURRENT, decodeProject, encodeProject, fromBase64url, holdsProject, readDocument } from '../../src/lib/project-link.ts';

const project = {
	v: 2,
	language: 'cpp',
	files: { 'main.cpp': '#include <iostream>\nint main() { std::cout << "héllo, 世界 🌸\\n"; }\n', 'src/a b#c?.h': '' },
	folders: ['empty'],
	open: ['main.cpp'],
	active: 'main.cpp',
	runOptions: { emulation: 'user', cpus: 4, strace: true },
	clangTidy: false,
};
const jsonLink = (value) => `#project=j.${base64url(new TextEncoder().encode(JSON.stringify(value)))}`;

test('a project comes back from its link exactly as it went in, unicode and odd file names included', async () => {
	const hash = await encodeProject(project);
	assert.match(hash, /^#project=z\.[A-Za-z0-9_-]+$/, 'only characters a URL keeps as they are');
	assert.deepEqual(await decodeProject(hash), project);
});

test('a large project is compressed: a link is a fraction of the text it holds', async () => {
	const big = { v: 2, language: 'python', files: { 'main.py': 'print("hello")\n'.repeat(2000) } };
	const hash = await encodeProject(big);
	assert.ok(hash.length < JSON.stringify(big).length / 10, `${hash.length} characters`);
	assert.deepEqual(await decodeProject(hash), big);
});

test('a link written by hand as plain JSON opens, with everything but the language and files left out', async () => {
	assert.deepEqual(await decodeProject(jsonLink({ v: 2, language: 'python', files: { 'main.py': 'print(1)' } })), { v: 2, language: 'python', files: { 'main.py': 'print(1)' } });
});

test('only a fragment that starts with project= is a project link; any other is left to the page', () => {
	assert.equal(holdsProject('#project=z.abc'), true);
	assert.equal(holdsProject('project=j.abc'), true);
	assert.equal(holdsProject(''), false);
	assert.equal(holdsProject('#main.py'), false);
});

test('a link cut short when copied is refused as damaged, not opened half', async () => {
	const hash = await encodeProject(project);
	await assert.rejects(decodeProject(hash.slice(0, hash.length - 12)), /damaged/);
	await assert.rejects(decodeProject('#project=z.%%%'), /damaged/);
	await assert.rejects(decodeProject('#project=q.abc'), /encoding this app does not know/);
	await assert.rejects(decodeProject(`#project=j.${base64url(new TextEncoder().encode('{"v":1,'))}`), /not JSON/);
});

test('a link that is not a project says everything that is wrong with it', async () => {
	await assert.rejects(decodeProject(jsonLink({ v: 1, language: 'python', files: { 'main.py': 3 }, open: 'main.py' })), (e) => /files\["main\.py"\] must be a string/.test(e.message) && /open must be an array/.test(e.message));
	await assert.rejects(decodeProject(jsonLink([1])), /not an object/);
	await assert.rejects(decodeProject(jsonLink({ v: 1, language: 'cobol', files: {} })), /no language "cobol"/);
	await assert.rejects(decodeProject(jsonLink({ v: 1, language: 'cpp', files: {}, runOptions: { emulation: 'system', cpus: 3, strace: false } })), /cpus must be 1, 2 or 4/);
});

test('a link made by a newer app is refused with a reason to reload, not misread', async () => {
	await assert.rejects(decodeProject(jsonLink({ v: CURRENT + 1, language: 'python', files: {} })), /newer Yukibana Light/);
	await assert.rejects(decodeProject(jsonLink({ v: 'one', language: 'python', files: {} })), /version "one" is not one/);
});

test('a link has no version 0: without its version a link does not say its language', async () => {
	await assert.rejects(decodeProject(jsonLink({ files: { 'main.py': '' } })), /does not say its language/);
});

test('a key the schema does not have is dropped, not carried into the project', async () => {
	assert.deepEqual(await decodeProject(jsonLink({ v: 2, language: 'go', files: {}, secret: 1 })), { v: 2, language: 'go', files: {} });
});

test('a project saved in the browser before links (version 0) is read as the current version, its bad tabs and settings dropped', () => {
	const saved = { files: { 'main.py': 'x' }, folders: ['a', 3], open: ['main.py', null], active: 'main.py', runOptions: { emulation: 'bogus' }, optimization: '-O' };
	assert.deepEqual(readDocument(saved, { language: 'python' }), { v: 2, language: 'python', files: { 'main.py': 'x' }, folders: ['a'], open: ['main.py'], active: 'main.py', optimization: '-O' });
	assert.throws(() => readDocument({ files: { 'main.py': 1 } }, { language: 'python' }), /files\["main\.py"\] must be a string/);
});

test('a link made before clang-tidy (version 1) opens with clang-tidy on, everything else as it was', async () => {
	const v1 = { v: 1, language: 'cpp', files: { 'main.cpp': 'int main() {}\n' }, open: ['main.cpp'], active: 'main.cpp', optimization: '-O2' };
	assert.deepEqual(await decodeProject(jsonLink(v1)), { ...v1, v: 2 });
	assert.equal(readDocument(v1).clangTidy, undefined, 'absent: it runs');
});

test('clang-tidy turned off is kept in the link, and only a boolean says so', async () => {
	const off = { v: 2, language: 'c', files: { 'main.c': '' }, clangTidy: false };
	assert.deepEqual(await decodeProject(await encodeProject(off)), off);
	await assert.rejects(decodeProject(jsonLink({ ...off, clangTidy: 'no' })), /clangTidy must be boolean/);
	assert.equal((await decodeProject(jsonLink({ v: 1, language: 'c', files: {}, clangTidy: 'no' }))).clangTidy, undefined, 'version 1 has no such key: it is dropped');
});

test('base64url round-trips every byte, and takes padded and plain base64 as well', () => {
	const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
	const text = base64url(bytes);
	assert.doesNotMatch(text, /[+/=]/);
	assert.deepEqual(fromBase64url(text), bytes);
	assert.deepEqual(fromBase64url(Buffer.from(bytes).toString('base64')), bytes);
	assert.throws(() => fromBase64url('a b'));
});
