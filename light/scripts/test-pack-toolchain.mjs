// Tests of pack-toolchain.sh, through which every split pack's toolchain is
// reused, fetched or built, and every split pack assembled: a throwaway git
// repository laid out like this one (light/scripts with copies of
// pack-toolchain.sh, pack-store.sh, toolchain-env.sh and
// toolchain-manifest.mjs, and the split pack light/packs/tool, whose
// toolchain.sh takes milliseconds) against a server of its own that answers
// like GitHub's releases API for the toolchain store.
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
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

// The variables a test sets itself; none of the caller's reaches a run.
const TRANSPORT = [
    'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy',
    'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE', 'GIT_SSL_CAINFO', 'NODE_EXTRA_CA_CERTS',
    'npm_config_https_proxy', 'npm_config_proxy', 'npm_config_cafile',
];
const OWN = ['OPT', 'MIRROR', 'UNDECLARED', 'SECRET_TOKEN', 'ALLOW_OTHER_TOOLCHAIN', 'LIGHT_TOOLCHAINS_TAG', 'GITHUB_ACTIONS', 'JOBS', 'NICE', 'CI', 'PACK_CACHE', 'OUT'];

// The toolchain store: asset name -> { bytes, created }.
let toolchains = new Map();
let downloads = 0;

const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url === '/repos/test/repo/releases/tags/light-toolchains') {
        const list = [...toolchains].map(([name, a]) => ({
            name,
            created_at: a.created,
            digest: `sha256:${createHash('sha256').update(a.bytes).digest('hex')}`,
            browser_download_url: `${base}/download/${name}`,
        }));
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ assets: list }));
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

/** The toolchain key of pack tool in an environment with `vars`. */
async function key(vars = {}) {
    const r = await runScript('pack-store.sh', vars, ['toolchain-key', 'tool']);
    assert.equal(r.code, 0, r.err);
    return r.out.trim();
}
/** Ensures tool's toolchain with `vars` and `flags`, asserting success; returns its directory and the run. */
async function ensure(vars = {}, ...flags) {
    const r = await toolchain(vars, 'ensure', 'tool', ...flags);
    assert.equal(r.code, 0, r.err);
    const dir = r.out.trim();
    assert.ok(fs.existsSync(path.join(dir, 'toolchain.json')), dir);
    return { dir, r };
}
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
/** Puts toolchain directory `dir` in the store as the asset its manifest names. */
function store(dir) {
    const m = manifestOf(dir);
    const file = path.join(root, 'asset.tar.zst');
    execFileSync('tar', ['--zstd', '-cf', file, '-C', dir, '.']);
    toolchains.set(`toolchain-tool-${m.key}.tar.zst`, { bytes: fs.readFileSync(file), created: new Date().toISOString() });
    fs.rmSync(file);
}
/** The names of the variables the toolchain script of `dir` saw. */
const seen = (dir) =>
    fs.readFileSync(path.join(dir, 'env.txt'), 'utf8').split('\n').filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map((l) => l.slice(0, l.indexOf('=')));
/** A bash array of toolchain-env.sh, by name. */
const envArray = (name) =>
    execFileSync('bash', ['-c', `source "$1"; printf '%s\\n' "\${${name}[@]}"`, 'bash', path.join(light, 'scripts/toolchain-env.sh')], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .map((v) => v.split('=')[0]);
const BASH_OWN = ['PWD', 'OLDPWD', 'SHLVL', '_'];

const TOOLCHAIN_SH = `set -eu
. ./pins.sh
mkdir -p "$OUT/bin" "$OUT/share" "$OUT/lib"
cat src/compiler.c > "$OUT/bin/cc"
ln -s cc "$OUT/bin/c++"
printf '{"cc":"%s"}\\n' "$CC_VERSION" > "$OUT/versions.json"
: > "$OUT/share/empty.txt"
printf 'opt=%s\\n' "\${OPT:-}" > "$OUT/lib/opt.txt"
env > "$OUT/env.txt"
if [ -n "\${HTTPS_PROXY:-}" ]; then
  . ../../scripts/toolchain-env.sh
  stage="$(cd ../../.. && pwd)"
  toolchain_jvm_proxy_opts "$stage" > "$OUT/jvm.txt"
  if [ -n "\${SSL_CERT_FILE:-}" ]; then
    keytool -list -keystore "$stage/truststore.p12" -storepass changeit 2>/dev/null | grep -c trustedCertEntry > "$OUT/trusted.txt"
  fi
fi
`;
const GLUE_SH = (version = 'cc') => `set -eu
if [ "\${1:-}" = --check-versions ]; then
  grep -q '"${version}"' "$TOOLCHAIN_DIR/versions.json" || { echo "glue.sh: the toolchain's versions.json has no ${version}" >&2; exit 1; }
  exit 0
fi
mkdir -p "$OUT/js"
cp src/glue.js "$OUT/js/glue.js"
echo js/glue.js
`;

before(async () => {
    fs.mkdirSync(path.join(light, 'scripts'), { recursive: true });
    fs.mkdirSync(tmp);
    for (const name of ['pack-toolchain.sh', 'pack-store.sh', 'toolchain-env.sh', 'toolchain-manifest.mjs']) {
        fs.copyFileSync(path.join(SCRIPTS, name), path.join(light, 'scripts', name));
    }
    put('.gitignore', '/cache/\n/tmp/\n/out*/\n/light/app/\n/asset.tar.zst\n/certs/\n');
    put('light/packs/tool/toolchain.paths', 'light/packs/tool\n:(exclude)light/packs/tool/src/glue.js\n');
    put('light/packs/tool/toolchain.env', '# What reaches the build.\nOPT variant  # the optimisation level: another compiler\nMIRROR source  # where sources come from; the same bytes\n');
    put('light/packs/tool/pins.sh', 'CC_VERSION=1.0\n');
    put('light/packs/tool/toolchain.sh', TOOLCHAIN_SH, 0o755);
    put('light/packs/tool/toolchain.outputs', 'bin/cc\nversions.json\n');
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 0; }\n');
    put('light/packs/tool/src/glue.js', 'export const glue = 1;\n');
    put('light/packs/tool/glue.sh', GLUE_SH(), 0o755);
    put('light/packs/tool/build.sh', '#!/bin/sh\n', 0o755);
    put('light/packs/tool/requires.json', '{}\n');
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    commit('a split pack');
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
    assert.match(first.r.err, /building toolchain [0-9a-f]{40}/);
    assert.equal(first.dir, path.join(cache, 'built/tool', await key()));
    const built = manifestOf(first.dir).built;
    const again = await ensure();
    assert.equal(again.dir, first.dir);
    assert.match(again.r.err, /reusing toolchain/);
    assert.doesNotMatch(again.r.err, /building/);
    assert.equal(manifestOf(again.dir).built, built);
});

test('a toolchain script that reads a glue file fails instead of building', async () => {
    put('light/packs/tool/toolchain.sh', `${TOOLCHAIN_SH}cat src/glue.js > "$OUT/glue.js"\n`, 0o755);
    const k = await key();
    const r = await toolchain({}, 'ensure', 'tool', '--build-dirty');
    assert.notEqual(r.code, 0);
    assert.match(r.err, /src\/glue\.js: No such file or directory/);
    assert.match(r.err, /toolchain\.sh failed; nothing was recorded/);
    assert.equal(r.out, '');
    assert.equal(fs.existsSync(path.join(cache, 'built/tool', k)), false);
    assert.equal(fs.existsSync(path.join(cache, 'built/tool', `${k}.part`)), false);
    clean();
});

test('a toolchain that leaves out a declared output is not recorded', async () => {
    const { dir } = await ensure();
    const built = manifestOf(dir).built;
    // toolchain.outputs is no input: the key, and the toolchain, stay.
    put('light/packs/tool/toolchain.outputs', 'bin/cc\nversions.json\nlib/*.a\nshare/empty.txt\n');
    const r = await toolchain({}, 'ensure', 'tool', '--rebuild', '--no-fetch');
    assert.notEqual(r.code, 0);
    assert.match(r.err, /these declared outputs match no non-empty file in .*:\n {2}lib\/\*\.a\n {2}share\/empty\.txt\n/);
    assert.match(r.err, /nothing was recorded/);
    assert.equal(manifestOf(dir).built, built);
    assert.equal(fs.existsSync(`${dir}.part`), false);
    clean();
});

test("the built toolchain's manifest lists every file with its size and sha256", async () => {
    const { dir } = await ensure({}, '--rebuild', '--no-fetch');
    const m = manifestOf(dir);
    assert.equal(m.format, 1);
    assert.equal(m.pack, 'tool');
    assert.equal(m.key, await key());
    assert.equal(m.commit, git('rev-parse', 'HEAD'));
    assert.deepEqual(m.knobs, {});
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
        const r = await toolchain({}, 'assemble', 'tool', dir, out);
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
    assert.equal(s.key, await key());
    assert.equal(s.otherToolchain, false);
    const cc = s.files.find((f) => f.path === 'bin/cc');
    assert.equal(cc.sha256, createHash('sha256').update('int main(void) { return 0; }\n').digest('hex'));
    assert.equal(cc.mtime, statOf(path.join(out, 'bin/cc'))[1]);
    assert.equal(s.files.some((f) => f.path.startsWith('js/')), false, 'the sidecar lists the toolchain, not the glue');
});

test('a toolchain whose files were changed after assembly is fetched again, not reused', async () => {
    const { dir } = await ensure();
    store(dir);
    const out = path.join(root, 'out-changed');
    assert.equal((await toolchain({}, 'assemble', 'tool', dir, out)).code, 0);
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
    for (let i = 0; i < 2; i++) assert.equal((await toolchain({}, 'assemble', 'tool', dir, out)).code, 0);
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
    assert.deepEqual(fs.readdirSync(path.join(cache, 'built/tool')).sort(), dirs.slice(1).map((d) => path.basename(d)).sort());
    // Using one again keeps it: b is used now, so c, not b, is the older.
    await ensure({ OPT: 'b' }, '--build-dirty');
    const d = (await ensure({ OPT: 'd' }, '--build-dirty')).dir;
    assert.deepEqual(fs.readdirSync(path.join(cache, 'built/tool')).sort(), [path.basename(dirs[1]), path.basename(d)].sort());
});

test('a toolchain built with an output-changing setting has its own key and is never treated as clean', async () => {
    const plain = await key();
    const k = await key({ OPT: '2' });
    assert.notEqual(k, plain);
    // Even a store asset of that key is never fetched: it could only be dirty.
    toolchains.set(`toolchain-tool-${k}.tar.zst`, { bytes: Buffer.from('not a toolchain'), created: new Date().toISOString() });
    const before = downloads;
    const refused = await toolchain({ OPT: '2' }, 'ensure', 'tool');
    assert.equal(refused.code, 4, refused.err);
    assert.match(refused.err, /not built without being asked:\n {2}OPT=2 \(a variant knob\)\nbuild it anyway with: setup\.sh --build-toolchain tool/);
    const { dir } = await ensure({ OPT: '2' }, '--build-dirty');
    assert.equal(path.basename(dir), k);
    assert.equal(downloads, before);
    const m = manifestOf(dir);
    assert.equal(m.commit, 'dirty');
    assert.deepEqual(m.knobs, { OPT: '2' });
    assert.equal(fs.readFileSync(path.join(dir, 'lib/opt.txt'), 'utf8'), 'opt=2\n');
    toolchains.delete(`toolchain-tool-${k}.tar.zst`);

    const a = await toolchain({ OPT: '2' }, 'assemble', 'tool', dir, path.join(root, 'out-dirty'));
    assert.equal(a.code, 0, a.err);
    assert.match(a.err, /warning: tool: the toolchain was built dirty/);
    const r = await toolchain({ OPT: '2' }, 'record-state', 'tool');
    assert.equal(r.code, 5);
    assert.match(r.err, /its toolchain was built dirty/);
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

test('a setting the pack does not declare never reaches its toolchain script', async () => {
    const { dir } = await ensure({ UNDECLARED: '1', SECRET_TOKEN: 'hunter2' }, '--rebuild', '--no-fetch');
    const names = seen(dir);
    assert.ok(names.includes('PATH'));
    assert.equal(names.includes('UNDECLARED'), false);
    assert.equal(names.includes('SECRET_TOKEN'), false);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'env.txt'), 'utf8'), /hunter2/);
    assert.equal(manifestOf(dir).commit, git('rev-parse', 'HEAD'));
});

test('a malformed toolchain.env line is named, not skipped', async () => {
    fs.appendFileSync(
        path.join(root, 'light/packs/tool/toolchain.env'),
        'LTO\tvariant\nCRLF variant  # saved on Windows\r\nSPEED fast  # an unknown kind\nPATH source  # the build\'s own\n',
    );
    const r = await toolchain({}, 'ensure', 'tool', '--build-dirty', '--no-fetch');
    assert.notEqual(r.code, 0);
    assert.match(r.err, /toolchain\.env:4: \$'LTO\\tvariant' is not 'NAME source\|variant {2}# why'/);
    assert.match(r.err, /toolchain\.env:5: \$'CRLF variant {2}# saved on Windows\\r' is not/);
    assert.match(r.err, /toolchain\.env:6: 'SPEED fast {2}# an unknown kind' is not/);
    assert.match(r.err, /toolchain\.env:7: PATH is a fixed or transport variable of every build, not a knob/);
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
        spawnSync('bash', ['-c', 'source "$1"; toolchain_jvm_proxy_opts "$2"', 'bash', path.join(light, 'scripts/toolchain-env.sh'), tmp], {
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

test("an uncommitted edit to a pack's glue.sh, build.sh or requires.json leaves its toolchain clean and fetched, not built", async () => {
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
    assert.match(r.err, /downloading toolchain-tool-[0-9a-f]{40}\.tar\.zst/);
    assert.doesNotMatch(r.err, /building/);
    clean();
});

test('dirty inputs are not built without being asked', async () => {
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 1; }\n');
    put('light/packs/tool/src/new.c', 'int added;\n');
    const k = await key();
    const before = downloads;
    const r = await toolchain({}, 'ensure', 'tool');
    assert.equal(r.code, 4, r.err);
    assert.match(r.err, /not built without being asked:\n {2}light\/packs\/tool\/src\/compiler\.c\n {2}light\/packs\/tool\/src\/new\.c\nbuild it anyway with: setup\.sh --build-toolchain tool/);
    assert.equal(r.out, '');
    assert.equal(downloads, before);
    assert.equal(fs.existsSync(path.join(cache, 'built/tool', k)), false);
    const asked = await ensure({}, '--build-dirty');
    assert.equal(manifestOf(asked.dir).commit, 'dirty');
    assert.equal(fs.readFileSync(path.join(asked.dir, 'bin/cc'), 'utf8'), 'int main(void) { return 1; }\n');
    clean();
});

test('--fetch-only says it would build with exit 3', async () => {
    removeTree(cache);
    const saved = toolchains;
    toolchains = new Map();
    const r = await toolchain({}, 'ensure', 'tool', '--fetch-only');
    assert.equal(r.code, 3, r.err);
    assert.match(r.err, /no toolchain [0-9a-f]{40} here or in the store: it would build/);
    assert.doesNotMatch(r.err, /building/);
    assert.equal(fs.existsSync(path.join(cache, 'built/tool', await key())), false);
    toolchains = saved;
    const fetched = await ensure({}, '--fetch-only');
    assert.match(fetched.r.err, /downloading/);
});

test("another commit's toolchain is assembled only when it has every output this commit declares", async () => {
    const { dir } = await ensure();
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 5; }\n');
    commit('compiler 5');
    const out = path.join(root, 'out-other');
    const strict = await toolchain({}, 'assemble', 'tool', dir, out);
    assert.notEqual(strict.code, 0);
    assert.match(strict.err, /toolchain\.json names the inputs "[0-9a-f]{40}", not [0-9a-f]{40}/);
    assert.equal(fs.existsSync(out), false);

    const allowed = await toolchain({ ALLOW_OTHER_TOOLCHAIN: '1' }, 'assemble', 'tool', dir, out);
    assert.equal(allowed.code, 0, allowed.err);
    assert.match(allowed.err, /warning: tool: assembling over the toolchain [0-9a-f]{40}, not this commit's [0-9a-f]{40}/);
    assert.equal(JSON.parse(fs.readFileSync(sidecar, 'utf8')).otherToolchain, true);

    put('light/packs/tool/toolchain.outputs', 'bin/cc\nversions.json\nlib/libcc.a\n');
    commit('a new output');
    const lacking = await toolchain({ ALLOW_OTHER_TOOLCHAIN: '1' }, 'assemble', 'tool', dir, path.join(root, 'out-lacking'));
    assert.notEqual(lacking.code, 0);
    assert.match(lacking.err, /match no non-empty file in .*:\n {2}lib\/libcc\.a/);
    assert.equal(fs.existsSync(path.join(root, 'out-lacking')), false);

    put('light/packs/tool/toolchain.outputs', 'bin/cc\nversions.json\n');
    put('light/packs/tool/glue.sh', GLUE_SH('ld'), 0o755);
    commit('glue reads the version of ld');
    const versions = await toolchain({ ALLOW_OTHER_TOOLCHAIN: '1' }, 'assemble', 'tool', dir, path.join(root, 'out-versions'));
    assert.notEqual(versions.code, 0);
    assert.match(versions.err, /the toolchain's versions\.json has no ld/);
    assert.match(versions.err, /the glue's versions check refuses the toolchain/);
    put('light/packs/tool/glue.sh', GLUE_SH(), 0o755);
    commit('glue reads the version of cc');
});

test('a pack assembled by an uncommitted assembly script is not recorded as current', async () => {
    const { dir } = await ensure({}, '--no-fetch');
    assert.equal((await toolchain({}, 'assemble', 'tool', dir, path.join(root, 'out-state'))).code, 0);
    const r = await toolchain({}, 'record-state', 'tool');
    assert.equal(r.code, 0, r.err);
    const [tree, script, env, k] = r.out.trim().split(' ');
    assert.equal(tree, git('rev-parse', 'HEAD:light/packs/tool'));
    assert.equal(script, git('rev-parse', 'HEAD:light/scripts/pack-toolchain.sh'));
    assert.equal(env, git('rev-parse', 'HEAD:light/scripts/toolchain-env.sh'));
    assert.equal(k, await key());

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
    assert.equal((await toolchain({}, 'ensure', 'tool', '--fetch-only')).code, 3);
    const { dir: any, r } = await ensure({}, '--any', '--fetch-only');
    assert.equal(any, dir);
    assert.match(r.err, new RegExp(`${any} is not this commit's toolchain \\(that is ${await key()}\\); assemble it with ALLOW_OTHER_TOOLCHAIN=1`));
    const a = await toolchain({ ALLOW_OTHER_TOOLCHAIN: '1' }, 'assemble', 'tool', any, path.join(root, 'out-any'));
    assert.equal(a.code, 0, a.err);
});
