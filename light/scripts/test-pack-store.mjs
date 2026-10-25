// Tests of pack-store.sh, which light/setup.sh and every light-packs.yml job
// rely on, against a server of its own that answers like GitHub's releases
// API: a throwaway git repository laid out like this one (light/scripts,
// light/packs/demo, and the split packs light/packs/tool and
// light/packs/other) gets a copy of the script and of toolchain-env.sh, and
// the stores hold archives made here. The pack store's `publish` writes to
// GitHub and is exercised by light-packs.yml itself; `toolchain-publish`
// runs here against a stand-in `gh` that writes to the same server.
//
//   node --test scripts/test-pack-store.mjs   (from light/; needs git, tar, zstd)
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-store-test-'));
const light = path.join(root, 'light');
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

/** Commits packs/demo with `content` in its build.sh, and returns its tree id. */
function commitDemo(content) {
    fs.writeFileSync(path.join(light, 'packs/demo/build.sh'), content);
    git('add', '-A');
    git('commit', '-q', '-m', content);
    return git('rev-parse', 'HEAD:light/packs/demo');
}

/** A store archive of a demo pack whose server.js says `marker`. */
function archive(marker, { serverJs = true } = {}) {
    const dir = fs.mkdtempSync(path.join(root, 'out-'));
    fs.mkdirSync(path.join(dir, 'demo'));
    if (serverJs) fs.writeFileSync(path.join(dir, 'demo/server.js'), `// ${marker}\n`);
    fs.writeFileSync(path.join(dir, 'demo/runner.js'), '');
    const file = path.join(dir, 'a.tar.zst');
    execFileSync('tar', ['--zstd', '-cf', file, '-C', dir, 'demo']);
    return fs.readFileSync(file);
}

// The releases the server answers with: asset name -> { bytes, created, digest }.
let assets = new Map();
let releaseExists = true;
let toolchains = new Map();
let toolchainsExist = true;
/** Every command the stand-in `gh` was run with, as its arguments. */
const ghCalls = [];
const release = (tag) =>
    tag === 'light-packs' ? { exists: releaseExists, assets } : tag === 'light-toolchains' ? { exists: toolchainsExist, assets: toolchains } : { exists: false, assets: new Map() };

/** What `gh release view|create|upload|delete-asset <tag> …` does to the releases. */
function gh(args) {
    ghCalls.push(args);
    const [group, verb, tag] = args;
    const r = release(tag);
    if (group !== 'release') return { code: 2, err: `stand-in gh: no ${group}\n` };
    if (verb === 'view') return r.exists ? { code: 0, out: `${tag}\n` } : { code: 1, err: 'release not found\n' };
    if (verb === 'create') {
        if (tag === 'light-toolchains') toolchainsExist = true;
        return { code: 0 };
    }
    if (verb === 'upload') {
        if (!r.exists) return { code: 1, err: 'release not found\n' };
        const file = args[3];
        r.assets.set(path.basename(file), { bytes: fs.readFileSync(file), created: new Date().toISOString() });
        return { code: 0 };
    }
    if (verb === 'delete-asset') {
        r.assets.delete(args[3]);
        return { code: 0 };
    }
    return { code: 2, err: `stand-in gh: no release ${verb}\n` };
}

const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const tag = /^\/repos\/test\/repo\/releases\/tags\/([^/]+)$/.exec(req.url)?.[1];
    if (tag) {
        const r = release(tag);
        if (!r.exists) return res.writeHead(404).end(JSON.stringify({ message: 'Not Found', status: '404' }));
        const list = [...r.assets].map(([name, a]) => ({
            name,
            created_at: a.created,
            digest: a.digest ?? `sha256:${createHash('sha256').update(a.bytes).digest('hex')}`,
            browser_download_url: `${base}/download/${tag}/${name}`,
        }));
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ assets: list }));
    }
    if (req.url === '/gh' && req.method === 'POST') {
        let body = '';
        req.on('data', (d) => (body += d)).on('end', () => res.writeHead(200).end(JSON.stringify(gh(JSON.parse(body)))));
        return;
    }
    const [, dtag, name] = /^\/download\/([^/]+)\/(.+)$/.exec(req.url) ?? [];
    const asset = dtag && release(dtag).assets.get(name);
    if (!asset) return res.writeHead(404).end();
    res.writeHead(200).end(asset.bytes);
});

/** Runs pack-store.sh; asynchronously, as the server answering it is in this process. */
function store(...args) {
    return storeWith({}, ...args);
}

/** Runs pack-store.sh with `vars` added to its environment (undefined removes one). */
function storeWith(vars, ...args) {
    const env = {
        ...process.env,
        LIGHT_PACKS_REPO: 'test/repo',
        LIGHT_PACKS_API: `http://127.0.0.1:${server.address().port}`,
        GH_TOKEN: '',
        FAKE_GH: `http://127.0.0.1:${server.address().port}/gh`,
        PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
        TOOLCHAIN_CACHE: path.join(root, 'cache'),
    };
    for (const name of ['OPT', 'MIRROR', 'UNDECLARED', 'LIGHT_TOOLCHAINS_TAG', 'GITHUB_ACTIONS']) delete env[name];
    for (const [name, value] of Object.entries(vars)) {
        if (value === undefined) delete env[name];
        else env[name] = value;
    }
    return new Promise((done) => {
        const child = spawn(path.join(light, 'scripts/pack-store.sh'), args, { env });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.on('close', (code) => done({ code, out, err }));
    });
}
const served = () => fs.readFileSync(path.join(light, 'app/static/packs/demo/server.js'), 'utf8');
const stamp = () => fs.readFileSync(path.join(light, '.pack-trees/demo'), 'utf8').trim();

/** Writes `content` to the repository path `rel`, making its directory. */
function put(rel, content, mode = 0o644) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    fs.chmodSync(file, mode);
}
/** Commits everything, and returns HEAD. */
function commit(message) {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD');
}
/** Puts the worktree back to HEAD, keeping what .gitignore names (built packs). */
function clean() {
    git('reset', '-q', '--hard');
    git('clean', '-fdq');
}
/** The toolchain key of `pack` in an environment with `vars`; asserts it is one. */
async function key(pack = 'tool', vars = {}) {
    const r = await storeWith(vars, 'toolchain-key', pack);
    assert.equal(r.code, 0, r.err);
    const k = r.out.trim();
    assert.match(k, /^[0-9a-f]{40}$/);
    return k;
}
/** The toolchain.json fields listing `files` (path -> content), as a build writes them. */
const listing = (files) => ({
    format: 1,
    knobs: {},
    built: '2026-10-01T00:00:00.000Z',
    files: Object.entries(files)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([p, content]) => ({ path: p, size: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'), mtime: '0.000000000' })),
    links: [],
});
/** A toolchain archive of `files` whose toolchain.json is their listing with `manifest` over it. */
function toolchainArchive(manifest, files = { 'bin/cc': '#!/bin/sh\necho cc\n' }) {
    const dir = fs.mkdtempSync(path.join(root, 'tc-'));
    for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
    }
    fs.writeFileSync(path.join(dir, 'toolchain.json'), JSON.stringify({ ...listing(files), ...manifest }));
    const file = `${dir}.tar.zst`;
    execFileSync('tar', ['--zstd', '-cf', file, '-C', dir, '.']);
    const bytes = fs.readFileSync(file);
    fs.rmSync(dir, { recursive: true });
    fs.rmSync(file);
    return bytes;
}
/** A built toolchain directory of `pack` with `manifest` fields over HEAD's own. */
async function builtToolchain(manifest = {}) {
    const dir = fs.mkdtempSync(path.join(root, 'built-'));
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin/cc'), '#!/bin/sh\n');
    const m = { ...listing({ 'bin/cc': '#!/bin/sh\n' }), pack: 'tool', key: await key(), commit: git('rev-parse', 'HEAD'), ...manifest };
    m.files[0].mtime = execFileSync('stat', ['-c', '%.9Y', path.join(dir, 'bin/cc')], { encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(dir, 'toolchain.json'), JSON.stringify(m));
    return dir;
}
const exists = (rel) => fs.existsSync(path.join(root, rel));

before(async () => {
    fs.mkdirSync(path.join(light, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(light, 'packs/demo'), { recursive: true });
    for (const name of ['pack-store.sh', 'toolchain-env.sh', 'toolchain-manifest.mjs']) fs.copyFileSync(path.join(SCRIPTS, name), path.join(light, 'scripts', name));
    // The stand-in gh: hands its arguments to the server and answers as it says.
    put(
        'bin/gh',
        `#!/usr/bin/env node
fetch(process.env.FAKE_GH, { method: 'POST', body: JSON.stringify(process.argv.slice(2)) })
    .then((r) => r.json())
    .then((r) => { process.stdout.write(r.out ?? ''); process.stderr.write(r.err ?? ''); process.exit(r.code); });
`,
        0o755,
    );
    put('.gitignore', '/bin/\n/cache/\n/tc-*\n/built-*\n/fetched*\n/out-*\n/light/app/static/packs/\n/light/.pack-trees/\n');
    // A split pack whose glue is src/glue.js, and one that is all toolchain.
    put('light/packs/tool/toolchain.paths', '# The compiler is built from the whole pack but its glue.\nlight/packs/tool\n\n:(exclude)light/packs/tool/src/glue.js\n');
    put('light/packs/tool/toolchain.env', '# What reaches the build.\nOPT variant  # the optimisation level: another compiler\nMIRROR source  # where sources come from; the same bytes\n');
    put('light/packs/tool/toolchain.sh', '#!/bin/sh\nmake cc\n', 0o755);
    put('light/packs/tool/toolchain.outputs', 'bin/cc\n');
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 0; }\n');
    put('light/packs/tool/src/glue.js', 'export const glue = 1;\n');
    put('light/packs/tool/glue.sh', '#!/bin/sh\ncp src/glue.js out/\n', 0o755);
    put('light/packs/tool/build.sh', '#!/bin/sh\n', 0o755);
    put('light/packs/tool/requires.json', '{}\n');
    put('light/packs/other/toolchain.paths', 'light/packs/other\n');
    put('light/packs/other/toolchain.sh', '#!/bin/sh\n', 0o755);
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
});
after(() => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
});

test('a pack is fetched from the build of exactly the sources checked out, and its tree recorded', async () => {
    const old = commitDemo('# one\n');
    const tree = commitDemo('# two\n');
    assets = new Map([
        [`demo-${old}.tar.zst`, { bytes: archive('old'), created: '2026-10-01T00:00:00Z' }],
        [`demo-${tree}.tar.zst`, { bytes: archive('current'), created: '2026-09-01T00:00:00Z' }],
    ]);
    assert.equal((await store('tree', 'demo')).out.trim(), tree);
    const r = await store('fetch', 'demo');
    assert.equal(r.code, 0, r.err);
    assert.equal(served(), '// current\n');
    assert.equal(stamp(), tree);
});

test('has says whether the store holds a build of the sources checked out, without downloading it', async () => {
    const tree = commitDemo('# has\n');
    assets.delete(`demo-${tree}.tar.zst`);
    assert.equal((await store('has', 'demo')).code, 3);
    assets.set(`demo-${tree}.tar.zst`, { bytes: archive('has'), created: '2026-08-01T00:00:00Z' });
    const before = served();
    const r = await store('has', 'demo');
    assert.equal(r.code, 0, r.err);
    assert.equal(served(), before);
});

test('sources with no build yet exit 3 and leave the pack in place, unless --any takes the newest build', async () => {
    commitDemo('# three\n');
    const before = served();
    const r = await store('fetch', 'demo');
    assert.equal(r.code, 3, r.err);
    assert.match(r.err, /no demo-[0-9a-f]{40}\.tar\.zst in test\/repo's light-packs release/);
    assert.equal(served(), before);

    const any = await store('fetch', 'demo', '--any');
    assert.equal(any.code, 0, any.err);
    assert.match(any.err, /no build of these sources yet, taking the newest/);
    assert.equal(served(), '// old\n'); // created 2026-10-01, the newest
});

test('a download that does not match its recorded sha256 is refused, and the pack left in place', async () => {
    const tree = commitDemo('# four\n');
    assets.set(`demo-${tree}.tar.zst`, { bytes: archive('tampered'), created: '2026-10-02T00:00:00Z', digest: `sha256:${'0'.repeat(64)}` });
    const before = served();
    const r = await store('fetch', 'demo');
    assert.notEqual(r.code, 0);
    assert.match(r.err, /sha256 mismatch/);
    assert.equal(served(), before);
});

test('an archive without the pack\'s server.js is refused', async () => {
    const tree = commitDemo('# five\n');
    assets.set(`demo-${tree}.tar.zst`, { bytes: archive('x', { serverJs: false }), created: '2026-10-03T00:00:00Z' });
    const r = await store('fetch', 'demo');
    assert.notEqual(r.code, 0);
    assert.match(r.err, /holds no demo\/server\.js/);
});

test('a store whose release does not exist yet has no build of anything: exit 3', async () => {
    releaseExists = false;
    const r = await store('fetch', 'demo');
    releaseExists = true;
    assert.equal(r.code, 3, r.err);
});

// ---- Toolchains of split packs ----------------------------------------

test("a toolchain's key does not change when only its glue changes", async () => {
    commit('toolchains');
    const before = await key();
    put('light/packs/tool/src/glue.js', 'export const glue = 2;\n');
    put('light/packs/tool/glue.sh', '#!/bin/sh\necho more glue\n', 0o755);
    put('light/packs/tool/build.sh', '#!/bin/sh\necho build\n', 0o755);
    put('light/packs/tool/requires.json', '{"runner":{}}\n');
    put('light/packs/tool/toolchain.outputs', 'bin/cc\nbin/ld\n');
    assert.equal(await key(), before);
    commit('glue');
    assert.equal(await key(), before);
});

test("adding a new glue file together with its exclusion keeps the toolchain's key", async () => {
    const before = await key();
    put('light/packs/tool/src/more-glue.js', 'export {};\n');
    // Unclassified, a new file is an input: a rebuild, never a stale toolchain.
    assert.notEqual(await key(), before);
    fs.appendFileSync(path.join(root, 'light/packs/tool/toolchain.paths'), ':(exclude)light/packs/tool/src/more-glue.js\n');
    assert.equal(await key(), before);
    commit('more glue');
    assert.equal(await key(), before);
});

test("a toolchain's key changes when an input, its mode, or the set of inputs changes", async () => {
    const keys = [await key()];
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 1; }\n');
    keys.push(await key());
    fs.chmodSync(path.join(root, 'light/packs/tool/src/compiler.c'), 0o755);
    keys.push(await key());
    put('light/packs/tool/src/opt.c', 'int opt;\n');
    keys.push(await key());
    fs.symlinkSync('opt.c', path.join(root, 'light/packs/tool/src/opt-link.c'));
    keys.push(await key());
    assert.equal(new Set(keys).size, keys.length, keys.join(' '));
    fs.rmSync(path.join(root, 'light/packs/tool/src/opt-link.c'));
    fs.rmSync(path.join(root, 'light/packs/tool/src/opt.c'));
    assert.equal(await key(), keys[2]);
    clean();
    assert.equal(await key(), keys[0]);
});

test("changing the toolchain build environment changes every toolchain's key, and changing assembly changes none", async () => {
    const before = [await key('tool'), await key('other')];
    put('light/scripts/pack-toolchain.sh', '#!/bin/sh\n# assembly\n', 0o755);
    commit('assembly');
    assert.deepEqual([await key('tool'), await key('other')], before);
    fs.appendFileSync(path.join(light, 'scripts/toolchain-env.sh'), '# another build environment\n');
    const after = [await key('tool'), await key('other')];
    assert.notEqual(after[0], before[0]);
    assert.notEqual(after[1], before[1]);
    clean();
});

test('an output-changing setting gives another key, and a setting the pack does not declare does not', async () => {
    const plain = await key();
    const o2 = await key('tool', { OPT: '2' });
    const o3 = await key('tool', { OPT: '3' });
    assert.equal(new Set([plain, o2, o3]).size, 3);
    assert.equal(await key('tool', { MIRROR: 'https://mirror.example' }), plain);
    assert.equal(await key('tool', { UNDECLARED: '1' }), plain);
    // `other` declares no settings at all.
    assert.equal(await key('other', { OPT: '2' }), await key('other'));
});

test('a malformed toolchain setting is named, and no key is given', async () => {
    fs.appendFileSync(path.join(root, 'light/packs/tool/toolchain.env'), 'lto variant\nJOBS sometimes  # how many\n');
    const r = await store('toolchain-key', 'tool');
    assert.notEqual(r.code, 0);
    assert.equal(r.out, '');
    assert.match(r.err, /toolchain\.env:4: 'lto variant' is not 'NAME source\|variant {2}# why'/);
    assert.match(r.err, /toolchain\.env:5: 'JOBS sometimes {2}# how many'/);
    clean();
});

test('a toolchain input list naming a file that is not there is refused', async () => {
    fs.appendFileSync(path.join(root, 'light/packs/tool/toolchain.paths'), 'light/packs/tool/no-such-dir\n');
    const r = await store('toolchain-key', 'tool');
    assert.notEqual(r.code, 0);
    assert.match(r.err, /toolchain\.paths:6: 'light\/packs\/tool\/no-such-dir' matches no file/);
    put('light/packs/tool/toolchain.paths', ':(exclude)light/packs/tool/src/glue.js\n');
    const only = await store('toolchain-key', 'tool');
    assert.notEqual(only.code, 0);
    assert.match(only.err, /names no input, only exclusions/);
    clean();
});

test('an uncommitted edit to an input gives another key, and the committed one equals the key from the index', async () => {
    const before = await key();
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 2; }\n');
    const edited = await key();
    assert.notEqual(edited, before);
    git('add', 'light/packs/tool/src/compiler.c');
    assert.equal(await key(), edited);
    commit('compiler 2');
    assert.equal(await key(), edited);
});

test("an uncommitted edit to a pack's glue.sh, build.sh or requires.json leaves its toolchain clean", async () => {
    const before = await key();
    put('light/packs/tool/glue.sh', '#!/bin/sh\necho edited\n', 0o755);
    put('light/packs/tool/build.sh', '#!/bin/sh\necho edited\n', 0o755);
    put('light/packs/tool/requires.json', '{"edited":true}\n');
    put('light/packs/tool/src/glue.js', 'export const edited = true;\n');
    const r = await store('toolchain-dirty', 'tool');
    assert.equal(r.code, 1, r.out + r.err);
    assert.equal(r.out, '');
    assert.equal(await key(), before);
    clean();
});

test('a dirty toolchain names the files that make it dirty', async () => {
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 3; }\n');
    put('light/packs/tool/src/extra.c', 'int extra;\n');
    put('light/packs/tool/src/glue.js', 'export const edited = true;\n');
    const r = await store('toolchain-dirty', 'tool');
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.out.trim().split('\n').sort(), ['light/packs/tool/src/compiler.c', 'light/packs/tool/src/extra.c']);
    clean();
    assert.equal((await store('toolchain-dirty', 'tool')).code, 1);
});

test('a pack without a toolchain keeps its tree as its key', async () => {
    const r = await store('toolchain-key', 'demo');
    assert.equal(r.code, 2);
    assert.match(r.err, /demo has no toolchain \(packs\/demo\/toolchain\.paths\): its tree is its key/);
    assert.equal((await store('tree', 'demo')).out.trim(), git('rev-parse', 'HEAD:light/packs/demo'));
    assert.equal((await store('toolchain-dirty', 'demo')).code, 2);
});

test('a split pack is never put in the pack store', async () => {
    assets.set(`tool-${git('rev-parse', 'HEAD:light/packs/tool')}.tar.zst`, { bytes: archive('tool'), created: '2026-10-01T00:00:00Z' });
    for (const command of ['has', 'fetch', 'publish']) {
        const r = await store(command, 'tool');
        assert.equal(r.code, 2, `${command}: ${r.err}`);
        assert.match(r.err, /tool: split pack: fetch its toolchain and assemble \(pack-toolchain\.sh\)/);
    }
    assert.equal(exists('light/app/static/packs/tool'), false);
});

test("a pack's toolchain key report names the file that changed it", async () => {
    const base = git('rev-parse', 'HEAD');
    const baseKey = await key();
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 4; }\n');
    put('light/packs/tool/src/glue.js', 'export const glue = 4;\n');
    commit('compiler 4');
    const r = await store('toolchain-key-report', 'tool', base);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^M\tlight\/packs\/tool\/src\/compiler\.c$/m);
    assert.doesNotMatch(r.out, /glue\.js/);
    assert.equal(r.out.trim().split('\n').at(-1), 'changed');

    const glueBase = git('rev-parse', 'HEAD');
    put('light/packs/tool/src/glue.js', 'export const glue = 5;\n');
    commit('glue 5');
    const glue = await store('toolchain-key-report', 'tool', glueBase);
    assert.equal(glue.code, 0, glue.err);
    assert.doesNotMatch(glue.out, /^[AMDR]/m);
    assert.equal(glue.out.trim().split('\n').at(-1), 'unchanged');

    // toolchain.paths is no input of itself: the report shows both keys.
    const pathsBase = git('rev-parse', 'HEAD');
    const pathsKey = await key();
    fs.appendFileSync(path.join(root, 'light/packs/tool/toolchain.paths'), ':(exclude)light/packs/tool/toolchain.sh\n');
    commit('toolchain.sh is glue now');
    const paths = await store('toolchain-key-report', 'tool', pathsBase);
    assert.equal(paths.code, 0, paths.err);
    assert.match(paths.out, new RegExp(`^old key: ${pathsKey}$`, 'm'));
    assert.match(paths.out, new RegExp(`^new key: ${await key()}$`, 'm'));
    assert.match(paths.out, /^M\tlight\/packs\/tool\/toolchain\.paths$/m);
    assert.equal(paths.out.trim().split('\n').at(-1), 'changed');

    // A newly declared setting shows as env lines then and now.
    const envBase = git('rev-parse', 'HEAD');
    fs.appendFileSync(path.join(root, 'light/packs/tool/toolchain.env'), 'LTO variant  # link-time optimisation: another compiler\n');
    commit('LTO');
    const env = await storeWith({ LTO: '1' }, 'toolchain-key-report', 'tool', envBase);
    assert.equal(env.code, 0, env.err);
    assert.match(env.out, /^old env: \(none\)$/m);
    assert.match(env.out, /^new env: env LTO=1$/m);
    assert.match(env.out, /^M\tlight\/packs\/tool\/toolchain\.env$/m);
    assert.equal(env.out.trim().split('\n').at(-1), 'changed');
    assert.notEqual(baseKey, await key());
});

test('a key report against a commit the clone does not have says so', async () => {
    const missing = 'f'.repeat(40);
    const r = await store('toolchain-key-report', 'tool', missing);
    assert.equal(r.code, 6);
    assert.match(r.err, new RegExp(`base commit ${missing} is not in this clone; fetch it first`));
});

test('no toolchain for these inputs exits 3', async () => {
    toolchains = new Map();
    assert.equal((await store('toolchain-has', 'tool')).code, 3);
    const r = await store('toolchain-fetch', 'tool');
    assert.equal(r.code, 3);
    assert.match(r.err, /no toolchain-tool-[0-9a-f]{40}\.tar\.zst in test\/repo's light-toolchains release/);
    toolchainsExist = false;
    assert.equal((await store('toolchain-fetch', 'tool')).code, 3);
    toolchainsExist = true;
    assert.equal(exists(`cache/built/tool`), false);
});

test('a toolchain is fetched for exactly its inputs, read-only, with each file recorded', async () => {
    const k = await key();
    const commitId = git('rev-parse', 'HEAD');
    toolchains = new Map([[`toolchain-tool-${k}.tar.zst`, { bytes: toolchainArchive({ pack: 'tool', key: k, commit: commitId }), created: '2026-10-01T00:00:00Z' }]]);
    const has = await store('toolchain-has', 'tool');
    assert.equal(has.code, 0, has.err);
    assert.equal(exists(`cache/built/tool/${k}`), false);
    const r = await store('toolchain-fetch', 'tool');
    assert.equal(r.code, 0, r.err);
    const dir = path.join(root, `cache/built/tool/${k}`);
    assert.equal(r.out.trim(), dir);
    assert.equal(fs.readFileSync(path.join(dir, 'bin/cc'), 'utf8'), '#!/bin/sh\necho cc\n');
    assert.equal(fs.statSync(path.join(dir, 'bin/cc')).mode & 0o222, 0);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'toolchain.json'), 'utf8'));
    const [size, mtime] = execFileSync('stat', ['-c', '%s %.9Y', path.join(dir, 'bin/cc')], { encoding: 'utf8' }).trim().split(' ');
    assert.deepEqual(
        manifest.files.map((f) => [f.path, f.size, f.mtime]),
        [['bin/cc', Number(size), mtime]],
    );
    assert.equal(exists(`cache/built/tool/${k}.part`), false);
    // Fetching again replaces the read-only copy.
    const again = await store('toolchain-fetch', 'tool');
    assert.equal(again.code, 0, again.err);
});

test('a fetched toolchain is refused when its manifest names other inputs or other files', async () => {
    const k = await key();
    const commitId = git('rev-parse', 'HEAD');
    const target = path.join(root, 'fetched-other');
    for (const [manifest, why] of [
        [{ pack: 'tool', key: 'e'.repeat(40), commit: commitId }, /toolchain\.json names the inputs "e{40}", not [0-9a-f]{40}/],
        [{ pack: 'other', key: k, commit: commitId }, /toolchain\.json is of pack "other", not tool/],
        [{ pack: 'tool', key: k, commit: 'HEAD' }, /toolchain\.json names no commit/],
        [{ pack: 'tool', key: k, commit: 'dirty' }, /a dirty toolchain is never stored/],
        [{ pack: 'tool', key: k, commit: commitId, files: [] }, /bin\/cc is not listed in toolchain\.json/],
        [{ pack: 'tool', key: k, commit: commitId, files: listing({ 'bin/cc': 'other bytes\n' }).files }, /bin\/cc is \d+ bytes, not the \d+ listed/],
        [{ pack: 'tool', key: k, commit: commitId, files: listing({ 'bin/cc': '#!/bin/sh\necho CC\n' }).files }, /bin\/cc does not have the sha256 listed/],
    ]) {
        toolchains = new Map([[`toolchain-tool-${k}.tar.zst`, { bytes: toolchainArchive(manifest), created: '2026-10-01T00:00:00Z' }]]);
        const r = await store('toolchain-fetch', 'tool', target);
        assert.notEqual(r.code, 0);
        assert.match(r.err, why);
        assert.equal(fs.existsSync(target), false);
        assert.equal(fs.existsSync(`${target}.part`), false);
    }
});

test('a download that does not match its recorded sha256 is refused', async () => {
    const k = await key();
    toolchains = new Map([
        [
            `toolchain-tool-${k}.tar.zst`,
            { bytes: toolchainArchive({ pack: 'tool', key: k, commit: git('rev-parse', 'HEAD') }), created: '2026-10-01T00:00:00Z', digest: `sha256:${'0'.repeat(64)}` },
        ],
    ]);
    const target = path.join(root, 'fetched-tampered');
    const r = await store('toolchain-fetch', 'tool', target);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /sha256 mismatch/);
    assert.equal(fs.existsSync(target), false);
});

test('asking for any toolchain fetches the newest and says which', async () => {
    const [older, newer, current] = ['1', '2', await key()].map((c) => (c.length === 40 ? c : c.repeat(40)));
    const commitId = git('rev-parse', 'HEAD');
    toolchains = new Map([
        [`toolchain-tool-${older}.tar.zst`, { bytes: toolchainArchive({ pack: 'tool', key: older, commit: commitId }, { 'which': 'older' }), created: '2026-10-01T00:00:00Z' }],
        [`toolchain-tool-${newer}.tar.zst`, { bytes: toolchainArchive({ pack: 'tool', key: newer, commit: commitId }, { 'which': 'newer' }), created: '2026-10-05T00:00:00Z' }],
        [`toolchain-other-${'3'.repeat(40)}.tar.zst`, { bytes: toolchainArchive({ pack: 'other', key: '3'.repeat(40), commit: commitId }), created: '2026-10-09T00:00:00Z' }],
    ]);
    assert.equal((await store('toolchain-fetch', 'tool')).code, 3, `no ${current} yet`);
    const target = path.join(root, 'fetched-any');
    const r = await store('toolchain-fetch', 'tool', '--any', target);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, new RegExp(`taking the newest toolchain, ${newer}`));
    assert.equal(fs.readFileSync(path.join(target, 'which'), 'utf8'), 'newer');

    // The manifest must still be the one its name says.
    toolchains.set(`toolchain-tool-${'4'.repeat(40)}.tar.zst`, {
        bytes: toolchainArchive({ pack: 'tool', key: newer, commit: commitId }),
        created: '2026-10-07T00:00:00Z',
    });
    const wrong = await store('toolchain-fetch', 'tool', '--any', path.join(root, 'fetched-any-wrong'));
    assert.notEqual(wrong.code, 0);
    assert.match(wrong.err, /names the inputs/);
});

test('a toolchain built from uncommitted inputs or a changed setting is never published', async () => {
    toolchains = new Map();
    ghCalls.length = 0;
    const built = await builtToolchain();
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 6; }\n');
    const dirty = await store('toolchain-publish', 'tool', built);
    assert.notEqual(dirty.code, 0);
    assert.match(dirty.err, /not publishing a toolchain built from uncommitted inputs:\nlight\/packs\/tool\/src\/compiler\.c/);
    clean();

    const setting = await storeWith({ OPT: '3' }, 'toolchain-publish', 'tool', built);
    assert.notEqual(setting.code, 0);
    assert.match(setting.err, /was built from the inputs [0-9a-f]{40}, but HEAD's inputs and settings give [0-9a-f]{40}/);

    const elsewhere = await store('toolchain-publish', 'tool', await builtToolchain({ commit: 'a'.repeat(40) }));
    assert.notEqual(elsewhere.code, 0);
    assert.match(elsewhere.err, /was built at a{40}, not at HEAD/);

    assert.deepEqual(ghCalls, []);
    assert.equal(toolchains.size, 0);
});

test('publishing a toolchain never removes another, and a full release is refused by name', async () => {
    toolchains = new Map();
    toolchainsExist = false;
    ghCalls.length = 0;
    const first = await store('toolchain-publish', 'tool', await builtToolchain());
    assert.equal(first.code, 0, first.err);
    const create = ghCalls.find(([, verb]) => verb === 'create');
    assert.ok(create?.includes('--prerelease') && create.includes('--latest=false'), JSON.stringify(create));
    const name = `toolchain-tool-${await key()}.tar.zst`;
    assert.ok(toolchains.has(name));
    // What was stored is the toolchain, manifest included.
    const out = fs.mkdtempSync(path.join(root, 'out-'));
    fs.writeFileSync(path.join(out, 'a.tar.zst'), toolchains.get(name).bytes);
    execFileSync('tar', ['--zstd', '-xf', path.join(out, 'a.tar.zst'), '-C', out]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'toolchain.json'), 'utf8')).key, await key());

    const again = await store('toolchain-publish', 'tool', await builtToolchain());
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /is in the store already/);
    assert.equal(ghCalls.filter(([, verb]) => verb === 'upload').length, 1);

    // Nearly full: a warning naming how to evict, and nothing evicted.
    for (let i = 0; toolchains.size < 850; i++) toolchains.set(`toolchain-other-${i.toString(16).padStart(40, '0')}.tar.zst`, { bytes: Buffer.from('x'), created: '2026-09-01T00:00:00Z' });
    const kept = new Set(toolchains.keys());
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 7; }\n');
    commit('compiler 7');
    const warned = await store('toolchain-publish', 'tool', await builtToolchain());
    assert.equal(warned.code, 0, warned.err);
    assert.match(warned.err, /holds 850 of at most 1000 assets; evict toolchains no branch needs with gh release delete-asset light-toolchains <asset>/);
    for (const old of kept) assert.ok(toolchains.has(old), old);
    assert.equal(toolchains.size, 851);

    // Full: refused by name, still nothing evicted.
    for (let i = 1000; toolchains.size < 1000; i++) toolchains.set(`toolchain-other-${i.toString(16).padStart(40, '0')}.tar.zst`, { bytes: Buffer.from('x'), created: '2026-09-02T00:00:00Z' });
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 8; }\n');
    commit('compiler 8');
    const full = await store('toolchain-publish', 'tool', await builtToolchain());
    assert.notEqual(full.code, 0);
    assert.match(full.err, /holds 1000 assets, GitHub's cap of 1000; nothing is evicted automatically: remove toolchains no branch needs with gh release delete-asset light-toolchains <asset>/);
    assert.equal(toolchains.size, 1000);
    assert.deepEqual(ghCalls.filter(([, verb]) => verb === 'delete-asset'), []);
});
