// Tests of pack-toolchain.sh, through which every toolchain unit is reused,
// taken, fetched or built, and every split pack assembled: a throwaway git
// repository laid out like this one (light/scripts with copies of
// pack-toolchain.sh, pack-store.sh, pack-lib.sh, toolchain-key.sh,
// toolchain-build-env.sh and toolchain-manifest.mjs; the split pack
// light/packs/tool of one unit, tool/cc, whose toolchain.sh takes
// milliseconds; and a copy of the repository's own three-unit stub,
// light/packs/stub, whose libs unit is built with its compilers) against a
// server of its own that answers like GitHub's releases API for the
// toolchain store. The staged toolchain.sh sources toolchain-build-env.sh
// alone, as a real one may, which is what keeps that file self-contained.
//
//   node --test scripts/test-pack-toolchain.mjs   (from light/; needs git, tar, zstd; keytool for one check)
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-toolchain-test-'));
const light = path.join(root, 'light');
const cache = path.join(root, 'cache');
const tmp = path.join(root, 'tmp');
const sidecar = path.join(light, 'app/node_modules/.cache/yukibana/toolchain-tool.json');
/** The repository's stub pack, copied into the test repository as it is. */
const STUB = path.resolve(SCRIPTS, '../packs/stub');
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

// The variables a test sets itself; none of the caller's reaches a run.
const TRANSPORT = [
    'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy',
    'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE', 'GIT_SSL_CAINFO', 'NODE_EXTRA_CA_CERTS',
    'npm_config_https_proxy', 'npm_config_proxy', 'npm_config_cafile',
];
const OWN = ['LIGHT_TOOLCHAIN_PROVENANCE', 'OPT', 'MIRROR', 'UNDECLARED', 'SECRET_TOKEN', 'STUB_LEVEL', 'ALLOW_OTHER_TOOLCHAIN', 'LIGHT_TOOLCHAINS_TAG', 'GITHUB_ACTIONS', 'JOBS', 'NICE', 'CI', 'PACK_CACHE', 'OUT', 'TOOLCHAIN_CACHE', 'GH_TOKEN'];

// The toolchain store: asset name -> { bytes, created }.
let toolchains = new Map();
let downloads = 0;

// The release by tag embeds none of its assets, so every read pages through
// /releases/<id>/assets, as pack-store.sh must (GitHub may shorten the
// embedded list).
const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const json = (body) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (req.url === '/repos/test/repo/releases/tags/light-toolchains') return json({ id: 7, tag_name: 'light-toolchains', assets: [] });
    const page = /^\/repos\/test\/repo\/releases\/7\/assets\?(.*)$/.exec(req.url);
    if (page) {
        const q = new URLSearchParams(page[1]);
        const per = Math.min(Number(q.get('per_page') ?? 30), 100);
        const n = Number(q.get('page') ?? 1);
        const list = [...toolchains].map(([name, a]) => ({
            name,
            created_at: a.created,
            digest: `sha256:${createHash('sha256').update(a.bytes).digest('hex')}`,
            browser_download_url: `${base}/download/${name}`,
        }));
        return json(list.slice((n - 1) * per, n * per));
    }
    const asset = req.url.startsWith('/download/') && toolchains.get(req.url.slice('/download/'.length));
    if (!asset) return res.writeHead(404).end(JSON.stringify({ message: 'Not Found', status: '404' }));
    downloads++;
    res.writeHead(200).end(asset.bytes);
});

/** Runs `script` (a path under light/scripts) with `args` and `vars` added to its environment. */
function runScript(script, vars, args) {
    const env = { ...process.env };
    for (const name of [...TRANSPORT, ...OWN]) delete env[name];
    Object.assign(env, {
        LIGHT_PACKS_REPO: 'test/repo',
        LIGHT_PACKS_API: `http://127.0.0.1:${server.address().port}`,
        GH_TOKEN: '',
        TOOLCHAIN_CACHE: cache,
        TMPDIR: tmp,
        // A gh that is signed in nowhere, so a fetch here is one on a
        // machine without an account: used, and said to be unverified
        // (test-pack-store.mjs tests the verification itself).
        PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
    });
    for (const [name, value] of Object.entries(vars)) {
        if (value === undefined) delete env[name];
        else env[name] = value;
    }
    return new Promise((done) => {
        const child = spawn(path.join(light, 'scripts', script), args, { env });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.on('close', (code) => done({ code, out, err }));
    });
}
/** Runs pack-toolchain.sh with `vars` in its environment. */
const toolchain = (vars, ...args) => runScript('pack-toolchain.sh', vars, args);

/** The toolchain key of `unit` in an environment with `vars`. */
async function key(vars = {}, unit = 'tool/cc') {
    const r = await runScript('pack-store.sh', vars, ['toolchain-key', unit]);
    assert.equal(r.code, 0, r.err);
    return r.out.trim();
}
/** Ensures `unit`'s toolchain with `vars` and `flags`, asserting success; returns its directory and the run. */
async function ensureUnit(unit, vars = {}, ...flags) {
    const r = await toolchain(vars, 'ensure', unit, ...flags);
    assert.equal(r.code, 0, r.err);
    const dir = r.out.trim();
    assert.ok(fs.existsSync(path.join(dir, 'toolchain.json')), dir);
    return { dir, r };
}
/** Ensures tool/cc's toolchain with `vars` and `flags`; see ensureUnit. */
const ensure = (vars = {}, ...flags) => ensureUnit('tool/cc', vars, ...flags);
/** Assembles pack `pack` from toolchain directories `dirs` into `out`, with `vars`. */
const assemble = (vars, pack, out, ...dirs) => toolchain(vars, 'assemble', pack, '--out', out, ...dirs);
const manifestOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'toolchain.json'), 'utf8'));
const statOf = (file) => execFileSync('stat', ['-c', '%s %.9Y', file], { encoding: 'utf8' }).trim().split(' ');

/** Writes `content` to the repository path `rel`, making its directory. */
function put(rel, content, mode = 0o644) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    fs.chmodSync(file, mode);
}
function commit(message) {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', message);
}
/** Puts the worktree back to HEAD, keeping what .gitignore names. */
function clean() {
    git('reset', '-q', '--hard');
    git('clean', '-fdq');
}
/** Removes a tree that may hold read-only files and directories. */
function removeTree(dir) {
    if (!fs.existsSync(dir)) return;
    execFileSync('find', [dir, '-type', 'd', '-exec', 'chmod', 'u+w', '{}', '+']);
    fs.rmSync(dir, { recursive: true, force: true });
}
/** The store asset name of toolchain directory `dir`, from its manifest. */
const assetOf = (dir) => {
    const m = manifestOf(dir);
    return `toolchain-${m.unit.replace('/', '-')}-${m.key}.tar.zst`;
};
/** Writes toolchain directory `dir` as an archive named as its store asset into directory `into`; returns its path. */
function archiveOf(dir, into) {
    fs.mkdirSync(into, { recursive: true });
    const file = path.join(into, assetOf(dir));
    execFileSync('tar', ['--zstd', '-cf', file, '-C', dir, '.']);
    return file;
}
/** Puts toolchain directory `dir` in the store as the asset its manifest names. */
function store(dir) {
    const file = archiveOf(dir, path.join(root, 'asset'));
    toolchains.set(path.basename(file), { bytes: fs.readFileSync(file), created: new Date().toISOString() });
    fs.rmSync(path.join(root, 'asset'), { recursive: true });
}
/** The names of the variables the toolchain script of `dir` saw. */
const seen = (dir) =>
    fs.readFileSync(path.join(dir, 'env.txt'), 'utf8').split('\n').filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map((l) => l.slice(0, l.indexOf('=')));
/** A bash array of toolchain-build-env.sh, by name. */
const envArray = (name) =>
    execFileSync('bash', ['-c', `source "$1"; printf '%s\\n' "\${${name}[@]}"`, 'bash', path.join(light, 'scripts/toolchain-build-env.sh')], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .map((v) => v.split('=')[0]);
const BASH_OWN = ['PWD', 'OLDPWD', 'SHLVL', '_'];

// tool/cc's toolchain.sh, run from its staged directory: the pack is two
// directories up, the stage four.
const TOOLCHAIN_SH = `set -eu
. ./pins.sh
mkdir -p "$OUT/bin" "$OUT/share" "$OUT/lib"
cat ../../src/compiler.c > "$OUT/bin/cc"
ln -s cc "$OUT/bin/c++"
printf '{"cc":"%s"}\\n' "$CC_VERSION" > "$OUT/versions.json"
: > "$OUT/share/empty.txt"
printf 'opt=%s\\n' "\${OPT:-}" > "$OUT/lib/opt.txt"
env > "$OUT/env.txt"
if [ -n "\${HTTPS_PROXY:-}" ]; then
  . ../../../../scripts/toolchain-build-env.sh
  stage="$(cd ../../../../.. && pwd)"
  toolchain_jvm_proxy_opts "$stage" > "$OUT/jvm.txt"
  if [ -n "\${SSL_CERT_FILE:-}" ]; then
    keytool -list -keystore "$stage/truststore.p12" -storepass changeit 2>/dev/null | grep -c trustedCertEntry > "$OUT/trusted.txt"
  fi
fi
`;
const GLUE_SH = (version = 'cc') => `set -eu
if [ "\${1:-}" = --check-versions ]; then
  grep -q '"${version}"' "$TOOLCHAIN_DIR_CC/versions.json" || { echo "glue.sh: the toolchain's versions.json has no ${version}" >&2; exit 1; }
  exit 0
fi
mkdir -p "$OUT/js"
cp src/glue.js "$OUT/js/glue.js"
echo js/glue.js
`;

before(async () => {
    fs.mkdirSync(path.join(light, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'bin'));
    fs.writeFileSync(path.join(root, 'bin/gh'), '#!/bin/sh\necho "stand-in gh: not signed in" >&2\nexit 1\n', { mode: 0o755 });
    fs.mkdirSync(tmp);
    for (const name of ['pack-toolchain.sh', 'pack-store.sh', 'pack-lib.sh', 'toolchain-key.sh', 'toolchain-build-env.sh', 'toolchain-manifest.mjs']) {
        fs.copyFileSync(path.join(SCRIPTS, name), path.join(light, 'scripts', name));
    }
    put('.gitignore', '/bin/\n/cache/\n/tmp/\n/out*/\n/light/app/\n/asset/\n/from*/\n/certs/\n');
    put('light/packs/tool/toolchains/cc/paths', '# The compiler is built from its source, besides this directory.\nsrc/compiler.c\n');
    put('light/packs/tool/toolchains/cc/env', '# What reaches the build.\nOPT variant  # the optimisation level: another compiler\nMIRROR source  # where sources come from; the same bytes\n');
    put('light/packs/tool/toolchains/cc/pins.sh', 'CC_VERSION=1.0\n');
    put('light/packs/tool/toolchains/cc/toolchain.sh', TOOLCHAIN_SH, 0o755);
    put('light/packs/tool/toolchains/cc/outputs', 'bin/cc\nversions.json\n');
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 0; }\n');
    put('light/packs/tool/src/glue.js', 'export const glue = 1;\n');
    put('light/packs/tool/glue.paths', 'glue.sh\nbuild.sh\nrequires.json\nsrc/glue.js\n');
    put('light/packs/tool/glue.sh', GLUE_SH(), 0o755);
    put('light/packs/tool/build.sh', '#!/bin/sh\n', 0o755);
    put('light/packs/tool/requires.json', '{}\n');
    fs.cpSync(STUB, path.join(light, 'packs/stub'), { recursive: true });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    commit('split packs');
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
});
beforeEach(() => {
    // Every run leaves no stage or other temporary directory behind.
    assert.deepEqual(fs.readdirSync(tmp), []);
});
after(() => {
    server.close();
    removeTree(root);
});

test('a toolchain is built once per key and reused', async () => {
    const first = await ensure();
    assert.match(first.r.err, /tool\/cc: building toolchain [0-9a-f]{40}/);
    assert.equal(first.dir, path.join(cache, 'built/tool/cc', await key()));
    const built = manifestOf(first.dir).built;
    const again = await ensure();
    assert.equal(again.dir, first.dir);
    assert.match(again.r.err, /reusing toolchain/);
    assert.doesNotMatch(again.r.err, /building/);
    assert.equal(manifestOf(again.dir).built, built);
});

test('a toolchain script that reads a glue file fails instead of building', async () => {
    put('light/packs/tool/toolchains/cc/toolchain.sh', `${TOOLCHAIN_SH}cat ../../src/glue.js > "$OUT/glue.js"\n`, 0o755);
    const k = await key();
    const r = await toolchain({}, 'ensure', 'tool/cc', '--build-dirty');
    assert.notEqual(r.code, 0);
    assert.match(r.err, /src\/glue\.js: No such file or directory/);
    assert.match(r.err, /toolchain\.sh failed; nothing was recorded/);
    assert.equal(r.out, '');
    assert.equal(fs.existsSync(path.join(cache, 'built/tool/cc', k)), false);
    assert.equal(fs.existsSync(path.join(cache, 'built/tool/cc', `${k}.part`)), false);
    clean();
});

test('a toolchain that leaves out a declared output is not recorded', async () => {
    const { dir } = await ensure();
    const built = manifestOf(dir).built;
    // The outputs file is no input: the key, and the toolchain, stay.
    put('light/packs/tool/toolchains/cc/outputs', 'bin/cc\nversions.json\nlib/*.a\nshare/empty.txt\n');
    const r = await toolchain({}, 'ensure', 'tool/cc', '--rebuild', '--no-fetch');
    assert.notEqual(r.code, 0);
    assert.match(r.err, /these declared outputs match no non-empty file in .*:\n {2}lib\/\*\.a\n {2}share\/empty\.txt\n/);
    assert.match(r.err, /nothing was recorded/);
    assert.equal(manifestOf(dir).built, built);
    assert.equal(fs.existsSync(`${dir}.part`), false);
    clean();
});

test("the built toolchain's manifest names its unit and lists every file with its size and sha256", async () => {
    const { dir } = await ensure({}, '--rebuild', '--no-fetch');
    const m = manifestOf(dir);
    assert.equal(m.format, 2);
    assert.equal(m.unit, 'tool/cc');
    assert.equal(m.key, await key());
    assert.equal(m.commit, git('rev-parse', 'HEAD'));
    assert.deepEqual(m.knobs, {});
    assert.deepEqual(m.needs, {});
    assert.ok(!Number.isNaN(Date.parse(m.built)));
    const files = ['bin/cc', 'env.txt', 'lib/opt.txt', 'share/empty.txt', 'versions.json'];
    assert.deepEqual(m.files.map((f) => f.path), files);
    for (const f of m.files) {
        const file = path.join(dir, f.path);
        const [size, mtime] = statOf(file);
        assert.equal(f.size, Number(size), f.path);
        assert.equal(f.mtime, mtime, f.path);
        assert.equal(f.sha256, createHash('sha256').update(fs.readFileSync(file)).digest('hex'), f.path);
        assert.equal(fs.statSync(file).mode & 0o222, 0, `${f.path} is read-only`);
    }
    assert.deepEqual(m.links, [{ path: 'bin/c++', target: 'cc' }]);
});

test("a pack assembled from a toolchain gets the glue's files and the toolchain's, and can be assembled again over itself", async () => {
    const { dir } = await ensure();
    const out = path.join(root, 'out-pack');
    for (let i = 0; i < 2; i++) {
        const r = await assemble({}, 'tool', out, dir);
        assert.equal(r.code, 0, r.err);
        assert.equal(fs.readFileSync(path.join(out, 'js/glue.js'), 'utf8'), 'export const glue = 1;\n');
        assert.equal(fs.readFileSync(path.join(out, 'bin/cc'), 'utf8'), 'int main(void) { return 0; }\n');
        assert.equal(fs.readlinkSync(path.join(out, 'bin/c++')), 'cc');
        assert.equal(fs.existsSync(path.join(out, 'toolchain.json')), false);
        assert.equal(fs.existsSync(`${out}.part`), false);
        // Linked, not copied, where the file system allows it.
        assert.equal(fs.statSync(path.join(out, 'bin/cc')).ino, fs.statSync(path.join(dir, 'bin/cc')).ino);
    }
    const s = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    assert.equal(s.format, 2);
    assert.equal(s.pack, 'tool');
    assert.equal(s.otherToolchain, false);
    assert.deepEqual(s.units.map((u) => [u.unit, u.key]), [['tool/cc', await key()]]);
    const cc = s.units[0].files.find((f) => f.path === 'bin/cc');
    assert.equal(cc.sha256, createHash('sha256').update('int main(void) { return 0; }\n').digest('hex'));
    assert.equal(cc.mtime, statOf(path.join(out, 'bin/cc'))[1]);
    assert.equal(s.units[0].files.some((f) => f.path.startsWith('js/')), false, 'the sidecar lists the toolchain, not the glue');
});

test('a toolchain whose files were changed after assembly is fetched again, not reused', async () => {
    const { dir } = await ensure();
    store(dir);
    const out = path.join(root, 'out-changed');
    assert.equal((await assemble({}, 'tool', out, dir)).code, 0);
    // Writing through the assembled pack writes the toolchain's own inode.
    const file = path.join(out, 'bin/cc');
    fs.chmodSync(file, 0o644);
    fs.appendFileSync(file, '// patched\n');
    const before = downloads;
    const { dir: again, r } = await ensure();
    assert.equal(again, dir);
    assert.match(r.err, /not reusing .*: .*bin\/cc changed/);
    assert.equal(downloads, before + 1);
    assert.equal(fs.readFileSync(path.join(dir, 'bin/cc'), 'utf8'), 'int main(void) { return 0; }\n');
    assert.equal(fs.statSync(path.join(dir, 'bin/cc')).mode & 0o222, 0);
    // A fetched toolchain is reused like a built one.
    assert.match((await ensure()).r.err, /reusing toolchain/);
});

test('files assembled from a toolchain cannot write back into it, even after assembling twice', async () => {
    const { dir } = await ensure();
    const out = path.join(root, 'out-twice');
    for (let i = 0; i < 2; i++) assert.equal((await assemble({}, 'tool', out, dir)).code, 0);
    const file = path.join(out, 'bin/cc');
    assert.equal(fs.statSync(file).ino, fs.statSync(path.join(dir, 'bin/cc')).ino);
    assert.equal(fs.statSync(file).mode & 0o222, 0);
    if (process.getuid() === 0) {
        // Root writes anything: try as the file's owner, an ordinary user,
        // so only its mode can stop the write.
        fs.chmodSync(root, 0o755);
        fs.chownSync(path.join(dir, 'bin/cc'), 65534, 65534);
        const as = (cmd) => spawnSync('setpriv', ['--reuid=65534', '--regid=65534', '--clear-groups', 'sh', '-c', cmd, 'sh', file], { encoding: 'utf8' });
        assert.equal(as('cat "$1" >/dev/null').status, 0, 'the owner can read it');
        const w = as('printf x >> "$1"');
        assert.notEqual(w.status, 0);
        assert.match(w.stderr, /Permission denied/);
    } else {
        assert.throws(() => fs.appendFileSync(file, 'x'), { code: 'EACCES' });
    }
    assert.equal(fs.readFileSync(path.join(dir, 'bin/cc'), 'utf8'), 'int main(void) { return 0; }\n');
});

test('an old toolchain is pruned from the local cache even though its files are read-only, and stays read-only until then', async () => {
    removeTree(cache);
    const dirs = [];
    for (const opt of ['a', 'b', 'c']) {
        dirs.push((await ensure({ OPT: opt }, '--build-dirty')).dir);
        for (const d of dirs.slice(-2)) {
            assert.ok(fs.existsSync(d), d);
            assert.equal(fs.statSync(path.join(d, 'bin/cc')).mode & 0o222, 0);
            assert.equal(fs.statSync(path.join(d, 'toolchain.json')).mode & 0o222, 0);
        }
    }
    assert.equal(new Set(dirs).size, 3);
    assert.equal(fs.existsSync(dirs[0]), false, 'the least recently used is gone');
    assert.deepEqual(fs.readdirSync(path.join(cache, 'built/tool/cc')).sort(), dirs.slice(1).map((d) => path.basename(d)).sort());
    // Using one again keeps it: b is used now, so c, not b, is the older.
    await ensure({ OPT: 'b' }, '--build-dirty');
    const d = (await ensure({ OPT: 'd' }, '--build-dirty')).dir;
    assert.deepEqual(fs.readdirSync(path.join(cache, 'built/tool/cc')).sort(), [path.basename(dirs[1]), path.basename(d)].sort());
});

test('a toolchain built with an output-changing setting has its own key and is never treated as clean', async () => {
    const plain = await key();
    const k = await key({ OPT: '2' });
    assert.notEqual(k, plain);
    // Even a store asset of that key is never fetched: it could only be dirty.
    toolchains.set(`toolchain-tool-cc-${k}.tar.zst`, { bytes: Buffer.from('not a toolchain'), created: new Date().toISOString() });
    const before = downloads;
    const refused = await toolchain({ OPT: '2' }, 'ensure', 'tool/cc');
    assert.equal(refused.code, 4, refused.err);
    assert.match(refused.err, /not built without being asked:\n {2}OPT=2 \(a variant knob of tool\/cc\)\nbuild it anyway with: setup\.sh --build-toolchain tool\/cc/);
    const { dir } = await ensure({ OPT: '2' }, '--build-dirty');
    assert.equal(path.basename(dir), k);
    assert.equal(downloads, before);
    const m = manifestOf(dir);
    assert.equal(m.commit, 'dirty');
    assert.deepEqual(m.knobs, { OPT: '2' });
    assert.equal(fs.readFileSync(path.join(dir, 'lib/opt.txt'), 'utf8'), 'opt=2\n');
    toolchains.delete(`toolchain-tool-cc-${k}.tar.zst`);

    const a = await assemble({ OPT: '2' }, 'tool', path.join(root, 'out-dirty'), dir);
    assert.equal(a.code, 0, a.err);
    assert.match(a.err, /warning: tool: built dirty: tool\/cc; this pack is for this machine only/);
    const r = await toolchain({ OPT: '2' }, 'record-state', 'tool');
    assert.equal(r.code, 5);
    assert.match(r.err, /the toolchain of tool\/cc was built dirty/);
    assert.equal(r.out, '');
});

test('every setting that reaches a toolchain script is either a fixed or transport variable, a source knob, or part of its key', async () => {
    const vars = { OPT: '3', MIRROR: 'https://mirror.example', JOBS: '2', NICE: '5', CI: 'true', PACK_CACHE: path.join(root, 'cache/packs') };
    const { dir } = await ensure(vars, '--build-dirty');
    const names = seen(dir);
    const fixed = envArray('TOOLCHAIN_ENV_FIXED');
    const transport = envArray('TOOLCHAIN_ENV_TRANSPORT');
    for (const name of names) {
        const why = fixed.includes(name)
            ? 'fixed'
            : transport.includes(name)
              ? 'transport'
              : name === 'MIRROR'
                ? 'a source knob'
                : name === 'OPT'
                  ? 'a variant knob'
                  : BASH_OWN.includes(name)
                    ? "bash's own"
                    : null;
        assert.ok(why, `${name} reached the toolchain script`);
    }
    for (const name of ['PATH', 'HOME', 'LANG', 'OUT', 'JOBS', 'NICE', 'CI', 'PACK_CACHE', 'MIRROR', 'OPT']) assert.ok(names.includes(name), name);
    const env = fs.readFileSync(path.join(dir, 'env.txt'), 'utf8');
    assert.match(env, /^LANG=C\.UTF-8$/m);
    assert.match(env, new RegExp(`^OUT=${dir}\\.part$`, 'm'));
    // The variant knob is part of the key; the source knob and the fixed ones are not.
    assert.equal(path.basename(dir), await key({ OPT: '3' }));
    assert.equal(await key({ OPT: '3', MIRROR: 'elsewhere', JOBS: '64' }), await key({ OPT: '3' }));
    assert.notEqual(await key({ OPT: '3' }), await key());
});

test('a setting the unit does not declare never reaches its toolchain script', async () => {
    const { dir } = await ensure({ UNDECLARED: '1', SECRET_TOKEN: 'hunter2', DEP_CC: '/elsewhere' }, '--rebuild', '--no-fetch');
    const names = seen(dir);
    assert.ok(names.includes('PATH'));
    assert.equal(names.includes('UNDECLARED'), false);
    assert.equal(names.includes('SECRET_TOKEN'), false);
    assert.equal(names.includes('DEP_CC'), false);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'env.txt'), 'utf8'), /hunter2/);
    assert.equal(manifestOf(dir).commit, git('rev-parse', 'HEAD'));
});

test("a malformed line in a unit's env is named, not skipped", async () => {
    fs.appendFileSync(
        path.join(root, 'light/packs/tool/toolchains/cc/env'),
        'LTO\tvariant\nCRLF variant  # saved on Windows\r\nSPEED fast  # an unknown kind\nPATH source  # the build\'s own\n',
    );
    const r = await toolchain({}, 'ensure', 'tool/cc', '--build-dirty', '--no-fetch');
    assert.notEqual(r.code, 0);
    assert.match(r.err, /cc\/env:4: \$'LTO\\tvariant' is not 'NAME source\|variant {2}# why'/);
    assert.match(r.err, /cc\/env:5: \$'CRLF variant {2}# saved on Windows\\r' is not/);
    assert.match(r.err, /cc\/env:6: 'SPEED fast {2}# an unknown kind' is not/);
    assert.match(r.err, /cc\/env:7: PATH is a variable every build is given/);
    assert.doesNotMatch(r.err, /building/);
    assert.equal(r.out, '');
    clean();
});

test('a proxy setting reaches the toolchain script and its JVM flags, and changes neither its key nor its cleanliness', async () => {
    const vars = { HTTPS_PROXY: 'http://user:secret@proxy.example:3128', NO_PROXY: '127.0.0.1, .example.org' };
    const keytool = spawnSync('keytool', ['-help'], { stdio: 'ignore' }).error === undefined;
    if (keytool) {
        // A CA bundle of two certificates, as a TLS-intercepting proxy hands out.
        const certs = path.join(root, 'certs');
        fs.mkdirSync(certs);
        let bundle = '';
        for (const n of [1, 2]) {
            execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', path.join(certs, `${n}.key`), '-out', path.join(certs, `${n}.pem`), '-subj', `/CN=proxy ca ${n}`, '-days', '1'], { stdio: 'ignore' });
            bundle += fs.readFileSync(path.join(certs, `${n}.pem`), 'utf8');
        }
        fs.writeFileSync(path.join(certs, 'bundle.pem'), bundle);
        vars.SSL_CERT_FILE = path.join(certs, 'bundle.pem');
    }
    assert.equal(await key(vars), await key());
    // No --build-dirty: behind a proxy, the build is still clean.
    const { dir } = await ensure(vars, '--rebuild', '--no-fetch');
    assert.equal(path.basename(dir), await key());
    assert.equal(manifestOf(dir).commit, git('rev-parse', 'HEAD'));
    const env = fs.readFileSync(path.join(dir, 'env.txt'), 'utf8');
    assert.match(env, /^HTTPS_PROXY=http:\/\/user:secret@proxy\.example:3128$/m);
    const jvm = fs.readFileSync(path.join(dir, 'jvm.txt'), 'utf8').trim().split(' ');
    for (const flag of ['-Dhttps.proxyHost=proxy.example', '-Dhttps.proxyPort=3128', '-Dhttp.proxyHost=proxy.example', '-Dhttp.proxyPort=3128', '-Dhttp.nonProxyHosts=127.0.0.1|*.example.org']) {
        assert.ok(jvm.includes(flag), `${flag} in ${jvm.join(' ')}`);
    }
    assert.equal(jvm.some((f) => f.includes('secret')), false, 'no credentials reach the JVM flags');
    if (keytool) {
        assert.ok(jvm.includes('-Djavax.net.ssl.trustStorePassword=changeit'));
        assert.ok(jvm.includes('-Djavax.net.ssl.trustStoreType=PKCS12'));
        assert.ok(jvm.some((f) => /^-Djavax\.net\.ssl\.trustStore=\/.*\/truststore\.p12$/.test(f)));
        assert.equal(fs.readFileSync(path.join(dir, 'trusted.txt'), 'utf8').trim(), '2');
    } else {
        test.diagnostic?.('no keytool here: the truststore is checked in CI');
    }
});

test('a proxy the JVM cannot be given as plain flags is refused, not passed on', () => {
    const flags = (vars) =>
        spawnSync('bash', ['-c', 'source "$1"; toolchain_jvm_proxy_opts "$2"', 'bash', path.join(light, 'scripts/toolchain-build-env.sh'), tmp], {
            encoding: 'utf8',
            env: { PATH: process.env.PATH, ...vars },
        });
    const plain = flags({ https_proxy: 'proxy.example' });
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(plain.stdout.trim(), '-Dhttps.proxyHost=proxy.example -Dhttps.proxyPort=1080 -Dhttp.proxyHost=proxy.example -Dhttp.proxyPort=1080');
    assert.equal(flags({}).stdout, '\n');
    const spaced = flags({ HTTPS_PROXY: 'http://proxy example:3128' });
    assert.notEqual(spaced.status, 0);
    assert.match(spaced.stderr, /not plain -Dname=value flags/);
});

test("an uncommitted edit to a pack's glue leaves its toolchain clean and fetched, not built", async () => {
    const built = await ensure();
    store(built.dir);
    removeTree(cache);
    put('light/packs/tool/glue.sh', `${GLUE_SH()}echo edited >&2\n`, 0o755);
    put('light/packs/tool/build.sh', '#!/bin/sh\necho edited\n', 0o755);
    put('light/packs/tool/requires.json', '{"edited":true}\n');
    put('light/packs/tool/src/glue.js', 'export const edited = true;\n');
    const before = downloads;
    const { dir, r } = await ensure();
    assert.equal(dir, built.dir);
    assert.equal(downloads, before + 1);
    assert.match(r.err, /downloading toolchain-tool-cc-[0-9a-f]{40}\.tar\.zst/);
    assert.doesNotMatch(r.err, /building/);
    clean();
});

test('dirty inputs are not built without being asked', async () => {
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 1; }\n');
    put('light/packs/tool/toolchains/cc/new.c', 'int added;\n');
    const k = await key();
    const before = downloads;
    const r = await toolchain({}, 'ensure', 'tool/cc');
    assert.equal(r.code, 4, r.err);
    assert.match(r.err, /not built without being asked:\n {2}light\/packs\/tool\/src\/compiler\.c\n {2}light\/packs\/tool\/toolchains\/cc\/new\.c\nbuild it anyway with: setup\.sh --build-toolchain tool\/cc/);
    assert.equal(r.out, '');
    assert.equal(downloads, before);
    assert.equal(fs.existsSync(path.join(cache, 'built/tool/cc', k)), false);
    const asked = await ensure({}, '--build-dirty');
    assert.equal(manifestOf(asked.dir).commit, 'dirty');
    assert.equal(fs.readFileSync(path.join(asked.dir, 'bin/cc'), 'utf8'), 'int main(void) { return 1; }\n');
    clean();
});

test('a toolchain built dirty is replaced by a clean one once exactly its inputs are committed', async () => {
    removeTree(cache);
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 9; }\n');
    const dirty = await ensure({}, '--build-dirty');
    assert.equal(manifestOf(dirty.dir).commit, 'dirty');
    // Still dirty: the dirty build is what there is, and it is reused.
    assert.match((await ensure({}, '--build-dirty')).r.err, /reusing toolchain/);
    commit('compiler 9');
    // Committed, the same inputs give the same key; the dirty toolchain
    // would never be published or recorded as HEAD's, so it gives way.
    const rebuilt = await ensure();
    assert.equal(rebuilt.dir, dirty.dir);
    assert.match(rebuilt.r.err, /not reusing .*: it was built dirty, and these inputs are committed/);
    assert.match(rebuilt.r.err, /building toolchain/);
    assert.equal(manifestOf(rebuilt.dir).commit, git('rev-parse', 'HEAD'));
    const out = path.join(root, 'out-was-dirty');
    assert.equal((await assemble({}, 'tool', out, rebuilt.dir)).code, 0);
    const state = await toolchain({}, 'record-state', 'tool');
    assert.equal(state.code, 0, state.err);
    // And a clean toolchain stays reused while the glue is dirty.
    put('light/packs/tool/src/glue.js', 'export const glue = 9;\n');
    assert.match((await ensure()).r.err, /reusing toolchain/);
    clean();
    git('reset', '-q', '--hard', 'HEAD~1');
});

test('a set output-changing setting made a source one by an uncommitted env is built only as dirty, and never kept for the committed settings', async () => {
    removeTree(cache);
    const plain = await key();
    put('light/packs/tool/toolchains/cc/env', 'OPT source  # no longer another compiler\nMIRROR source  # the same bytes\n');
    // The key is HEAD's clean one, though OPT now reaches the build unkeyed.
    assert.equal(await key({ OPT: '2' }), plain);
    const before = downloads;
    const refused = await toolchain({ OPT: '2' }, 'ensure', 'tool/cc');
    assert.equal(refused.code, 4, refused.err);
    assert.match(refused.err, /not built without being asked:\n {2}light\/packs\/tool\/toolchains\/cc\/env\nbuild it anyway/);
    assert.equal(downloads, before);
    const asked = await ensure({ OPT: '2' }, '--build-dirty');
    assert.equal(path.basename(asked.dir), plain);
    assert.equal(manifestOf(asked.dir).commit, 'dirty');
    assert.equal(fs.readFileSync(path.join(asked.dir, 'lib/opt.txt'), 'utf8'), 'opt=2\n');
    const state = await toolchain({ OPT: '2' }, 'record-state', 'tool');
    assert.equal(state.code, 5);
    // Back at HEAD's settings, with OPT unset, that build is not HEAD's.
    clean();
    const rebuilt = await ensure();
    assert.equal(rebuilt.dir, asked.dir);
    assert.match(rebuilt.r.err, /not reusing .*: it was built dirty/);
    assert.equal(manifestOf(rebuilt.dir).commit, git('rev-parse', 'HEAD'));
    assert.equal(fs.readFileSync(path.join(rebuilt.dir, 'lib/opt.txt'), 'utf8'), 'opt=\n');
});

test('an output declared after its toolchain was built is looked for at every assembly', async () => {
    const { dir } = await ensure();
    const out = path.join(root, 'out-outputs');
    assert.equal((await assemble({}, 'tool', out, dir)).code, 0);
    // The outputs file is no input: the key, and the reused toolchain, stay.
    const k = await key();
    put('light/packs/tool/toolchains/cc/outputs', 'bin/cc\nversions.json\nlib/libcc.a\n');
    assert.equal(await key(), k);
    const { dir: again } = await ensure();
    assert.equal(again, dir);
    const r = await assemble({}, 'tool', out, again);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /match no non-empty file in .*:\n {2}lib\/libcc\.a/);
    assert.match(r.err, /lacks outputs its outputs file declares/);
    // The pack assembled before is left as it was.
    assert.equal(fs.readFileSync(path.join(out, 'js/glue.js'), 'utf8'), 'export const glue = 1;\n');
    assert.equal(fs.existsSync(`${out}.part`), false);
    clean();
});

test('--fetch-only says it would build with exit 3', async () => {
    removeTree(cache);
    const saved = toolchains;
    toolchains = new Map();
    const r = await toolchain({}, 'ensure', 'tool/cc', '--fetch-only');
    assert.equal(r.code, 3, r.err);
    assert.match(r.err, /no toolchain [0-9a-f]{40} here or in the store: it would build/);
    assert.doesNotMatch(r.err, /building/);
    assert.equal(fs.existsSync(path.join(cache, 'built/tool/cc', await key())), false);
    toolchains = saved;
    const fetched = await ensure({}, '--fetch-only');
    assert.match(fetched.r.err, /downloading/);
});

test("another commit's toolchain is assembled only when it has every output this commit declares", async () => {
    const { dir } = await ensure();
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 5; }\n');
    commit('compiler 5');
    const out = path.join(root, 'out-other');
    const strict = await assemble({}, 'tool', out, dir);
    assert.notEqual(strict.code, 0);
    assert.match(strict.err, /toolchain\.json names the inputs "[0-9a-f]{40}", not [0-9a-f]{40}/);
    assert.equal(fs.existsSync(out), false);

    const allowed = await assemble({ ALLOW_OTHER_TOOLCHAIN: '1' }, 'tool', out, dir);
    assert.equal(allowed.code, 0, allowed.err);
    assert.match(allowed.err, /warning: tool\/cc: assembling over the toolchain [0-9a-f]{40}, not this commit's [0-9a-f]{40}/);
    assert.equal(JSON.parse(fs.readFileSync(sidecar, 'utf8')).otherToolchain, true);

    put('light/packs/tool/toolchains/cc/outputs', 'bin/cc\nversions.json\nlib/libcc.a\n');
    commit('a new output');
    const lacking = await assemble({ ALLOW_OTHER_TOOLCHAIN: '1' }, 'tool', path.join(root, 'out-lacking'), dir);
    assert.notEqual(lacking.code, 0);
    assert.match(lacking.err, /match no non-empty file in .*:\n {2}lib\/libcc\.a/);
    assert.equal(fs.existsSync(path.join(root, 'out-lacking')), false);

    put('light/packs/tool/toolchains/cc/outputs', 'bin/cc\nversions.json\n');
    put('light/packs/tool/glue.sh', GLUE_SH('ld'), 0o755);
    commit('glue reads the version of ld');
    const versions = await assemble({ ALLOW_OTHER_TOOLCHAIN: '1' }, 'tool', path.join(root, 'out-versions'), dir);
    assert.notEqual(versions.code, 0);
    assert.match(versions.err, /the toolchain's versions\.json has no ld/);
    assert.match(versions.err, /the glue's versions check refuses the toolchains it was given/);
    put('light/packs/tool/glue.sh', GLUE_SH(), 0o755);
    commit('glue reads the version of cc');
});

test('a pack assembled by an uncommitted assembly script is not recorded as current', async () => {
    const { dir } = await ensure({}, '--no-fetch');
    assert.equal((await assemble({}, 'tool', path.join(root, 'out-state'), dir)).code, 0);
    const r = await toolchain({}, 'record-state', 'tool');
    assert.equal(r.code, 0, r.err);
    // The pack, assembly as the glossary names it (this script and the
    // manifest's), and each unit's key, which already covers the build
    // environment.
    const [tree, script, manifest, ...units] = r.out.trim().split(' ');
    assert.equal(tree, git('rev-parse', 'HEAD:light/packs/tool'));
    assert.equal(script, git('rev-parse', 'HEAD:light/scripts/pack-toolchain.sh'));
    assert.equal(manifest, git('rev-parse', 'HEAD:light/scripts/toolchain-manifest.mjs'));
    assert.deepEqual(units, [`tool/cc=${await key()}`]);

    // A change to the manifest's format is a change to assembly: another state.
    const mjs = path.join(light, 'scripts/toolchain-manifest.mjs');
    fs.appendFileSync(mjs, '// another manifest format\n');
    const uncommitted = await toolchain({}, 'record-state', 'tool');
    assert.equal(uncommitted.code, 5);
    assert.match(uncommitted.err, /uncommitted changes:\n.*light\/scripts\/toolchain-manifest\.mjs/);
    commit('another manifest format');
    const later = await toolchain({}, 'record-state', 'tool');
    assert.equal(later.code, 0, later.err);
    assert.notEqual(later.out.split(' ')[2], manifest);
    git('reset', '-q', '--hard', 'HEAD~1');

    fs.appendFileSync(path.join(light, 'scripts/pack-toolchain.sh'), '# an uncommitted change to assembly\n');
    const edited = await toolchain({}, 'record-state', 'tool');
    assert.equal(edited.code, 5);
    assert.match(edited.err, /uncommitted changes:\n.*light\/scripts\/pack-toolchain\.sh/);
    assert.equal(edited.out, '');
    clean();

    const other = await toolchain({ ALLOW_OTHER_TOOLCHAIN: '1' }, 'record-state', 'tool');
    assert.equal(other.code, 5);
    assert.match(other.err, /ALLOW_OTHER_TOOLCHAIN is set/);
    assert.equal((await toolchain({}, 'record-state', 'tool')).code, 0);
});

test("asking for any toolchain takes the store's newest and says it is not this commit's", async () => {
    const { dir } = await ensure();
    store(dir);
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 6; }\n');
    commit('compiler 6');
    removeTree(cache);
    assert.equal((await toolchain({}, 'ensure', 'tool/cc', '--fetch-only')).code, 3);
    const { dir: any, r } = await ensure({}, '--any', '--fetch-only');
    assert.equal(any, dir);
    assert.match(r.err, new RegExp(`${any} is not this commit's toolchain \\(that is ${await key()}\\); assemble it with ALLOW_OTHER_TOOLCHAIN=1`));
    const a = await assemble({ ALLOW_OTHER_TOOLCHAIN: '1' }, 'tool', path.join(root, 'out-any'), any);
    assert.equal(a.code, 0, a.err);
});

// ---- The stub: three units, libs built with compilers -------------------

/** The stub's three units ensured as a pack, in the order ensure prints them: compilers, libs, vm. */
async function ensureStub(vars = {}, ...flags) {
    const r = await toolchain(vars, 'ensure', 'stub', ...flags);
    assert.equal(r.code, 0, r.err);
    const dirs = r.out.trim().split('\n');
    assert.deepEqual(dirs.map((d) => manifestOf(d).unit), ['stub/compilers', 'stub/libs', 'stub/vm']);
    return { dirs, r };
}

test('a unit is built after the units it needs, with them read-only at DEP_<UNIT>, and the pack is assembled from all three', async () => {
    removeTree(cache);
    toolchains = new Map();
    const { dirs, r } = await ensureStub();
    const [compilers, libs, vm] = dirs;
    // compilers is built first, as libs needs it, and once only.
    assert.equal(r.err.match(/stub\/compilers: building toolchain/g)?.length, 1, r.err);
    assert.ok(r.err.indexOf('stub/compilers: building') < r.err.indexOf('stub/libs: building'), r.err);
    assert.match(fs.readFileSync(path.join(libs, 'lib/libframework.a'), 'utf8'), /^built by cc 1\.0 from:\n\/\* The stub's "framework"/);
    const m = manifestOf(libs);
    assert.deepEqual(m.needs, { 'stub/compilers': manifestOf(compilers).key });
    assert.equal(m.commit, git('rev-parse', 'HEAD'));
    const envOf = (dir, unit) => fs.readFileSync(path.join(dir, `share/env-${unit}.txt`), 'utf8').trim().split('\n');
    assert.ok(envOf(libs, 'libs').includes('DEP_COMPILERS'));

    const out = path.join(root, 'out-stub');
    const a = await assemble({}, 'stub', out, vm, compilers, libs);
    assert.equal(a.code, 0, a.err);
    for (const f of ['bin/cc', 'vm/kernel', 'lib/libframework.a', 'versions-compilers.json', 'versions-vm.json', 'versions-libs.json', 'server.js']) {
        assert.ok(fs.existsSync(path.join(out, f)), f);
    }
    // The compilers' build-only flags reached libs' build, and not the pack.
    assert.match(fs.readFileSync(path.join(libs, 'lib/libframework.a'), 'utf8'), /^flags -std=stub1\.0$/m);
    assert.ok(manifestOf(compilers).files.some((f) => f.path === 'build-only/flags'), 'a build-only file is in its toolchain like any other');
    assert.equal(fs.existsSync(path.join(out, 'build-only')), false, 'a build-only file is never served');
    assert.equal(fs.statSync(path.join(out, 'vm/kernel')).ino, fs.statSync(path.join(vm, 'vm/kernel')).ino);
    const s = JSON.parse(fs.readFileSync(path.join(light, 'app/node_modules/.cache/yukibana/toolchain-stub.json'), 'utf8'));
    assert.deepEqual(s.units.map((u) => u.unit), ['stub/compilers', 'stub/libs', 'stub/vm']);
    assert.deepEqual(s.units[0].files.filter((f) => f.path.startsWith('build-only/')), [], 'the sidecar lists only what is served');
    const state = await toolchain({}, 'record-state', 'stub');
    assert.equal(state.code, 0, state.err);
    assert.deepEqual(state.out.trim().split(' ').slice(3), [
        `stub/compilers=${await key({}, 'stub/compilers')}`,
        `stub/libs=${await key({}, 'stub/libs')}`,
        `stub/vm=${await key({}, 'stub/vm')}`,
    ]);
    // Ensured again, everything is reused.
    const again = await ensureStub();
    assert.doesNotMatch(again.r.err, /building/);
});

test('a unit cannot see a dependency it did not declare', async () => {
    const { dirs } = await ensureStub();
    const [compilers, , vm] = dirs;
    const names = fs.readFileSync(path.join(vm, 'share/env-vm.txt'), 'utf8').trim().split('\n');
    assert.deepEqual(names.filter((n) => n.startsWith('DEP_')), []);
    // Nor is any other unit in its stage: vm, reaching for the compilers
    // where libs finds them, finds nothing.
    put('light/packs/stub/toolchains/vm/toolchain.sh', `${fs.readFileSync(path.join(root, 'light/packs/stub/toolchains/vm/toolchain.sh'), 'utf8')}ls ../../../../../deps > "$OUT/vm/deps.txt" 2>&1 || echo none > "$OUT/vm/deps.txt"\n`, 0o755);
    const built = await ensureUnit('stub/vm', {}, '--build-dirty');
    assert.equal(fs.readFileSync(path.join(built.dir, 'vm/deps.txt'), 'utf8'), 'none\n');
    clean();
    // And the stage refuses to link one it was not declared to need.
    const stage = fs.mkdtempSync(path.join(root, 'out-stage-'));
    const r = spawnSync('bash', ['-c', 'source light/scripts/toolchain-key.sh; toolchain_stage stub/vm "$1" "stub/compilers=$2"', 'bash', stage, compilers], { cwd: root, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /stub\/vm does not need stub\/compilers; a unit sees only what its needs file declares/);
    const missing = spawnSync('bash', ['-c', 'source light/scripts/toolchain-key.sh; toolchain_stage stub/libs "$1"', 'bash', stage], { cwd: root, encoding: 'utf8' });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /stub\/libs needs stub\/compilers, and no toolchain of it was given to stage/);
    removeTree(stage);
});

test('a dependency is linked read-only: the unit built with it cannot write into it', async () => {
    const { dirs } = await ensureStub();
    const [compilers] = dirs;
    put('light/packs/stub/toolchains/libs/toolchain.sh', `${fs.readFileSync(path.join(root, 'light/packs/stub/toolchains/libs/toolchain.sh'), 'utf8')}touch "$DEP_COMPILERS/bin/planted" 2> "$OUT/share/planted.txt" || true\n`, 0o755);
    const built = await ensureUnit('stub/libs', {}, '--build-dirty');
    if (process.getuid() !== 0) assert.match(fs.readFileSync(path.join(built.dir, 'share/planted.txt'), 'utf8'), /Permission denied/);
    assert.equal(fs.existsSync(path.join(compilers, 'bin/planted')), false);
    clean();
});

test('a unit is staged at the same path at every build, so the trees it keeps find the units it needs where they were', async () => {
    // A unit's build keeps trees in PACK_CACHE that name what configured
    // them by absolute path (CMake includes Emscripten.cmake from
    // $DEP_EMSDK). The stage was once a fresh temporary directory, so every
    // build after the first found its trees naming a deleted dependency.
    await ensureStub();
    const script = path.join(root, 'light/packs/stub/toolchains/libs/toolchain.sh');
    const original = fs.readFileSync(script, 'utf8');
    const stage = path.join(tmp, 'pack-toolchain-stage-stub-libs');
    const build = async (edit) => {
        put('light/packs/stub/toolchains/libs/toolchain.sh', `${original}# ${edit}\nprintf '%s\\n' "$DEP_COMPILERS" > "$OUT/share/where.txt"\nls "$(dirname "$DEP_COMPILERS")" > "$OUT/share/deps.txt"\n`, 0o755);
        const { dir, r } = await ensureUnit('stub/libs', {}, '--build-dirty');
        assert.match(r.err, /stub\/libs: building toolchain/);
        return { where: fs.readFileSync(path.join(dir, 'share/where.txt'), 'utf8').trim(), deps: fs.readFileSync(path.join(dir, 'share/deps.txt'), 'utf8').trim() };
    };
    const first = await build('one edit');
    assert.equal(first.where, path.join(stage, 'deps/stub/compilers'));
    // What a killed build left in the stage is gone before the next stages.
    fs.mkdirSync(path.join(stage, 'deps/stub/planted'), { recursive: true });
    const second = await build('another edit, so another key');
    assert.equal(second.where, first.where, 'the same path under another key');
    assert.equal(second.deps, 'compilers');
    assert.equal(fs.existsSync(stage), false, 'and the stage is removed after the build');
    clean();
});

test('taking the libraries from the store never downloads the compilers', async () => {
    const { dirs } = await ensureStub();
    const [compilers, libs] = dirs;
    toolchains = new Map();
    store(compilers);
    store(libs);
    removeTree(cache);
    const before = downloads;
    const { r } = await ensureUnit('stub/libs', {}, '--fetch-only');
    assert.equal(downloads, before + 1);
    assert.match(r.err, /downloading toolchain-stub-libs-/);
    assert.equal(fs.existsSync(path.join(cache, 'built/stub/compilers')), false);
    toolchains = new Map();
});

test('a unit takes what it needs from an earlier job of the same run, and with --no-build-deps builds nothing else', async () => {
    const { dirs } = await ensureStub();
    const [compilers] = dirs;
    toolchains = new Map();
    const from = path.join(root, 'from-run');
    archiveOf(compilers, from);
    removeTree(cache);
    const before = downloads;
    const { r } = await ensureUnit('stub/libs', {}, '--from', from, '--no-build-deps');
    assert.match(r.err, /stub\/compilers: taking toolchain [0-9a-f]{40} from .*from-run\/toolchain-stub-compilers-/);
    assert.match(r.err, /stub\/libs: building toolchain/);
    assert.doesNotMatch(r.err, /stub\/compilers: building/);
    assert.equal(downloads, before);

    // Without the archive, and with nothing in the store, it stops by name.
    removeTree(cache);
    removeTree(from);
    const refused = await toolchain({}, 'ensure', 'stub/libs', '--from', from, '--no-build-deps');
    assert.equal(refused.code, 3, refused.err);
    assert.match(refused.err, /stub\/libs: needs stub\/compilers, which is not here, in .*from-run or in the store, and --no-build-deps builds no unit but stub\/libs/);
    assert.doesNotMatch(refused.err, /building/);

    // An archive whose bytes are not what its manifest lists is refused.
    const ok = (await ensureUnit('stub/compilers', {}, '--no-fetch')).dir;
    const file = archiveOf(ok, from);
    removeTree(cache);
    fs.writeFileSync(file, Buffer.concat([fs.readFileSync(file).subarray(0, 64), Buffer.from('garbage')]));
    const corrupt = await toolchain({}, 'ensure', 'stub/compilers', '--from', from);
    assert.equal(corrupt.code, 1);
    assert.match(corrupt.err, /is refused/);
    removeTree(from);
});

test("a unit job builds its unit though another run stored it meanwhile, so what it publishes is this commit's", async () => {
    const { dirs } = await ensureStub();
    const [compilers, libs] = dirs;
    // Another run, of the same inputs at another commit, stored both.
    toolchains = new Map();
    for (const dir of [compilers, libs]) {
        const m = manifestOf(dir);
        execFileSync('chmod', ['u+w', path.join(dir, 'toolchain.json')]);
        fs.writeFileSync(path.join(dir, 'toolchain.json'), JSON.stringify({ ...m, commit: 'f'.repeat(40) }));
        store(dir);
    }
    removeTree(cache);
    const from = path.join(root, 'from-empty');
    fs.mkdirSync(from, { recursive: true });
    const { dir, r } = await ensureUnit('stub/libs', {}, '--from', from, '--no-build-deps', '--no-fetch');
    // The unit it needs is still fetched, as nothing here would build it...
    assert.match(r.err, /downloading toolchain-stub-compilers-/);
    assert.doesNotMatch(r.err, /stub\/compilers: building/);
    // ...and the unit itself is built at HEAD, not taken from the store.
    assert.match(r.err, /stub\/libs: building toolchain/);
    assert.doesNotMatch(r.err, /downloading toolchain-stub-libs-/);
    assert.equal(manifestOf(dir).commit, git('rev-parse', 'HEAD'));
    const archived = await runScript('pack-store.sh', {}, ['toolchain-archive', 'stub/libs', dir, path.join(root, 'archive-out')]);
    assert.equal(archived.code, 0, archived.err);
    // Fetched, it would have been refused there.
    removeTree(cache);
    const fetched = await ensureUnit('stub/libs', {}, '--from', from, '--no-build-deps');
    const refused = await runScript('pack-store.sh', {}, ['toolchain-archive', 'stub/libs', fetched.dir, path.join(root, 'archive-out')]);
    assert.equal(refused.code, 1);
    assert.match(refused.err, /was built at f{40}, not at HEAD/);
    fs.rmSync(path.join(root, 'archive-out'), { recursive: true, force: true });
    removeTree(from);
    removeTree(cache);
    toolchains = new Map();
});

test('libraries built over one compilers toolchain are not assembled with another', async () => {
    removeTree(cache);
    toolchains = new Map();
    const { dirs } = await ensureStub();
    const [compilers, libs, vm] = dirs;
    put('light/packs/stub/toolchains/compilers/pins.sh', `${fs.readFileSync(path.join(root, 'light/packs/stub/toolchains/compilers/pins.sh'), 'utf8')}CC_PATCH=1\n`);
    commit('another compilers');
    const newer = (await ensureUnit('stub/compilers', {}, '--no-fetch')).dir;
    assert.notEqual(manifestOf(newer).key, manifestOf(compilers).key);
    // Each unit at its newest, as ensure --any takes them: libs is still
    // the one built over the old compilers.
    const out = path.join(root, 'out-mixed');
    const r = await assemble({ ALLOW_OTHER_TOOLCHAIN: '1' }, 'stub', out, newer, libs, vm);
    assert.equal(r.code, 1, r.err);
    assert.match(r.err, new RegExp(`stub/libs was built over stub/compilers ${manifestOf(compilers).key}, but is given with stub/compilers ${manifestOf(newer).key}`));
    assert.equal(fs.existsSync(out), false);
    // The old compilers with the libraries built over them may stand in.
    const old = await assemble({ ALLOW_OTHER_TOOLCHAIN: '1' }, 'stub', out, compilers, libs, vm);
    assert.equal(old.code, 0, old.err);
    git('reset', '-q', '--hard', 'HEAD~1');
    removeTree(out);
});

test('a unit built over a dirty unit it needs is dirty too', async () => {
    put('light/packs/stub/toolchains/compilers/pins.sh', 'CC_VERSION=1.9\n');
    const refused = await toolchain({}, 'ensure', 'stub/libs', '--no-fetch');
    assert.equal(refused.code, 4, refused.err);
    assert.match(refused.err, /stub\/libs: the toolchain's inputs are dirty.*\n {2}light\/packs\/stub\/toolchains\/compilers\/pins\.sh\n/);
    const { dir } = await ensureUnit('stub/libs', {}, '--build-dirty', '--no-fetch');
    assert.equal(manifestOf(dir).commit, 'dirty');
    assert.match(fs.readFileSync(path.join(dir, 'lib/libframework.a'), 'utf8'), /^built by cc 1\.9/);
    // A set variant knob of libs makes only libs dirty.
    clean();
    const level = await toolchain({ STUB_LEVEL: '2' }, 'ensure', 'stub/libs', '--no-fetch');
    assert.equal(level.code, 4);
    assert.match(level.err, /STUB_LEVEL=2 \(a variant knob of stub\/libs\)/);
    assert.equal((await toolchain({ STUB_LEVEL: '2' }, 'ensure', 'stub/compilers', '--no-fetch')).code, 0);
});

test('a cycle of needs fails ensure by name before anything is built', async () => {
    put('light/packs/stub/toolchains/compilers/needs', 'stub/libs\n');
    const r = await toolchain({}, 'ensure', 'stub', '--build-dirty', '--no-fetch');
    assert.equal(r.code, 1, r.err);
    assert.match(r.err, /form a cycle, so none can be built first/);
    assert.doesNotMatch(r.err, /building/);
    clean();
});

test('two units that write one path, or an incomplete or foreign set of units, are refused at assembly', async () => {
    const { dirs } = await ensureStub();
    const [compilers, libs] = dirs;
    const out = path.join(root, 'out-overlap');
    put('light/packs/stub/toolchains/vm/toolchain.sh', `${fs.readFileSync(path.join(root, 'light/packs/stub/toolchains/vm/toolchain.sh'), 'utf8')}mkdir -p "$OUT/bin" && echo vm > "$OUT/bin/cc"\n`, 0o755);
    const clash = (await ensureUnit('stub/vm', {}, '--build-dirty')).dir;
    const r = await assemble({}, 'stub', out, compilers, libs, clash);
    assert.equal(r.code, 1);
    assert.match(r.err, /bin\/cc is written by both stub\/compilers and stub\/vm; units of one pack may not write the same path/);
    assert.equal(fs.existsSync(out), false);
    clean();

    // Two units' build-only files may share a path: neither is linked.
    put('light/packs/stub/toolchains/vm/toolchain.sh', `${fs.readFileSync(path.join(root, 'light/packs/stub/toolchains/vm/toolchain.sh'), 'utf8')}mkdir -p "$OUT/build-only" && echo vm > "$OUT/build-only/flags"\n`, 0o755);
    const both = (await ensureUnit('stub/vm', {}, '--build-dirty')).dir;
    const ok = await assemble({}, 'stub', out, compilers, libs, both);
    assert.equal(ok.code, 0, ok.err);
    assert.equal(fs.existsSync(path.join(out, 'build-only')), false);
    removeTree(out);
    clean();
    // The vm toolchain these replaced was pruned from the local cache.
    const [, , vm2] = (await ensureStub()).dirs;

    const missing = await assemble({}, 'stub', out, compilers, libs);
    assert.match(missing.err, /no toolchain of stub\/vm given; assemble takes every unit of the pack/);
    const twice = await assemble({}, 'stub', out, compilers, libs, vm2, compilers);
    assert.match(twice.err, /two toolchains of stub\/compilers given/);
    const foreign = await assemble({}, 'stub', out, compilers, libs, vm2, (await ensure()).dir);
    assert.match(foreign.err, /is a toolchain of tool\/cc, not of a unit of stub/);
    assert.equal(fs.existsSync(out), false);
});
