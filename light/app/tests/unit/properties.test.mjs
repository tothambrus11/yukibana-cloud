// The build settings as properties (src/lib/properties/): each file lens
// reads what the Build settings always read and writes back keeping every
// line that is not its own, byte for byte, including the lines another
// lens does not recognise; each meta lens maps onto the field the project
// always saved; a language's summary is the one its Build settings chip
// showed; and its runner is sent the options it always was.
//
//   node --test tests/unit/properties.test.mjs     (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { sourceUrlOf } from '../../../modules/list.mjs';

registerHooks({
	resolve(specifier, context, next) {
		const url = sourceUrlOf(specifier);
		return url === null ? next(specifier, context) : { url, shortCircuit: true };
	},
});

const { pathOf, readProperty, writeProperty } = await import('../../../modules/core/index.ts');
const { LANGUAGES } = await import('../../src/lib/languages.ts');
const { metaOf } = await import('../../src/lib/yukibana.ts');
const { runnerOptionsOf, settingsOf } = await import('../../src/lib/properties/index.ts');
const cpp = await import('../../src/lib/properties/cpp.ts');
const rust = await import('../../src/lib/properties/rust.ts');
const { levelProperty } = await import('../../src/lib/properties/levels.ts');

/** A project of `files`, with `meta` as its saved fields, as the workspace's snapshot answers. */
function snapshotOf(files = {}, meta = {}) {
	return {
		revision: 1,
		paths: () => Object.keys(files).map(pathOf),
		file: (path) => (Object.hasOwn(files, path) ? files[path] : null),
		files: () => ({ ...files }),
		meta: (binding) => (Object.hasOwn(meta, binding.key) ? binding.parse(meta[binding.key]) : null),
	};
}

/** What a file lens reads from `text`. */
const read = (property, text) => property.storage.read(text);
/** What a file lens writes into `text`. */
const write = (property, text, value) => property.storage.write(text, value);

/** The lenses on compile_flags.txt of a C++ project. */
const FLAG_LENSES = [cpp.CPP_TARGET, cpp.CPP_STANDARD, cpp.C_STANDARD, cpp.CPP_LEVEL, cpp.SANITIZERS];

/** What a lens reads after it was given `value`: the value, or `default` for the default where no line says it. */
function readsAs(property, value) {
	if (property === cpp.SANITIZERS) return { kind: 'value', value };
	return value === property.default ? { kind: 'default' } : { kind: 'value', value };
}

/**
 * Holds the laws of a file lens over `text`, for every value of `values`:
 * reading back gives the value written; writing it again changes no byte;
 * every other lens on the file reads what it read before, unrecognised
 * included; and each of `foreign` (lines no lens reads, with their line
 * ends) is still there, byte for byte and in order.
 */
function lawsHold(property, others, text, values, foreign, where) {
	for (const value of values) {
		const out = write(property, text, value);
		const at = `${where}: ${property.id} = ${JSON.stringify(value)}`;
		assert.deepEqual(read(property, out), readsAs(property, value), `${at}: reads back`);
		assert.equal(write(property, out, value), out, `${at}: writing it again changes no byte`);
		for (const other of others) if (other !== property) assert.deepEqual(read(other, out), read(other, text), `${at}: ${other.id} reads as before`);
		let from = 0;
		for (const line of foreign) {
			const found = out.indexOf(line, from);
			assert.ok(found >= 0, `${at}: keeps ${JSON.stringify(line)} in ${JSON.stringify(out)}`);
			from = found + line.length;
		}
	}
}

const targetIds = cpp.CPP_TARGET.choices(snapshotOf());

const fixture = new URL('../../../packs/cpp/tests/fixtures/target-cases.json', import.meta.url);
test('the target lens reads every case of the pack’s fixture as the runner does, and round-trips it', { skip: !existsSync(fixture) && 'the C++ pack is not checked out' }, () => {
	for (const { name, flags, expect } of JSON.parse(readFileSync(fixture, 'utf8'))) {
		const expected = expect.kind === 'unsupported' ? { kind: 'unrecognised', raw: expect.triple } : expect.kind === 'default' ? { kind: 'default' } : { kind: 'value', value: expect.id };
		assert.deepEqual(read(cpp.CPP_TARGET, flags), expected, name);
		// The fixture's lines that are not target flags (`-std=c++20`, `-O2`, `-mtarget=x`) stay.
		const foreign = (flags ?? '').split(/(?<=\n)/).filter((l) => l.trim() !== '' && !/^--?target(=|$)/.test(l.trim()) && !/^[a-z0-9_]+-linux-musl\s*$/i.test(l.trim()));
		lawsHold(cpp.CPP_TARGET, FLAG_LENSES, flags, targetIds, foreign, name);
	}
});

/** A compile_flags.txt edited by hand: CRLF, spacing, a define with a space, and a value of each lens that the pickers do not offer. */
const HAND_EDITED = '-Wall\r\n  -I include  \r\n\r\n-DNAME="x y"\r\n--target=x86_64-linux-gnu\r\n-std=c++2d\r\n-std=c17\r\n-Og\r\n-fsanitize=signed-integer-overflow\r\n-Wextra';
const HAND_FOREIGN = ['-Wall\r\n', '  -I include  \r\n', '-DNAME="x y"\r\n'];

test('a hand-edited compile_flags.txt reads each value it does not recognise as written', () => {
	assert.deepEqual(read(cpp.CPP_TARGET, HAND_EDITED), { kind: 'unrecognised', raw: 'x86_64-linux-gnu' });
	assert.deepEqual(read(cpp.CPP_STANDARD, HAND_EDITED), { kind: 'unrecognised', raw: 'c++2d' });
	assert.deepEqual(read(cpp.C_STANDARD, HAND_EDITED), { kind: 'value', value: 'c17' });
	assert.deepEqual(read(cpp.CPP_LEVEL, HAND_EDITED), { kind: 'unrecognised', raw: '-Og' });
	assert.deepEqual(read(cpp.SANITIZERS, HAND_EDITED), { kind: 'value', value: { address: false, undefined: false } });
});

test('writing a target, a standard or a level into a hand-edited file keeps every other line byte for byte, CRLF included', () => {
	lawsHold(cpp.CPP_TARGET, FLAG_LENSES, HAND_EDITED, targetIds, HAND_FOREIGN, 'hand-edited');
	lawsHold(cpp.CPP_STANDARD, FLAG_LENSES, HAND_EDITED, cpp.CPP_STANDARD.choices(snapshotOf()), [...HAND_FOREIGN, '-std=c17\r\n'], 'hand-edited');
	lawsHold(cpp.C_STANDARD, FLAG_LENSES, HAND_EDITED, cpp.C_STANDARD.choices(snapshotOf()), [...HAND_FOREIGN, '-std=c++2d\r\n'], 'hand-edited');
	lawsHold(cpp.CPP_LEVEL, FLAG_LENSES, HAND_EDITED, cpp.CPP_LEVEL.choices(snapshotOf()), HAND_FOREIGN, 'hand-edited');
});

test('the sanitizers lens keeps every other line and a check it does not offer, with the \\n line ends the menu always wrote', () => {
	const lf = HAND_EDITED.replaceAll('\r\n', '\n');
	const choices = [false, true].flatMap((address) => [false, true].map((undefined) => ({ address, undefined })));
	lawsHold(cpp.SANITIZERS, FLAG_LENSES, lf, choices, ['-Wall\n', '  -I include  \n', '-DNAME="x y"\n', '-fsanitize=signed-integer-overflow\n'], 'hand-edited');
	assert.equal(write(cpp.SANITIZERS, HAND_EDITED, { address: true, undefined: false }), `${lf}\n-fsanitize=address\n`);
});

test('writing what a sample project reads changes no byte of it', () => {
	for (const language of LANGUAGES) {
		const settings = settingsOf(language.id);
		for (const { open } of settings.model.properties) {
			open((property) => {
				if (property.storage.kind !== 'file') return;
				const text = language.sample[property.storage.path] ?? null;
				const now = readProperty(snapshotOf(language.sample), property);
				const value = now.kind === 'value' ? now.value : property.default;
				const out = write(property, text, value);
				assert.equal(out, text ?? '', `${language.id}: ${property.id}`);
			});
		}
	}
});

/** A .clang-tidy edited by hand: comments, options and a list in flow style. */
const TIDY = "# Mine.\nChecks: '-*,modernize-*' # inline\n# Before the options.\nWarningsAsErrors: ''\nCheckOptions:\n  readability-braces-around-statements.ShortStatementLines: 2\n";

test('the clang-tidy rules lens rewrites Checks alone, and takes the key out for clangd’s own checks', () => {
	assert.deepEqual(read(cpp.TIDY_CHECKS, TIDY), { kind: 'value', value: [{ on: false, glob: '*' }, { on: true, glob: 'modernize-*' }] });
	const foreign = ['# Mine.\n', '# Before the options.\n', "WarningsAsErrors: ''\n", 'CheckOptions:\n', '  readability-braces-around-statements.ShortStatementLines: 2\n'];
	lawsHold(cpp.TIDY_CHECKS, [], TIDY, [[{ on: true, glob: 'bugprone-*' }], [], null], foreign, '.clang-tidy');
	assert.equal(write(cpp.TIDY_CHECKS, TIDY, null), "# Mine.\n# Before the options.\nWarningsAsErrors: ''\nCheckOptions:\n  readability-braces-around-statements.ShortStatementLines: 2\n");
	assert.equal(write(cpp.TIDY_CHECKS, "WarningsAsErrors: ''", null), "WarningsAsErrors: ''", 'a file without the key is left as it is');
	assert.equal(write(cpp.TIDY_CHECKS, null, null), '', 'no file stays no file');
	assert.equal(write(cpp.TIDY_CHECKS, "Checks: 'misc-*'\n", null), '', 'a file of the key alone is left empty, and so not created');
});

/** A .cargo/config.toml edited by hand. */
const CARGO = '# Mine.\n[build]\nrustflags = ["-Dwarnings"]  # strict\ntarget = "armv7-unknown-linux-gnueabihf"\n\n[alias]\nt = "test"\n';

test('the Rust target lens rewrites [build] target alone, keeping every other line of .cargo/config.toml', () => {
	assert.deepEqual(read(rust.RUST_TARGET, CARGO), { kind: 'unrecognised', raw: 'armv7-unknown-linux-gnueabihf' });
	assert.deepEqual(read(rust.RUST_TARGET, null), { kind: 'value', value: 'wasm32-wasi' }, 'no file names the default, which rustTargetOf reads as the value');
	const ids = rust.RUST_TARGET.choices(snapshotOf());
	for (const id of ids) {
		const out = write(rust.RUST_TARGET, CARGO, id);
		assert.deepEqual(read(rust.RUST_TARGET, out), { kind: 'value', value: id }, id);
		assert.equal(write(rust.RUST_TARGET, out, id), out, `${id}: writing it again changes no byte`);
		for (const line of ['# Mine.\n', '[build]\n', 'rustflags = ["-Dwarnings"]  # strict\n', '[alias]\n', 't = "test"\n']) assert.ok(out.includes(line), `${id}: keeps ${JSON.stringify(line)}`);
	}
	assert.equal(write(rust.RUST_TARGET, '[build]\ntarget = "x86_64-unknown-linux-musl"\n', 'wasm32-wasi'), '', 'the default needs no file');
});

test('a meta property saves its field as the project always did, the default as unset', () => {
	const swift = levelProperty('swift');
	assert.deepEqual(writeProperty(snapshotOf(), swift, '-O'), { kind: 'meta', key: 'optimization', value: '-O' });
	assert.deepEqual(writeProperty(snapshotOf(), swift, '-Onone'), { kind: 'meta', key: 'optimization', value: null });
	assert.deepEqual(readProperty(snapshotOf({}, { optimization: '-O3' }), swift), { kind: 'default' }, "a level of another language's reads as unset");
	assert.deepEqual(readProperty(snapshotOf({}, { optimization: 'on' }), levelProperty('scala')), { kind: 'value', value: 'on' });
	assert.deepEqual(writeProperty(snapshotOf(), rust.MIRI, 'off'), { kind: 'meta', key: 'miri', value: null });
	assert.deepEqual(writeProperty(snapshotOf(), rust.MIRI, 's390x'), { kind: 'meta', key: 'miri', value: 's390x' });
	assert.deepEqual(writeProperty(snapshotOf(), cpp.CLANG_TIDY, false), { kind: 'meta', key: 'clangTidy', value: false });
	assert.deepEqual(writeProperty(snapshotOf(), cpp.CLANG_TIDY, true), { kind: 'meta', key: 'clangTidy', value: null });
	const defaults = { emulation: 'system', cpus: 1, strace: false };
	assert.deepEqual(writeProperty(snapshotOf(), cpp.CPP_RUN_OPTIONS, defaults), { kind: 'meta', key: 'runOptions', value: defaults }, 'run options once chosen are saved whole');
	assert.deepEqual(readProperty(snapshotOf({}, { runOptions: { cpus: 4, emulation: 'qemu' } }), cpp.CPP_RUN_OPTIONS), { kind: 'value', value: { emulation: 'system', cpus: 4, strace: false } });
	assert.throws(() => writeProperty(snapshotOf(), rust.MIRI, 'wasm32'), RangeError);
});

const linux = { 'compile_flags.txt': '--target=x86_64-linux-musl\n' };
const cargo = (triple) => ({ '.cargo/config.toml': `[build]\ntarget = "${triple}"\n` });

test('each language’s summary is what its Build settings chip said', () => {
	const cases = [
		['python', {}, {}, ''],
		['cpp', {}, {}, 'WASI · -O2 · no sanitizers'],
		['c', { 'compile_flags.txt': '-std=c23\n-O0\n-fsanitize=undefined\n' }, {}, 'WASI · -O0 · UBSan'],
		['cpp', { 'compile_flags.txt': HAND_EDITED }, { runOptions: { emulation: 'system', cpus: 4, strace: true } }, 'x86_64-linux-gnu · -Og · no sanitizers'],
		['cpp', { 'compile_flags.txt': '-target\n' }, {}, 'Other target · -O2 · no sanitizers'],
		['cpp', { ...linux, 'compile_flags.txt': '--target=x86_64-linux-musl\n-fsanitize=address,undefined\n-O3\n' }, { runOptions: { emulation: 'system', cpus: 2, strace: true } }, 'x86-64 · -O3 · ASan + UBSan · 2 CPUs · strace'],
		['cpp', linux, { runOptions: { emulation: 'user', cpus: 4, strace: false } }, 'x86-64 · -O2 · no sanitizers · user mode'],
		['cpp', {}, { runOptions: { emulation: 'user', cpus: 4, strace: true } }, 'WASI · -O2 · no sanitizers'],
		['rust', {}, {}, 'WASI · 0'],
		['rust', cargo('aarch64-unknown-linux-musl'), { optimization: '3', runOptions: { emulation: 'user', cpus: 1, strace: true } }, 'AArch64 · 3 · user mode · strace'],
		['rust', cargo('x86_64-unknown-linux-musl'), { miri: 'i686', runOptions: { emulation: 'user', cpus: 1, strace: true } }, 'x86-64 · 0 · Miri on x86 (i686)'],
		['rust', cargo('armv7-unknown-linux-gnueabihf'), {}, 'armv7-unknown-linux-gnueabihf · 0'],
		['swift', {}, {}, '-Onone'],
		['swift', {}, { optimization: '-Osize' }, '-Osize'],
		['scala', {}, { optimization: 'on' }, 'on'],
	];
	for (const [id, files, meta, said] of cases) assert.equal(settingsOf(id).model.summary(snapshotOf(files, meta)), said, `${id} ${JSON.stringify(files)} ${JSON.stringify(meta)}`);
});

test('each language’s runner is sent the options it always was', () => {
	const options = (id, files = {}, meta = {}) => runnerOptionsOf(settingsOf(id), snapshotOf(files, meta));
	const defaults = { emulation: 'system', cpus: 1, strace: false };
	assert.deepEqual(options('python'), null);
	assert.deepEqual(options('cpp'), defaults, 'C and C++ always send the run options, and their level is in compile_flags.txt');
	assert.deepEqual(options('c', { 'compile_flags.txt': '-O3\n' }, { optimization: '-O1' }), defaults);
	assert.deepEqual(options('swift'), { optimization: '-Onone' });
	assert.deepEqual(options('scala', {}, { optimization: 'on' }), { optimization: 'on' });
	assert.deepEqual(options('rust'), { optimization: '0', ...defaults });
	assert.deepEqual(Object.keys(options('rust', {}, { miri: 'armv7', optimization: 's', runOptions: { emulation: 'user', cpus: 2, strace: true } })), ['optimization', 'emulation', 'cpus', 'strace', 'miri']);
	assert.deepEqual(options('rust', {}, { miri: 'armv7' }).miri, 'armv7');
});

test('every language’s body carries its property model, which holds exactly its settings', async () => {
	for (const language of LANGUAGES) {
		const settings = settingsOf(language.id);
		assert.equal((await metaOf(language).body()).properties, settings.model, language.id);
		const roles = Object.entries(settings).flatMap(([role, value]) => (role === 'model' || value === null ? [] : [role === 'standard' ? value.property.id : value.id]));
		assert.deepEqual(settings.model.properties.map((p) => p.id).sort(), roles.sort(), language.id);
	}
});
