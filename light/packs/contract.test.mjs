// The contract every split pack (one with toolchains/) keeps, checked on
// every split pack in this tree, the stub included, and on fixtures that
// break it, so a check that passed on nothing would fail here first.
//
//   node --test packs/contract.test.mjs   (from light/; needs git and bash)
//
// * Every file of a split pack has an owner: a unit's directory
//   (toolchains/<unit>/), a unit's `paths`, or the pack's glue.paths. A
//   unit's inputs are only what it names (toolchain-key.sh,
//   toolchain_specs), so an unowned file would be read by nobody's key; it
//   is a named error here instead of every unit rebuilding, which is what
//   the old exclusion rule cost (D1, RR3-3). A file two units name is a
//   shared library, allowed, and listed.
// * A split pack's glue.sh never runs a compiler (cargo, swift, sbt, gradle,
//   emcc, em++, clang or ghc): what needs one is a unit, so assembly takes
//   seconds and needs no toolchain installed (RR5).
// * Every split pack has a test.sh, which light-packs.yml's assemble job
//   runs over the pack it assembled (`test.sh --setup` first, and
//   `test.sh --inputs` among the job's once inputs), so a split pack never
//   ships tested only by its glue's versions check.
// * Every unit has a toolchain.sh, an outputs file and a pins.sh of plain
//   `NAME=value` lines a reader can trust without running them, and the
//   pack's glue.sh and build.sh assign no pin (the pin rule,
//   pack-toolchain.sh's header).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The tools whose run makes a script a build, not glue: each needs a
 * toolchain installed and takes minutes to hours.
 */
export const COMPILERS = ['cargo', 'swift', 'sbt', 'gradle', 'emcc', 'em++', 'clang', 'clang++', 'ghc'];

const LEAD = String.raw`(?:^|[;&|({\x60]|\$\(|\b(?:then|do|else|exec|xargs|env|time|command|nice)\b)`;
const TOOL = COMPILERS.map((c) => c.replace(/\+/g, '\\+')).join('|');
const CALL = new RegExp(String.raw`${LEAD}\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*["']?(?:[^\s"';|&()]*/)?(${TOOL})["']?(?=\s|$|[;|&)])`, 'g');

/**
 * The compilers shell script `text` runs, as [line number, tool] pairs, in
 * order: a tool's name in command position (at the start of a command,
 * after `;`, `&&`, `|`, `$(`, `then`, `exec`, `xargs` and the like, after
 * leading NAME=value assignments, with or without a directory before it).
 * Comments are ignored, and so is a tool's name anywhere else (a path such
 * as packs/swift, an echo of the word). A script that calls a compiler
 * through a variable is not seen; this is a guard against the plain case,
 * not a proof.
 * @param {string} text
 * @returns {Array<[number, string]>}
 */
export function compilerCalls(text) {
    /** @type {Array<[number, string]>} */
    const found = [];
    text.split('\n').forEach((raw, i) => {
        const line = raw.replace(/(^|\s)#.*$/, '$1');
        for (const m of line.matchAll(CALL)) found.push([i + 1, /** @type {string} */ (m[1])]);
    });
    return found;
}

const PIN = /^[A-Z][A-Z0-9_]*=[^$`(]*$/;

/**
 * The lines of pins.sh text `text` that are neither blank, a comment, nor a
 * plain assignment `NAME=value` with no `$`, backquote or `(` in the value,
 * as [line number, line] pairs. Such a line would need running to be read.
 * @param {string} text
 * @returns {Array<[number, string]>}
 */
export function pinProblems(text) {
    /** @type {Array<[number, string]>} */
    const bad = [];
    text.split('\n').forEach((line, i) => {
        if (line === '' || line.startsWith('#') || PIN.test(line)) return;
        bad.push([i + 1, line]);
    });
    return bad;
}

/**
 * The pins script `text` assigns, as [line number, name] pairs: an
 * assignment of a *_VERSION, *_SHA256, *_RUN or *_COMMIT variable outside
 * a comment. A pin belongs in a unit's pins.sh; one in glue.sh or build.sh
 * would be read by no key, or by the whole pack's.
 * @param {string} text
 * @returns {Array<[number, string]>}
 */
export function pinAssignments(text) {
    /** @type {Array<[number, string]>} */
    const found = [];
    text.split('\n').forEach((raw, i) => {
        const line = raw.replace(/(^|\s)#.*$/, '$1');
        for (const m of line.matchAll(/(?:^|[\s;])(?:export\s+|local\s+|readonly\s+)?([A-Z][A-Z0-9_]*_(?:VERSION|SHA256|RUN|COMMIT))=/g)) found.push([i + 1, /** @type {string} */ (m[1])]);
    });
    return found;
}

/**
 * Who owns each file of a split pack.
 * @typedef {{ units: Map<string, Set<string>>, glue: Set<string> }} Owners
 */

/**
 * The files of `files` (paths from the repository root) that no owner in
 * `owners` holds, sorted, and the files more than one unit holds, each with
 * its units. Glue and a unit may both hold a file: that is a unit's input
 * that the glue also reads, and it costs a rebuild when it changes, which
 * the key report names.
 * @param {string[]} files
 * @param {Owners} owners
 * @returns {{ unowned: string[], shared: Array<[string, string[]]> }}
 */
export function partition(files, owners) {
    const unowned = [];
    /** @type {Array<[string, string[]]>} */
    const shared = [];
    for (const f of [...files].sort()) {
        const units = [...owners.units].filter(([, set]) => set.has(f)).map(([u]) => u);
        if (units.length === 0 && !owners.glue.has(f)) unowned.push(f);
        if (units.length > 1) shared.push([f, units]);
    }
    return { unowned, shared };
}

const sh = (/** @type {string} */ root, /** @type {string} */ script, /** @type {string[]} */ args) =>
    execFileSync('bash', ['-c', script, 'bash', ...args], { cwd: root, encoding: 'utf8' });

/** The files of git pathspecs `specs` in the repository at `root`, tracked and untracked but not ignored. */
function filesOf(/** @type {string} */ root, /** @type {string[]} */ specs) {
    if (specs.length === 0) return [];
    return execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z', '--', ...specs], { encoding: 'utf8' }).split('\0').filter(Boolean);
}

/**
 * The owners of the files of split pack `pack` in the repository at `root`:
 * each unit's inputs exactly as toolchain_specs (light/scripts/
 * toolchain-key.sh) names them, so this test and the key cannot disagree,
 * plus its paths, env, needs and outputs files, which are its own though no
 * input; and the files the pack's glue.paths names (pack-relative
 * pathspecs, `#` comments and blank lines ignored), glue.paths itself
 * included. A glue.paths line that matches nothing is an error.
 * @returns {Owners}
 */
export function ownersOf(/** @type {string} */ root, /** @type {string} */ pack) {
    const key = path.join(root, 'light/scripts/toolchain-key.sh');
    const units = sh(root, 'set -euo pipefail; source "$1"; toolchain_units "$2"', [key, pack]).split('\n').filter(Boolean);
    /** @type {Map<string, Set<string>>} */
    const byUnit = new Map();
    for (const unit of units) {
        const specs = sh(root, 'set -euo pipefail; source "$1"; toolchain_specs "$2"', [key, unit]).split('\n').filter(Boolean);
        const own = path.posix.join('light/packs', pack, 'toolchains', unit.slice(pack.length + 1));
        byUnit.set(unit, new Set([...filesOf(root, specs), ...filesOf(root, [own])]));
    }
    const dir = path.posix.join('light/packs', pack);
    const gluePaths = path.join(root, dir, 'glue.paths');
    assert.ok(fs.existsSync(gluePaths), `${dir}/glue.paths is missing: a split pack names its glue files`);
    const glue = new Set([`${dir}/glue.paths`]);
    fs.readFileSync(gluePaths, 'utf8')
        .split('\n')
        .forEach((raw, i) => {
            const line = raw.trim();
            if (line === '' || line.startsWith('#')) return;
            assert.ok(!line.startsWith(':') && !line.startsWith('/') && !`/${line}/`.includes('/../'), `${dir}/glue.paths:${i + 1}: '${line}' is not a path inside the pack`);
            const found = filesOf(root, [`${dir}/${line}`]);
            assert.ok(found.length > 0, `${dir}/glue.paths:${i + 1}: '${line}' matches no file`);
            for (const f of found) glue.add(f);
        });
    return { units: byUnit, glue };
}

/** Every problem split pack `pack` at `root` has with the contract, one line each. */
export function problemsOf(/** @type {string} */ root, /** @type {string} */ pack) {
    const dir = path.posix.join('light/packs', pack);
    const problems = [];
    const owners = ownersOf(root, pack);
    const { unowned } = partition(filesOf(root, [dir]), owners);
    for (const f of unowned) problems.push(`${f} is owned by no unit's directory or paths and by no glue.paths line: name it where it belongs`);
    for (const unit of owners.units.keys()) {
        const own = path.join(root, 'light/packs', pack, 'toolchains', unit.slice(pack.length + 1));
        for (const need of ['toolchain.sh', 'outputs', 'pins.sh']) {
            if (!fs.existsSync(path.join(own, need))) problems.push(`${unit} has no ${need}`);
        }
        const pins = path.join(own, 'pins.sh');
        if (fs.existsSync(pins)) {
            for (const [n, line] of pinProblems(fs.readFileSync(pins, 'utf8'))) problems.push(`${dir}/toolchains/${unit.slice(pack.length + 1)}/pins.sh:${n}: '${line}' is not a plain NAME=value pin`);
        }
    }
    // A unit's build installs its own toolchains/<unit>/deps.apt, an input
    // of its key. A pack-level one would reach every unit's build while
    // being in no unit's key (or, named by glue.paths, in none at all), so
    // editing it would change what every unit builds with and re-key none.
    if (fs.existsSync(path.join(root, dir, 'deps.apt'))) {
        problems.push(`${dir}/deps.apt: a split pack's system packages are each unit's toolchains/<unit>/deps.apt, in that unit's key; a pack-level one would reach every unit's build and re-key none`);
    }
    const glue = path.join(root, dir, 'glue.sh');
    // The compiler scan hangs on glue.sh alone: chained to any other check
    // (it once followed test.sh's), it would skip a pack's emcc whenever that
    // other check failed, and read a glue.sh that is not there.
    if (!fs.existsSync(glue)) problems.push(`${dir} has no glue.sh`);
    else for (const [n, tool] of compilerCalls(fs.readFileSync(glue, 'utf8'))) problems.push(`${dir}/glue.sh:${n}: runs ${tool}; a split pack's glue never compiles, a unit does`);
    // light-packs.yml's assemble job runs every split pack's test.sh over
    // the pack it assembled, in a release too; without one the pack would
    // ship as only assembled, which is how split packs once shipped untested.
    const tests = path.join(root, dir, 'test.sh');
    if (!fs.existsSync(tests)) problems.push(`${dir} has no test.sh: a split pack's tests run over the pack as assembled, so the bytes tested are the bytes shipped`);
    else if ((fs.statSync(tests).mode & 0o111) === 0) problems.push(`${dir}/test.sh is not executable`);
    for (const name of ['glue.sh', 'build.sh']) {
        const file = path.join(root, dir, name);
        if (!fs.existsSync(file)) continue;
        for (const [n, pin] of pinAssignments(fs.readFileSync(file, 'utf8'))) problems.push(`${dir}/${name}:${n}: assigns the pin ${pin}; pins live in a unit's pins.sh`);
    }
    return problems;
}

/** The split packs of the repository at `root`: those with a toolchains/ directory. */
export function splitPacks(/** @type {string} */ root) {
    const packs = path.join(root, 'light/packs');
    return fs
        .readdirSync(packs, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(packs, e.name, 'toolchains')))
        .map((e) => e.name)
        .sort();
}

test('every split pack in this tree keeps the contract, the stub among them', (t) => {
    const packs = splitPacks(ROOT);
    assert.ok(packs.includes('stub'), packs.join(' '));
    for (const pack of packs) {
        assert.deepEqual(problemsOf(ROOT, pack), [], pack);
        for (const [file, units] of partition(filesOf(ROOT, [`light/packs/${pack}`]), ownersOf(ROOT, pack)).shared) {
            t.diagnostic(`${file} is an input of ${units.join(' and ')}`);
        }
    }
});

test("the stub's shared library is an input of both units that name it, and of no other", () => {
    const owners = ownersOf(ROOT, 'stub');
    const { shared } = partition(filesOf(ROOT, ['light/packs/stub']), owners);
    assert.deepEqual(shared, [['light/packs/stub/lib.sh', ['stub/compilers', 'stub/vm']]]);
    assert.equal(owners.units.get('stub/libs')?.has('light/packs/stub/lib.sh'), false);
});

/** A scratch repository holding a copy of the stub pack and the key's scripts, for the negatives below. */
function scratch() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-test-'));
    fs.mkdirSync(path.join(dir, 'light/scripts'), { recursive: true });
    for (const name of ['toolchain-key.sh', 'toolchain-build-env.sh']) fs.copyFileSync(path.join(ROOT, 'light/scripts', name), path.join(dir, 'light/scripts', name));
    fs.cpSync(path.join(ROOT, 'light/packs/stub'), path.join(dir, 'light/packs/stub'), { recursive: true });
    execFileSync('git', ['-C', dir, 'init', '-q']);
    return dir;
}

test('a file no unit and no glue.paths line names is a named error, not an input nobody keys', () => {
    const dir = scratch();
    try {
        assert.deepEqual(problemsOf(dir, 'stub'), []);
        fs.writeFileSync(path.join(dir, 'light/packs/stub/build-extra.sh'), 'echo forgotten\n');
        fs.mkdirSync(path.join(dir, 'light/packs/stub/patches'));
        fs.writeFileSync(path.join(dir, 'light/packs/stub/patches/fix.patch'), '--- a\n+++ b\n');
        assert.deepEqual(problemsOf(dir, 'stub'), [
            'light/packs/stub/build-extra.sh is owned by no unit\'s directory or paths and by no glue.paths line: name it where it belongs',
            'light/packs/stub/patches/fix.patch is owned by no unit\'s directory or paths and by no glue.paths line: name it where it belongs',
        ]);
        // Named in a unit's paths, it is that unit's input and owned.
        fs.appendFileSync(path.join(dir, 'light/packs/stub/toolchains/vm/paths'), 'patches/\nbuild-extra.sh\n');
        assert.deepEqual(problemsOf(dir, 'stub'), []);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("a split pack without its tests is named, and they are glue, which no unit's key reads", () => {
    const dir = scratch();
    try {
        const tests = path.join(dir, 'light/packs/stub/test.sh');
        assert.ok(ownersOf(dir, 'stub').glue.has('light/packs/stub/test.sh'), 'glue.paths names test.sh');
        for (const [unit, files] of ownersOf(dir, 'stub').units) assert.equal(files.has('light/packs/stub/test.sh'), false, unit);
        fs.chmodSync(tests, 0o644);
        assert.deepEqual(problemsOf(dir, 'stub'), ['light/packs/stub/test.sh is not executable']);
        // Gone, and gone from glue.paths (where a line that matches nothing
        // is an error of its own).
        fs.rmSync(tests);
        const gluePaths = path.join(dir, 'light/packs/stub/glue.paths');
        fs.writeFileSync(gluePaths, fs.readFileSync(gluePaths, 'utf8').replace(/^test\.sh\n/m, ''));
        assert.deepEqual(problemsOf(dir, 'stub'), ["light/packs/stub has no test.sh: a split pack's tests run over the pack as assembled, so the bytes tested are the bytes shipped"]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("a split pack's glue that compiles is named even when its tests are missing, and a missing glue is named, not a crash", () => {
    const dir = scratch();
    try {
        const pack = path.join(dir, 'light/packs/stub');
        const gluePaths = path.join(pack, 'glue.paths');
        const drop = (/** @type {string} */ name) => fs.writeFileSync(gluePaths, fs.readFileSync(gluePaths, 'utf8').replace(new RegExp(`^${name.replace('.', '\\.')}\n`, 'm'), ''));
        const glue = path.join(pack, 'glue.sh');
        const n = fs.readFileSync(glue, 'utf8').split('\n').length;
        fs.appendFileSync(glue, 'emcc -O2 x.c -o "$OUT/x.js"\n');
        fs.rmSync(path.join(pack, 'test.sh'));
        drop('test.sh');
        assert.deepEqual(problemsOf(dir, 'stub'), [
            `light/packs/stub/glue.sh:${n}: runs emcc; a split pack's glue never compiles, a unit does`,
            "light/packs/stub has no test.sh: a split pack's tests run over the pack as assembled, so the bytes tested are the bytes shipped",
        ]);
        // Not executable is the same: the glue is still read.
        fs.writeFileSync(path.join(pack, 'test.sh'), '#!/bin/sh\n');
        fs.appendFileSync(gluePaths, 'test.sh\n');
        assert.deepEqual(problemsOf(dir, 'stub'), [
            `light/packs/stub/glue.sh:${n}: runs emcc; a split pack's glue never compiles, a unit does`,
            'light/packs/stub/test.sh is not executable',
        ]);
        // No glue at all, with tests present: one named problem.
        fs.chmodSync(path.join(pack, 'test.sh'), 0o755);
        fs.rmSync(glue);
        drop('glue.sh');
        assert.deepEqual(problemsOf(dir, 'stub'), ['light/packs/stub has no glue.sh']);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("a split pack's system packages are its units' own, so an edit to them re-keys the units they reach", () => {
    const dir = scratch();
    try {
        const own = 'light/packs/stub/toolchains/libs/deps.apt';
        fs.writeFileSync(path.join(dir, own), 'libzstd-dev\n');
        assert.deepEqual(problemsOf(dir, 'stub'), []);
        assert.ok(ownersOf(dir, 'stub').units.get('stub/libs')?.has(own), 'the unit owns its deps.apt');
        const keyOf = (/** @type {string} */ unit) => sh(dir, 'set -euo pipefail; source "$1"; toolchain_key "$2"', [path.join(dir, 'light/scripts/toolchain-key.sh'), unit]).trim();
        const before = keyOf('stub/libs');
        fs.writeFileSync(path.join(dir, own), 'libzstd-dev\nlibssl-dev\n');
        assert.notEqual(keyOf('stub/libs'), before, "editing a unit's deps.apt re-keys it");

        // A pack-level one is refused, even when glue.paths names it.
        fs.writeFileSync(path.join(dir, 'light/packs/stub/deps.apt'), 'cmake\n');
        fs.appendFileSync(path.join(dir, 'light/packs/stub/glue.paths'), 'deps.apt\n');
        assert.deepEqual(problemsOf(dir, 'stub'), [
            "light/packs/stub/deps.apt: a split pack's system packages are each unit's toolchains/<unit>/deps.apt, in that unit's key; a pack-level one would reach every unit's build and re-key none",
        ]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("a split pack's glue that runs a compiler, or a unit without its pins, is named", () => {
    const dir = scratch();
    try {
        const glue = path.join(dir, 'light/packs/stub/glue.sh');
        const n = fs.readFileSync(glue, 'utf8').split('\n').length;
        fs.appendFileSync(glue, 'emcc -O2 x.c -o "$OUT/x.js"\nCLANG_VERSION=18 # a pin in the glue\n');
        fs.rmSync(path.join(dir, 'light/packs/stub/toolchains/vm/pins.sh'));
        fs.appendFileSync(path.join(dir, 'light/packs/stub/toolchains/libs/pins.sh'), 'FRAMEWORK_SHA256=$(curl -s x)\n');
        assert.deepEqual(problemsOf(dir, 'stub'), [
            "light/packs/stub/toolchains/libs/pins.sh:4: 'FRAMEWORK_SHA256=$(curl -s x)' is not a plain NAME=value pin",
            'stub/vm has no pins.sh',
            `light/packs/stub/glue.sh:${n}: runs emcc; a split pack's glue never compiles, a unit does`,
            `light/packs/stub/glue.sh:${n + 1}: assigns the pin CLANG_VERSION; pins live in a unit's pins.sh`,
        ]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a compiler is seen where a script runs it, and nowhere else', () => {
    assert.deepEqual(
        compilerCalls(
            [
                'cargo build --release',
                'cd x && emcc a.c',
                'out="$(clang --version)"',
                'CC=x /opt/wasi-sdk/bin/clang++ -c a.c',
                'find . -name "*.hs" | xargs ghc',
                'if true; then swift build; fi',
                '"$SBT/sbt" compile',
                'exec gradle build # and a comment naming emcc',
                'em++ -o out.js a.cc',
            ].join('\n'),
        ),
        [
            [1, 'cargo'],
            [2, 'emcc'],
            [3, 'clang'],
            [4, 'clang++'],
            [5, 'ghc'],
            [6, 'swift'],
            [7, 'sbt'],
            [8, 'gradle'],
            [9, 'em++'],
        ],
    );
    assert.deepEqual(
        compilerCalls(['# emcc is run by the unit, not here', 'cp ../swift/server.js "$OUT"', 'echo "built with clang"', 'cat versions-clangd.json', 'swiftlint=1'].join('\n')),
        [],
    );
});

test('a pin is a plain assignment, and a build or glue script assigns none', () => {
    assert.deepEqual(pinProblems('# pins\n\nLLVM_VERSION=19.1.0\nGTEST_SHA256=abc123\n'), []);
    assert.deepEqual(pinProblems('X=$(date)\nexport Y=1\nlower=1\nZ=`id`\n'), [
        [1, 'X=$(date)'],
        [2, 'export Y=1'],
        [3, 'lower=1'],
        [4, 'Z=`id`'],
    ]);
    assert.deepEqual(pinAssignments('LLVM_VERSION=1\n  export GTEST_SHA256=x\n# OLD_VERSION=2\necho "$LLVM_VERSION"\nROOTFS_RUN=3; NAME=x\n'), [
        [1, 'LLVM_VERSION'],
        [2, 'GTEST_SHA256'],
        [5, 'ROOTFS_RUN'],
    ]);
});

test('a file two units name is listed as shared, and one only glue names is owned', () => {
    const owners = { units: new Map([['p/a', new Set(['x', 'lib'])], ['p/b', new Set(['y', 'lib'])]]), glue: new Set(['g']) };
    assert.deepEqual(partition(['g', 'lib', 'x', 'y', 'z'], owners), { unowned: ['z'], shared: [['lib', ['p/a', 'p/b']]] });
});
