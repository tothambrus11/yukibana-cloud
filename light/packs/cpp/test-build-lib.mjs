// Tests of what decides whether the C/C++ pack's build reuses a cached tree
// or a skipped step (build-lib.sh's keep_tree, follow_patch,
// llvm_lld_sources, npm_deps, emsdk_install, the stamps' input lists, and
// vm/build-qemu-user.sh's stamp), and of where the pack's pins live, with
// throwaway directories and fakes in place of LLVM, npm, emsdk and QEMU: no
// compiler is built, so it takes a second.
//
//   node --test test-build-lib.mjs   (from light/packs/cpp; needs bash, git, tar, xz, patch)
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-build-lib-test-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
let n = 0;
/** A fresh directory under the test's root. */
const fresh = () => {
    const dir = path.join(root, `t${n++}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
};

/**
 * Runs `script` in bash with `lib` (default: this pack's build-lib.sh, after
 * pins.sh) sourced, from `cwd`, with CACHE set; returns status, stdout and
 * stderr. Nothing of the caller's environment but PATH and HOME reaches it.
 */
function bash(script, { cwd = root, lib = HERE, env = {} } = {}) {
    const r = spawnSync('bash', ['-c', `set -euo pipefail; source "${lib}/pins.sh"; source "${lib}/build-lib.sh"; ${script}`], {
        cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, CACHE: cwd, ...env },
    });
    return { status: r.status, out: r.stdout, err: r.stderr };
}
const ok = (script, opts) => {
    const r = bash(script, opts);
    assert.equal(r.status, 0, r.err);
    return r;
};
const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
};
/** Sets a file's times to `seconds` after the epoch. */
const age = (file, seconds) => fs.utimesSync(file, seconds, seconds);
const mtime = (file) => fs.statSync(file).mtimeMs / 1000;

/** A unified diff that changes `files` (paths under a/ and b/). */
const diff = (...files) => files.map((f) => `--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n-old\n+new\n`).join('');

test('a build tree made by another LLVM or Emscripten is built again from empty, and one made by the same is kept', () => {
    const dir = fresh();
    ok(`keep_tree tree "$(llvm_made_by)"; touch tree/object.o`, { cwd: dir });
    ok(`keep_tree tree "$(llvm_made_by)"`, { cwd: dir });
    assert.ok(fs.existsSync(path.join(dir, 'tree/object.o')), 'the same makers keep the tree');
    const r = ok(`EMSDK_COMMIT=0000000000000000000000000000000000000000; keep_tree tree "$(llvm_made_by)"`, { cwd: dir });
    assert.ok(!fs.existsSync(path.join(dir, 'tree/object.o')), 'another emsdk starts the tree again');
    assert.match(r.err, /tree was made by something else/);
    assert.match(r.err, /emsdk \d+\.\d+\.\d+ 0{40} [0-9a-f]{40} [0-9a-f]{64}/, 'the message names what differs');
    assert.match(fs.readFileSync(path.join(dir, 'tree/.yk-made-by'), 'utf8'), /^yukibana-tree\/1\nllvm \d+\.\d+\.\d+ [0-9a-f]{64}\nemsdk \d+\.\d+\.\d+ 0{40} [0-9a-f]{40} [0-9a-f]{64}\n$/);
    const r2 = ok(`EMSDK_RELEASE=${'1'.repeat(40)}; keep_tree tree "$(llvm_made_by)"`, { cwd: dir });
    assert.match(r2.err, /tree was made by something else/, 'another toolchain release under the same emsdk commit starts it again too');
});

test('a build tree that does not say what made it is not reused', () => {
    const dir = fresh();
    write(path.join(dir, 'build-wasm/bin/clangd.js'), 'from some earlier run');
    const r = ok(`keep_tree build-wasm "$(llvm_made_by)"`, { cwd: dir });
    assert.deepEqual(fs.readdirSync(path.join(dir, 'build-wasm')), ['.yk-made-by']);
    assert.match(r.err, /does not say what made it/);
});

test("the pack's patches name the files they change, with or without timestamps", () => {
    const files = (patch) => ok(`patch_files "${HERE}/patches/${patch}"`).out.trim().split('\n');
    assert.deepEqual(files('wasm-ld-only.patch'), ['lld/tools/lld/CMakeLists.txt', 'lld/tools/lld/lld.cpp']);
    assert.deepEqual(files('elf-ld-only.patch'), ['lld/tools/lld/CMakeLists.txt', 'lld/tools/lld/lld.cpp']);
    assert.ok(files('clangd-browser.patch').every((f) => f.startsWith('clang-tools-extra/clangd/')));
});

test('when a patch changes, ninja sees every file the old or the new version touched as changed, and no other file', () => {
    const dir = fresh();
    for (const f of ['src/a.cpp', 'src/b.cpp', 'src/c.cpp']) {
        write(path.join(dir, f), 'release text\n');
        age(path.join(dir, f), 1000);
    }
    write(path.join(dir, 'p1.patch'), diff('a.cpp'));
    write(path.join(dir, 'p2.patch'), diff('b.cpp'));
    ok(`keep_tree tree "x"; cp p1.patch the.patch; follow_patch tree the.patch src; touch tree/build.ninja`, { cwd: dir });
    assert.equal(mtime(path.join(dir, 'src/a.cpp')), 1000, 'a fresh tree compiles everything anyway: nothing is touched');
    // The source is extracted again with the release's times (a.cpp is back
    // to its release text) and the new patch touches only b.cpp.
    ok(`cp p2.patch the.patch; follow_patch tree the.patch src`, { cwd: dir });
    const now = Date.now() / 1000 - 60;
    assert.ok(mtime(path.join(dir, 'src/a.cpp')) > now, 'a file only the old patch changed is recompiled');
    assert.ok(mtime(path.join(dir, 'src/b.cpp')) > now, 'a file the new patch changes is recompiled');
    assert.equal(mtime(path.join(dir, 'src/c.cpp')), 1000, 'no other file is');
    assert.equal(fs.readFileSync(path.join(dir, 'tree/.yk-patches/the.patch'), 'utf8'), diff('b.cpp'));
    assert.ok(fs.existsSync(path.join(dir, 'tree/build.ninja')), 'the tree itself is kept');
});

test('a build tree that does not say which version of a patch it was built with is built again', () => {
    const dir = fresh();
    write(path.join(dir, 'the.patch'), diff('a.cpp'));
    ok(`keep_tree tree "x"; touch tree/build.ninja`, { cwd: dir });
    const r = ok(`follow_patch tree the.patch src`, { cwd: dir });
    assert.deepEqual(fs.readdirSync(path.join(dir, 'tree')).sort(), ['.yk-made-by', '.yk-patches']);
    assert.match(r.err, /does not say which the\.patch it was built with/);
    ok(`keep_tree tree "x"`, { cwd: dir });
    assert.ok(fs.existsSync(path.join(dir, 'tree/.yk-patches/the.patch')), 'what made it is still the record');
});

test('a tree that follows two patches is built again once when it learns of the second, and kept on the next run', () => {
    const dir = fresh();
    write(path.join(dir, 'p1.patch'), diff('a.cpp'));
    write(path.join(dir, 'p2.patch'), diff('b.cpp'));
    ok(`keep_tree tree "x"; follow_patch tree p1.patch src; touch tree/build.ninja`, { cwd: dir });
    // Another script now points a second patch at the same tree (cross on
    // cc's tree, or a follow_patch line added later): one rebuild.
    const first = ok(`keep_tree tree "x"; follow_patch tree p1.patch src; follow_patch tree p2.patch src`, { cwd: dir });
    assert.match(first.err, /does not say which p2\.patch it was built with/);
    assert.ok(!fs.existsSync(path.join(dir, 'tree/build.ninja')), 'the tree is started again');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'tree/.yk-patches')).sort(), ['p1.patch', 'p2.patch'], 'both copies are kept');
    ok(`touch tree/build.ninja`, { cwd: dir });
    const next = ok(`keep_tree tree "x"; follow_patch tree p1.patch src; follow_patch tree p2.patch src`, { cwd: dir });
    assert.equal(next.err, '', 'nothing is said about an unchanged tree');
    assert.ok(fs.existsSync(path.join(dir, 'tree/build.ninja')), 'the next unchanged run keeps the build');
});

test('the wasm-only lld is extracted again when its patch changes, not kept because it was once patched', () => {
    // A pack of its own: build-lib.sh's patches are found beside it.
    const pack = fresh();
    fs.copyFileSync(path.join(HERE, 'build-lib.sh'), path.join(pack, 'build-lib.sh'));
    fs.copyFileSync(path.join(HERE, 'pins.sh'), path.join(pack, 'pins.sh'));
    const cache = fresh();
    const top = 'llvm-project-21.1.8.src';
    write(path.join(cache, 'x', top, 'lld/tools/lld/lld.cpp'), 'old\n');
    execFileSync('tar', ['cJf', path.join(cache, `${top}.tar.xz`), '-C', path.join(cache, 'x'), top]);
    const lld = path.join(cache, top, 'lld/tools/lld/lld.cpp');
    write(path.join(pack, 'patches/wasm-ld-only.patch'), `--- a/lld/tools/lld/lld.cpp\n+++ b/lld/tools/lld/lld.cpp\n@@ -1 +1 @@\n-old\n+wasm only\n`);
    ok('llvm_lld_sources', { cwd: cache, lib: pack });
    assert.equal(fs.readFileSync(lld, 'utf8'), 'wasm only\n');
    write(path.join(pack, 'patches/wasm-ld-only.patch'), `--- a/lld/tools/lld/lld.cpp\n+++ b/lld/tools/lld/lld.cpp\n@@ -1 +1 @@\n-old\n+wasm only, version 2\n`);
    ok('llvm_lld_sources', { cwd: cache, lib: pack });
    assert.equal(fs.readFileSync(lld, 'utf8'), 'wasm only, version 2\n');
    fs.writeFileSync(lld, 'edited in the cache\n');
    ok('llvm_lld_sources', { cwd: cache, lib: pack });
    assert.equal(fs.readFileSync(lld, 'utf8'), 'edited in the cache\n', 'an unchanged patch keeps the tree');
});

test('the Linux test libraries are built again when the compiler, its glue, the sysroot or the driver that compiles them changes', () => {
    const out = fresh();
    const files = ['cc-cross.wasm', 'cc-cross.js', 'sysroot.tar.gz', 'targets/x86_64/include.tar', 'targets/aarch64/include.tar', 'targets/riscv64/include.tar'];
    for (const f of files) write(path.join(out, f), f);
    const inputs = ok(`linux_testfw_inputs "${out}"`).out.trim().split('\n');
    for (const f of ['src/toolchain.js', 'src/targets.js', 'src/targets.json', 'build-test-libs-linux.mjs', 'build-test-frameworks-linux.sh', 'pins.sh', 'build-lib.sh'])
        assert.ok(inputs.includes(path.join(HERE, f)), `${f} is an input`);
    const stamp = () => ok(`stamp_of $(linux_testfw_inputs "${out}")`).out.trim();
    const first = stamp();
    assert.equal(stamp(), first);
    for (const f of files) {
        fs.appendFileSync(path.join(out, f), ' changed');
        const next = stamp();
        assert.notEqual(next, first, `a change to ${f} changes the stamp`);
    }
});

test('a stamp is the same wherever the checkout is, and a missing input fails it by name', () => {
    const [a, b] = [fresh(), fresh()];
    for (const d of [a, b]) {
        write(path.join(d, 'one'), '1');
        write(path.join(d, 'two'), '2');
    }
    assert.equal(ok('stamp_of one two', { cwd: a }).out, ok('stamp_of one two', { cwd: b }).out);
    assert.notEqual(ok('stamp_of one two', { cwd: a }).out, ok('stamp_of two one', { cwd: a }).out);
    const r = bash('stamp=$(stamp_of one three); echo "$stamp"', { cwd: a });
    assert.notEqual(r.status, 0);
    assert.match(r.err, /three is missing/);
});

test('the sanitizer runtimes are built again when any file of their runtime sources or the targets table changes', () => {
    const inputs = ok('sanitizer_inputs').out.trim().split('\n');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(path.join(HERE, 'src/sanitizer-rt'))) assert.ok(inputs.includes(f), `${path.relative(HERE, f)} is an input`);
    for (const f of ['src/targets.json', 'patches/compiler-rt-wasi.patch', 'build-sanitizers.sh']) assert.ok(inputs.includes(path.join(HERE, f)), `${f} is an input`);
    assert.equal(ok(`stamp_of $(sanitizer_inputs)`).status, 0);
});

test("the pack's build tools are installed again when package-lock.json changes, and only then", () => {
    const dir = fresh();
    const bin = fresh();
    const log = path.join(dir, 'npm.log');
    write(path.join(bin, 'npm'), `#!/bin/sh\necho "$*" >> "${log}"\nmkdir -p node_modules\n`);
    fs.chmodSync(path.join(bin, 'npm'), 0o755);
    write(path.join(dir, 'package-lock.json'), '{"esbuild":"0.25.10"}');
    const run = () => ok(`npm_deps "${dir}"`, { env: { PATH: `${bin}:${process.env.PATH}` } });
    const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').length : 0);
    run();
    run();
    assert.equal(calls(), 1, 'an unchanged lock installs nothing');
    write(path.join(dir, 'package-lock.json'), '{"esbuild":"0.26.0"}');
    run();
    assert.equal(calls(), 2, 'a changed lock reaches node_modules');
});

test("another initial memory or other musl headers for the user-mode QEMU is another build, not the last one's", () => {
    const qc = fresh();
    write(path.join(qc, 'work/target/lib/libglib-2.0.a'), '');
    write(path.join(qc, 'work/target/.yk-made-by'), 'yukibana-tree/1\nsome dependencies\n');
    write(path.join(qc, 'work/qemu-wasm/configure'), '#!/bin/sh\n');
    execFileSync('git', ['init', '-q', path.join(qc, 'work/qemu-wasm')]);
    execFileSync('git', ['-C', path.join(qc, 'work/qemu-wasm'), 'add', '.']);
    execFileSync('git', ['-C', path.join(qc, 'work/qemu-wasm'), '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'qemu']);
    write(path.join(qc, 'hdr/x86_64/include/linux/types.h'), '/* uapi */\n');
    const musl = path.join(qc, 'musl/include');
    write(path.join(musl, 'sys/signalfd.h'), '/* musl */\n');
    const stamp = (env = {}) => {
        const r = spawnSync(path.join(HERE, 'vm/build-qemu-user.sh'), [], {
            encoding: 'utf8',
            env: { PATH: process.env.PATH, HOME: process.env.HOME, PACK_CACHE: qc, QC: qc, ART: path.join(qc, 'art'), MUSL_INCLUDE: musl, PRINT_STAMP: '1', ...env },
        });
        assert.equal(r.status, 0, r.stderr);
        return r.stdout.trim();
    };
    const first = stamp();
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(stamp({ USER_INITIAL_MEMORY_MB: '16' }), first, '16 MiB is the default');
    assert.notEqual(stamp({ USER_INITIAL_MEMORY_MB: '32' }), first);
    write(path.join(musl, 'sys/signalfd.h'), '/* another musl */\n');
    assert.notEqual(stamp(), first);
});

/** The NAME=value pins a pins file assigns, as a map from name to value. */
const pinsOf = (file) => new Map(fs.readFileSync(file, 'utf8').split('\n')
    .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

test("the pack pins one Emscripten, in pins.sh, and the VM's pins name nothing pins.sh names", () => {
    const pack = pinsOf(path.join(HERE, 'pins.sh'));
    const vm = pinsOf(path.join(HERE, 'vm/pins.sh'));
    assert.ok(pack.has('EMSDK_VERSION') && pack.has('EMSDK_COMMIT') && pack.has('EMSDK_RELEASE'), 'pins.sh pins the emsdk');
    assert.deepEqual([...vm.keys()].filter((k) => pack.has(k)), [], 'no pin is in both files');
    assert.deepEqual([...vm.keys()].filter((k) => k.startsWith('EMSDK_') || k.startsWith('MUSL_')), [], 'the VM has no Emscripten or musl of its own');
    for (const line of fs.readFileSync(path.join(HERE, 'vm/pins.sh'), 'utf8').split('\n'))
        assert.ok(line === '' || line.startsWith('#') || /^[A-Z][A-Z0-9_]*=[^$`(]*$/.test(line), `vm/pins.sh: '${line}' is a plain NAME=value pin`);
    assert.ok(!fs.existsSync(path.join(HERE, 'vm/pins.txt')), 'vm/pins.txt is gone');
});

test('nothing in the pack patches, or deletes from, the installed Emscripten', () => {
    // The pack once patched proxying.c in $PACK_CACHE/cpp/emsdk and deleted
    // the prebuilt libc-mt*.a for emcc to rebuild: a toolchain made by
    // mutating a cached tool (plan D52). A fix Emscripten lacks is a newer pin.
    const scripts = fs.readdirSync(HERE).filter((f) => f.endsWith('.sh')).map((f) => path.join(HERE, f))
        .concat(fs.readdirSync(path.join(HERE, 'vm')).filter((f) => f.endsWith('.sh')).map((f) => path.join(HERE, 'vm', f)));
    for (const file of scripts) {
        const text = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(text, /patch[^\n]*-d[^\n]*emsdk|emsdk[^\n]*\.proxying-patched|rm [^\n]*emsdk\/upstream/, `${path.relative(HERE, file)} leaves the emsdk as installed`);
    }
    for (const patch of fs.readdirSync(path.join(HERE, 'patches')))
        assert.doesNotMatch(fs.readFileSync(path.join(HERE, 'patches', patch), 'utf8'), /^\+\+\+ b\/system\/lib\//m, `patches/${patch} is not a patch to Emscripten's own tree`);
});

/**
 * A directory of fakes for emsdk_install: `git` (clone makes a checkout at
 * $FAKE_COMMIT holding a fake `emsdk`, and `-C <dir> rev-parse HEAD` reads
 * it back), `curl` (writes "archive" and logs the URL), and the fake emsdk,
 * which logs its arguments and the downloads it was handed, and installs an
 * emcc and an .emscripten. Returns the PATH and the log's path.
 */
function emsdkFakes() {
    const bin = fresh();
    const log = path.join(bin, 'log');
    write(path.join(bin, 'git'), `#!/bin/bash
if [ "$1" = -c ]; then shift 2; fi
if [ "$1" = clone ]; then
  dir=\${@: -1}; mkdir -p "$dir"; echo "$FAKE_COMMIT" > "$dir/.head"; echo "git clone $*" >> "${log}"
  cat > "$dir/emsdk" <<'EOT'
#!/bin/bash
echo "emsdk $* keep=$EMSDK_KEEP_DOWNLOADS downloads=$(ls downloads | tr '\\n' ' ')" >> "$LOG"
case $1 in
  install) mkdir -p upstream/emscripten && printf '#!/bin/sh\\n' > upstream/emscripten/emcc && chmod +x upstream/emscripten/emcc ;;
  activate) touch .emscripten ;;
esac
EOT
  chmod +x "$dir/emsdk"; exit 0
fi
if [ "$1" = -C ] && [ "$3" = rev-parse ]; then cat "$2/.head"; exit 0; fi
exit 1
`);
    write(path.join(bin, 'curl'), `#!/bin/bash\nout=; for ((i = 1; i <= $#; i++)); do [ "\${!i}" = -o ] && { j=$((i + 1)); out=\${!j}; }; done\necho "curl \${@: -1}" >> "${log}"\necho archive > "$out"\n`);
    fs.chmodSync(path.join(bin, 'git'), 0o755);
    fs.chmodSync(path.join(bin, 'curl'), 0o755);
    return { PATH: `${bin}:${process.env.PATH}`, LOG: log };
}
test("the pack's Emscripten is installed once, from the checked archives, and again only at another commit", () => {
    const cache = fresh();
    const { PATH, LOG } = emsdkFakes();
    const sha = execFileSync('sha256sum', { input: 'archive\n', encoding: 'utf8' }).split(' ')[0];
    const pins = `EMSDK_BINARIES_SHA256=${sha}; EMSDK_NODE_SHA256=${sha}; EMSDK_COMMIT=${'a'.repeat(40)};`;
    const run = (commit = 'a'.repeat(40)) => ok(`${pins} emsdk_install`, { cwd: cache, env: { PATH, LOG, FAKE_COMMIT: commit } });
    const log = () => fs.readFileSync(LOG, 'utf8').trim().split('\n');
    run();
    const first = log();
    assert.equal(first.filter((l) => l.startsWith('git clone')).length, 1);
    assert.ok(first.some((l) => /^curl https:\/\/storage\.googleapis\.com\/.*\/wasm-binaries\.tar\.xz$/.test(l)), 'the toolchain archive is fetched by the script');
    const install = first.find((l) => l.startsWith('emsdk install'));
    assert.match(install, /keep=1/, 'emsdk is told to use the downloads it was handed');
    assert.match(install, /downloads=\S+-wasm-binaries\.tar\.xz node-\S+\.tar\.xz/, 'emsdk finds both checked archives under the names it looks for');
    assert.ok(first.some((l) => l.startsWith('emsdk activate')));
    assert.ok(fs.existsSync(path.join(cache, 'emsdk/upstream/emscripten/emcc')));
    assert.ok(!fs.existsSync(path.join(cache, 'emsdk/downloads')), 'the archives are not kept beside the install');
    run();
    assert.deepEqual(log(), first, 'an installed emsdk at the pinned commit is used as it is');
    fs.writeFileSync(path.join(cache, 'emsdk/.head'), `${'b'.repeat(40)}\n`);
    run();
    assert.equal(log().filter((l) => l.startsWith('git clone')).length, 2, 'an emsdk at another commit is installed again');
    fs.rmSync(path.join(cache, 'emsdk/.emscripten'));
    run();
    assert.equal(log().filter((l) => l.startsWith('git clone')).length, 3, 'an install that was never activated is not used');
});

test('an Emscripten archive whose checksum is not the pinned one is never handed to emsdk', () => {
    const cache = fresh();
    const { PATH, LOG } = emsdkFakes();
    const sha = execFileSync('sha256sum', { input: 'archive\n', encoding: 'utf8' }).split(' ')[0];
    const r = bash(`EMSDK_BINARIES_SHA256=${sha}; EMSDK_NODE_SHA256=${'0'.repeat(64)}; EMSDK_COMMIT=${'a'.repeat(40)}; emsdk_install`,
        { cwd: cache, env: { PATH, LOG, FAKE_COMMIT: 'a'.repeat(40) } });
    assert.notEqual(r.status, 0);
    assert.match(r.err, /checksum mismatch for https:\/\/storage\.googleapis\.com\/.*node-/);
    assert.ok(!fs.readFileSync(LOG, 'utf8').includes('emsdk install'), 'emsdk never ran');
    const other = bash(`EMSDK_COMMIT=${'a'.repeat(40)}; emsdk_install`, { cwd: fresh(), env: { PATH, LOG, FAKE_COMMIT: 'c'.repeat(40) } });
    assert.notEqual(other.status, 0);
    assert.match(other.err, /emsdk \S+ is not commit a{40}/, 'a tag that moved to another commit is refused by name');
});

test("the VM's user-mode QEMU is built again for another Emscripten, and not for a pin that is not the VM's", () => {
    // A copy of the pack's files the script reads, so that its pins can change.
    const pack = fresh();
    for (const f of ['pins.sh', 'build-lib.sh', 'vm/pins.sh', 'vm/build-qemu-user.sh', ...fs.readdirSync(path.join(HERE, 'vm/patches')).map((p) => `vm/patches/${p}`)]) {
        fs.mkdirSync(path.dirname(path.join(pack, f)), { recursive: true });
        fs.copyFileSync(path.join(HERE, f), path.join(pack, f));
    }
    fs.chmodSync(path.join(pack, 'vm/build-qemu-user.sh'), 0o755);
    const qc = fresh();
    write(path.join(qc, 'work/target/lib/libglib-2.0.a'), '');
    write(path.join(qc, 'work/target/.yk-made-by'), 'yukibana-tree/1\nsome dependencies\n');
    write(path.join(qc, 'work/qemu-wasm/configure'), '#!/bin/sh\n');
    execFileSync('git', ['init', '-q', path.join(qc, 'work/qemu-wasm')]);
    execFileSync('git', ['-C', path.join(qc, 'work/qemu-wasm'), 'add', '.']);
    execFileSync('git', ['-C', path.join(qc, 'work/qemu-wasm'), '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'qemu']);
    write(path.join(qc, 'hdr/x86_64/include/linux/types.h'), '/* uapi */\n');
    write(path.join(qc, 'musl/include/sys/signalfd.h'), '/* musl */\n');
    const stamp = () => {
        const r = spawnSync(path.join(pack, 'vm/build-qemu-user.sh'), [], {
            encoding: 'utf8',
            env: { PATH: process.env.PATH, HOME: process.env.HOME, PACK_CACHE: qc, QC: qc, ART: path.join(qc, 'art'), MUSL_INCLUDE: path.join(qc, 'musl/include'), PRINT_STAMP: '1' },
        });
        assert.equal(r.status, 0, r.stderr);
        return r.stdout.trim();
    };
    const pinsFile = path.join(pack, 'pins.sh');
    const swap = (name, value) => fs.writeFileSync(pinsFile, fs.readFileSync(pinsFile, 'utf8').replace(new RegExp(`^${name}=.*$`, 'm'), `${name}=${value}`));
    const first = stamp();
    swap('APK_MUSL_X86_64', '0'.repeat(64));
    assert.equal(stamp(), first, "an Alpine package's pin is none of the VM's business");
    swap('EMSDK_RELEASE', '1'.repeat(40));
    assert.notEqual(stamp(), first, 'another Emscripten release is another build');
});
