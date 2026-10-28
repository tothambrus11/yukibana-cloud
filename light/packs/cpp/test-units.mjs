// Tests of how the C/C++ pack is cut into toolchain units (toolchains/<unit>/:
// emsdk, musl, compilers, libs, vm; README, "Units"): which edits re-key which
// unit, with the real key (light/scripts/toolchain-key.sh) over a scratch
// copy of the pack, and that a unit's scripts reach only the units its needs
// file names. Nothing is built, so it takes seconds.
//
//   node --test test-units.mjs   (from light/packs/cpp; needs bash and git)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIGHT = path.resolve(HERE, '../..');
const UNITS = ['emsdk', 'musl', 'compilers', 'libs', 'vm'];
const scratches = [];
after(() => {
    for (const d of scratches) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * A scratch repository holding the key's two scripts and a copy of this
 * pack without its node_modules, so a test may edit any file of it. The
 * key reads untracked files too, so nothing is committed.
 */
function scratch() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-units-test-'));
    scratches.push(dir);
    fs.mkdirSync(path.join(dir, 'light/scripts'), { recursive: true });
    for (const name of ['toolchain-key.sh', 'toolchain-build-env.sh']) fs.copyFileSync(path.join(LIGHT, 'scripts', name), path.join(dir, 'light/scripts', name));
    fs.cpSync(HERE, path.join(dir, 'light/packs/cpp'), { recursive: true, filter: (src) => path.basename(src) !== 'node_modules' });
    execFileSync('git', ['-C', dir, 'init', '-q']);
    return dir;
}

/** Runs `script` in bash with toolchain-key.sh sourced, in repository `root`; returns its stdout. */
const keySh = (root, script, ...args) =>
    execFileSync('bash', ['-c', `set -euo pipefail; source light/scripts/toolchain-key.sh; ${script}`, 'bash', ...args], { cwd: root, encoding: 'utf8' });

/** Every unit's key in repository `root`, as { unit: key }. */
const keys = (root) => Object.fromEntries(UNITS.map((u) => [u, keySh(root, 'toolchain_key "$1"', `cpp/${u}`).trim()]));

/** The units whose key differs between `a` and `b`, sorted. */
const changed = (a, b) => UNITS.filter((u) => a[u] !== b[u]).sort();

/** Edits pack file `file` in `root` by appending a line (a comment, for a script or patch: still a new blob). */
const touch = (root, file, line = '# edited\n') => fs.appendFileSync(path.join(root, 'light/packs/cpp', file), line);

/** Sets pin `name` in pack file `file` to `value`. */
const setPin = (root, file, name, value) => {
    const f = path.join(root, 'light/packs/cpp', file);
    const text = fs.readFileSync(f, 'utf8');
    assert.match(text, new RegExp(`^${name}=`, 'm'), `${file} pins ${name}`);
    fs.writeFileSync(f, text.replace(new RegExp(`^${name}=.*$`, 'm'), `${name}=${value}`));
};

test('changing the compilers unit changes the libs key, and changing a framework pin changes only libs', () => {
    const root = scratch();
    const before = keys(root);
    touch(root, 'patches/clangd-browser.patch');
    const compilers = keys(root);
    assert.deepEqual(changed(before, compilers), ['compilers', 'libs'], 'the compilers and the libraries built with them');
    setPin(root, 'toolchains/libs/pins.sh', 'GTEST_VERSION', '1.19.0');
    assert.deepEqual(changed(compilers, keys(root)), ['libs'], 'a framework pin is the libraries\' alone');
});

test('a change to the compilers re-keys libs but not vm', () => {
    const root = scratch();
    const before = keys(root);
    setPin(root, 'toolchains/compilers/pins.sh', 'LLVM_VERSION', '21.1.9');
    const after1 = keys(root);
    assert.deepEqual(changed(before, after1), ['compilers', 'libs']);
    touch(root, 'build-cross.sh');
    const after2 = keys(root);
    assert.deepEqual(changed(after1, after2), ['compilers', 'libs'], 'a compiler script, likewise');
    touch(root, 'llvm-lib.sh');
    assert.deepEqual(changed(after2, keys(root)), ['compilers', 'libs'], 'what the compilers\' scripts share, likewise');
});

test('the one Emscripten re-keys everything compiled with it, and musl everything that links it', () => {
    const root = scratch();
    const before = keys(root);
    setPin(root, 'toolchains/emsdk/pins.sh', 'EMSDK_RELEASE', '1'.repeat(40));
    const emsdk = keys(root);
    assert.deepEqual(changed(before, emsdk), ['compilers', 'emsdk', 'libs', 'vm']);
    setPin(root, 'toolchains/musl/pins.sh', 'MUSL_SHA256', '2'.repeat(64));
    assert.deepEqual(changed(emsdk, keys(root)), ['libs', 'musl', 'vm'], 'the compilers link no musl');
});

test('a change to the VM, a library, a worker, a test or a document re-keys only its own unit, or none', () => {
    const root = scratch();
    let last = keys(root);
    for (const [file, units] of [
        ['vm/kconfig/common.config', ['vm']],
        ['vm/build-qemu.sh', ['vm']],
        ['toolchains/vm/pins.sh', ['vm']],
        ['build-sanitizers.sh', ['libs']],
        ['libs-lib.sh', ['libs']],
        ['src/sanitizer-rt/wasi_heap.c', ['libs']],
        ['src/toolchain.js', ['libs']],
        ['src/runner.js', []],
        ['src/server.js', []],
        ['src/vm/run-linux.js', []],
        ['glue.sh', []],
        ['glue-lib.sh', []],
        ['build.sh', []],
        ['test-run.mjs', []],
        ['README.md', []],
        ['vm/README.md', []],
    ]) {
        touch(root, file, file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.c') ? '// edited\n' : '# edited\n');
        const next = keys(root);
        assert.deepEqual(changed(last, next), units.sort(), `${file} re-keys ${units.join(', ') || 'nothing'}`);
        last = next;
    }
    touch(root, 'build-lib.sh');
    assert.deepEqual(changed(last, keys(root)), [...UNITS].sort(), 'what every unit\'s scripts share re-keys them all');
});

/** The files of unit `unit`'s inputs in this checkout, pack-relative, from its specs (toolchain_specs). */
function inputsOf(unit) {
    const specs = keySh(path.resolve(LIGHT, '..'), 'toolchain_specs "$1"', `cpp/${unit}`).trim().split('\n');
    return execFileSync('git', ['-C', path.resolve(LIGHT, '..'), 'ls-files', '-co', '--exclude-standard', '-z', '--', ...specs], { encoding: 'utf8' })
        .split('\0').filter(Boolean).map((f) => path.relative('light/packs/cpp', f));
}

/** The units a unit's `needs` file names, without the pack. */
const needsOf = (unit) => fs.readFileSync(path.join(HERE, 'toolchains', unit, 'needs'), 'utf8').split('\n')
    .filter((l) => l && !l.startsWith('#')).map((l) => l.replace(/^cpp\//, ''));
const needsOrNone = (unit) => (fs.existsSync(path.join(HERE, 'toolchains', unit, 'needs')) ? needsOf(unit) : []);

/**
 * The units shell script `text` reaches: each `need_unit <unit>`, `emsdk_use`
 * (emsdk), `apk_of` (musl) and `$DEP_<UNIT>` outside comments.
 */
function reaches(text) {
    const found = new Set();
    for (const raw of text.split('\n')) {
        const line = raw.replace(/(^|\s)#.*$/, '$1');
        for (const m of line.matchAll(/\bneed_unit\s+([a-z][a-z0-9-]*)/g)) found.add(/** @type {string} */ (m[1]));
        if (/\bemsdk_use\b/.test(line)) found.add('emsdk');
        if (/\bapk_of\b/.test(line)) found.add('musl');
        for (const m of line.matchAll(/\$\{?DEP_([A-Z][A-Z0-9_]*)/g)) found.add(/** @type {string} */ (m[1]).toLowerCase().replace(/_/g, '-'));
    }
    return found;
}

test('a unit cannot see a dependency it did not declare: its scripts reach only the units its needs file names', () => {
    // build-lib.sh defines need_unit, emsdk_use and apk_of; it is every
    // unit's, and reaches a unit only when one of its callers asks.
    const definers = new Set(['build-lib.sh']);
    for (const unit of UNITS) {
        const allowed = new Set(needsOrNone(unit));
        for (const file of inputsOf(unit).filter((f) => f.endsWith('.sh') && !definers.has(f))) {
            for (const dep of reaches(fs.readFileSync(path.join(HERE, file), 'utf8')))
                assert.ok(allowed.has(dep), `${file}, an input of cpp/${unit}, reaches cpp/${dep}, which toolchains/${unit}/needs does not name`);
        }
    }
    assert.deepEqual([...reaches('need_unit musl; emsdk_use # apk_of\n"$DEP_COMPILERS/x"')].sort(), ['compilers', 'emsdk', 'musl'], 'the scan sees what it looks for');
});

test('the compilers need only the Emscripten, and the VM neither the compilers nor the libraries', () => {
    assert.deepEqual(needsOrNone('emsdk'), []);
    assert.deepEqual(needsOrNone('musl'), []);
    assert.deepEqual(needsOf('compilers'), ['emsdk']);
    assert.deepEqual(needsOf('libs').sort(), ['compilers', 'emsdk', 'musl']);
    assert.deepEqual(needsOf('vm').sort(), ['emsdk', 'musl']);
});
