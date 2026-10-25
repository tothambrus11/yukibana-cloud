// Tests of pack-store.sh, which light/setup.sh and every light-packs.yml job
// rely on, against a server of its own that answers like GitHub's releases
// API: a throwaway git repository laid out like this one (light/scripts,
// light/packs/demo, the split packs light/packs/tool and light/packs/other
// of one unit each, and a copy of the repository's own three-unit stub,
// light/packs/stub) gets a copy of the script and of the scripts it
// sources (toolchain-key.sh, toolchain-build-env.sh, pack-lib.sh), and the
// stores hold archives made here. The pack store's `publish` writes to
// GitHub and is exercised by light-packs.yml itself; `toolchain-publish`
// runs here against a stand-in `gh` that writes to the same server, and
// that answers `gh attestation verify` from attestations a test records,
// as GitHub would for what attest-build-provenance signed. The same server
// lists and serves Actions artifacts for `toolchain-artifact`.
//
//   node --test scripts/test-pack-store.mjs   (from light/; needs git, tar, zstd, zip, unzip)
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
/** The scripts a test repository gets a copy of: pack-store.sh and what it reads. */
const COPIED = ['pack-store.sh', 'toolchain-key.sh', 'toolchain-build-env.sh', 'pack-lib.sh', 'toolchain-manifest.mjs'];
/** The repository's stub pack, copied into the test repository as it is. */
const STUB = path.resolve(SCRIPTS, '../packs/stub');

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
/** The release ids the server answers with, by tag. */
const RELEASE_IDS = { 'light-packs': 1, 'light-toolchains': 2 };
/**
 * How many assets the server embeds in a release looked up by tag. GitHub
 * documents no bound on that list, so the server shortens it, as GitHub may:
 * only paging through /releases/<id>/assets sees the rest.
 */
const EMBEDDED = 3;
/** Every asset-list request the server answered, as its URL. */
const assetPages = [];
/**
 * The repository's Actions artifacts: each a zip of one file, the run's head
 * branch, and when it was made.
 * @type {Array<{ id: number, name: string, zip: Buffer, branch: string, created: string, expired?: boolean }>}
 */
let artifacts = [];
/** The ids of the artifacts downloaded. */
const artifactDownloads = [];

/** The workflow every stored toolchain's attestation must name as its signer. */
const SIGNER = 'test/repo/.github/workflows/light-toolchain-unit.yml';
/**
 * The attestations GitHub holds, by the sha256 of the file attested: each
 * the workflow that signed it and the ref its run was on.
 * @type {Map<string, Array<{ signer: string, ref: string }>>}
 */
let attestations = new Map();
/** Whether `gh auth status` says gh is signed in. */
let signedIn = false;
/** Records that `signer` attested `bytes` on `ref`, as attest-build-provenance would. */
function attest(bytes, ref = 'refs/heads/main', signer = SIGNER) {
    const sha = createHash('sha256').update(bytes).digest('hex');
    attestations.set(sha, [...(attestations.get(sha) ?? []), { signer, ref }]);
}
/** What `gh attestation verify <file> --repo R --signer-workflow W --source-ref REF --deny-self-hosted-runners` answers. */
function verify(args) {
    const opt = (name) => args[args.indexOf(name) + 1];
    if (!args.includes('--deny-self-hosted-runners') || opt('--repo') !== 'test/repo') return { code: 2, err: 'stand-in gh: verify asked without the expected flags\n' };
    const sha = createHash('sha256').update(fs.readFileSync(args[2])).digest('hex');
    const ok = (attestations.get(sha) ?? []).some((a) => a.signer === opt('--signer-workflow') && a.ref === opt('--source-ref'));
    return ok ? { code: 0, out: 'Verification succeeded!\n' } : { code: 1, err: 'Error: verifying with issuer "sigstore.dev": no matching attestation\n' };
}

/** What `gh release view|create|upload|delete-asset <tag> …`, `gh auth status` and `gh attestation verify` do. */
function gh(args) {
    ghCalls.push(args);
    const [group, verb, tag] = args;
    const r = release(tag);
    if (group === 'auth' && verb === 'status') return signedIn ? { code: 0 } : { code: 1, err: 'You are not logged into any GitHub hosts.\n' };
    if (group === 'attestation' && verb === 'verify') return verify(args);
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
    const listOf = (tag) =>
        [...release(tag).assets].map(([name, a]) => ({
            name,
            created_at: a.created,
            digest: a.digest ?? `sha256:${createHash('sha256').update(a.bytes).digest('hex')}`,
            browser_download_url: `${base}/download/${tag}/${name}`,
        }));
    const json = (body) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    // A repository whose every request is over the rate limit, as GitHub
    // answers an address that asked too often without credentials.
    if (req.url.startsWith('/repos/test/limited/')) return res.writeHead(403).end(JSON.stringify({ message: 'API rate limit exceeded for 127.0.0.1.' }));
    const tag = /^\/repos\/test\/repo\/releases\/tags\/([^/]+)$/.exec(req.url)?.[1];
    if (tag) {
        if (!release(tag).exists) return res.writeHead(404).end(JSON.stringify({ message: 'Not Found', status: '404' }));
        return json({ id: RELEASE_IDS[tag], tag_name: tag, assets: listOf(tag).slice(0, EMBEDDED) });
    }
    const page = /^\/repos\/test\/repo\/releases\/(\d+)\/assets\?(.*)$/.exec(req.url);
    if (page) {
        assetPages.push(req.url);
        const ptag = Object.keys(RELEASE_IDS).find((t) => RELEASE_IDS[t] === Number(page[1]));
        if (!ptag || !release(ptag).exists) return res.writeHead(404).end(JSON.stringify({ message: 'Not Found', status: '404' }));
        const q = new URLSearchParams(page[2]);
        const per = Math.min(Number(q.get('per_page') ?? 30), 100);
        const n = Number(q.get('page') ?? 1);
        return json(listOf(ptag).slice((n - 1) * per, n * per));
    }
    const named = /^\/repos\/test\/repo\/actions\/artifacts\?(.*)$/.exec(req.url);
    if (named) {
        const name = new URLSearchParams(named[1]).get('name');
        return json({
            total_count: 0,
            artifacts: artifacts
                .filter((a) => a.name === name)
                .map((a) => ({
                    id: a.id,
                    name: a.name,
                    expired: a.expired ?? false,
                    created_at: a.created,
                    digest: `sha256:${createHash('sha256').update(a.zip).digest('hex')}`,
                    archive_download_url: `${base}/artifact/${a.id}`,
                    workflow_run: { head_branch: a.branch },
                })),
        });
    }
    const zipped = /^\/artifact\/(\d+)$/.exec(req.url);
    if (zipped) {
        artifactDownloads.push(Number(zipped[1]));
        const a = artifacts.find((x) => x.id === Number(zipped[1]));
        if (!a || req.headers.authorization !== 'Bearer token') return res.writeHead(a ? 401 : 404).end();
        return res.writeHead(200).end(a.zip);
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
    for (const name of ['OPT', 'MIRROR', 'UNDECLARED', 'STUB_LEVEL', 'LTO', 'PROXYLESS', 'LIGHT_TOOLCHAINS_TAG', 'GITHUB_ACTIONS']) delete env[name];
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
/** The toolchain key of `unit` in an environment with `vars`; asserts it is one. */
async function key(unit = 'tool/cc', vars = {}) {
    const r = await storeWith(vars, 'toolchain-key', unit);
    assert.equal(r.code, 0, r.err);
    const k = r.out.trim();
    assert.match(k, /^[0-9a-f]{40}$/);
    return k;
}
/** The keys of the stub's three units, by unit name. */
async function stubKeys(vars = {}) {
    return { compilers: await key('stub/compilers', vars), vm: await key('stub/vm', vars), libs: await key('stub/libs', vars) };
}
/** The toolchain.json fields listing `files` (path -> content), as a build writes them. */
const listing = (files) => ({
    format: 2,
    knobs: {},
    needs: {},
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
/** A built toolchain directory of unit tool/cc with `manifest` fields over HEAD's own. */
async function builtToolchain(manifest = {}) {
    const dir = fs.mkdtempSync(path.join(root, 'built-'));
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(path.join(dir, 'bin/cc'), '#!/bin/sh\n');
    const m = { ...listing({ 'bin/cc': '#!/bin/sh\n' }), unit: 'tool/cc', key: await key(), commit: git('rev-parse', 'HEAD'), ...manifest };
    m.files[0].mtime = execFileSync('stat', ['-c', '%.9Y', path.join(dir, 'bin/cc')], { encoding: 'utf8' }).trim();
    fs.writeFileSync(path.join(dir, 'toolchain.json'), JSON.stringify(m));
    return dir;
}
const exists = (rel) => fs.existsSync(path.join(root, rel));

before(async () => {
    fs.mkdirSync(path.join(light, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(light, 'packs/demo'), { recursive: true });
    for (const name of COPIED) fs.copyFileSync(path.join(SCRIPTS, name), path.join(light, 'scripts', name));
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
    put('.gitignore', '/bin/\n/bin-without-*/\n/cache/\n/tc-*\n/built-*\n/fetched*\n/out-*\n/light/app/static/packs/\n/light/.pack-trees/\n');
    // A split pack of one unit, cc, built from its own directory and the
    // pack file src/compiler.c; its glue is everything else.
    put('light/packs/tool/toolchains/cc/paths', '# The compiler is built from its source, besides this directory.\nsrc/compiler.c\n');
    put('light/packs/tool/toolchains/cc/env', '# What reaches the build.\nOPT variant  # the optimisation level: another compiler\nMIRROR source  # where sources come from; the same bytes\n');
    put('light/packs/tool/toolchains/cc/toolchain.sh', '#!/bin/sh\nmake cc\n', 0o755);
    put('light/packs/tool/toolchains/cc/pins.sh', 'CC_VERSION=1.0\n');
    put('light/packs/tool/toolchains/cc/outputs', 'bin/cc\n');
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 0; }\n');
    put('light/packs/tool/src/glue.js', 'export const glue = 1;\n');
    put('light/packs/tool/glue.paths', 'glue.sh\nbuild.sh\nrequires.json\nsrc/glue.js\n');
    put('light/packs/tool/glue.sh', '#!/bin/sh\ncp src/glue.js out/\n', 0o755);
    put('light/packs/tool/build.sh', '#!/bin/sh\n', 0o755);
    put('light/packs/tool/requires.json', '{}\n');
    // A split pack that is all toolchain, of one unit with no settings.
    put('light/packs/other/toolchains/main/toolchain.sh', '#!/bin/sh\n', 0o755);
    // The repository's own stub: three units, libs built with compilers.
    fs.cpSync(STUB, path.join(light, 'packs/stub'), { recursive: true });
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

// ---- Toolchain units of split packs ------------------------------------

test("a toolchain's key does not change when only its glue changes", async () => {
    commit('toolchains');
    const before = await key();
    put('light/packs/tool/src/glue.js', 'export const glue = 2;\n');
    put('light/packs/tool/glue.sh', '#!/bin/sh\necho more glue\n', 0o755);
    put('light/packs/tool/build.sh', '#!/bin/sh\necho build\n', 0o755);
    put('light/packs/tool/requires.json', '{"runner":{}}\n');
    put('light/packs/tool/toolchains/cc/outputs', 'bin/cc\nbin/ld\n');
    assert.equal(await key(), before);
    commit('glue');
    assert.equal(await key(), before);
});

test('a new pack file is an input of no unit until a unit names it in its paths', async () => {
    const before = await key();
    put('light/packs/tool/src/more-glue.js', 'export {};\n');
    // In no key: light/packs/contract.test.mjs names it until someone owns it.
    assert.equal(await key(), before);
    fs.appendFileSync(path.join(root, 'light/packs/tool/toolchains/cc/paths'), 'src/more-glue.js\n');
    const named = await key();
    assert.notEqual(named, before);
    put('light/packs/tool/src/more-glue.js', 'export const more = 1;\n');
    assert.notEqual(await key(), named);
    clean();
    assert.equal(await key(), before);
});

test("a toolchain's key changes when an input, its mode, or the set of inputs changes", async () => {
    const keys = [await key()];
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 1; }\n');
    keys.push(await key());
    fs.chmodSync(path.join(root, 'light/packs/tool/src/compiler.c'), 0o755);
    keys.push(await key());
    put('light/packs/tool/toolchains/cc/opt.c', 'int opt;\n');
    keys.push(await key());
    fs.symlinkSync('opt.c', path.join(root, 'light/packs/tool/toolchains/cc/opt-link.c'));
    keys.push(await key());
    assert.equal(new Set(keys).size, keys.length, keys.join(' '));
    fs.rmSync(path.join(root, 'light/packs/tool/toolchains/cc/opt-link.c'));
    fs.rmSync(path.join(root, 'light/packs/tool/toolchains/cc/opt.c'));
    assert.equal(await key(), keys[2]);
    clean();
    assert.equal(await key(), keys[0]);
});

test('changing the compilers unit changes the libs key, and changing a framework pin changes only libs', async () => {
    const before = await stubKeys();
    put('light/packs/stub/compiler/cc.sh', '#!/bin/sh\necho another compiler\ncat "$1"\n', 0o755);
    const compilers = await stubKeys();
    assert.notEqual(compilers.compilers, before.compilers);
    assert.notEqual(compilers.libs, before.libs);
    clean();
    put('light/packs/stub/toolchains/libs/pins.sh', '# The libs unit\'s pins.\nFRAMEWORK_VERSION=3.1\n');
    const pin = await stubKeys();
    assert.equal(pin.compilers, before.compilers);
    assert.equal(pin.vm, before.vm);
    assert.notEqual(pin.libs, before.libs);
    clean();
});

test('a change to the compilers re-keys libs but not vm', async () => {
    const before = await stubKeys();
    put('light/packs/stub/toolchains/compilers/pins.sh', 'CC_VERSION=2.0\n');
    const after = await stubKeys();
    assert.notEqual(after.compilers, before.compilers);
    assert.notEqual(after.libs, before.libs);
    assert.equal(after.vm, before.vm);
    // libs carries the compilers' key as a line of its own.
    const lines = execFileSync('bash', ['-c', 'source light/scripts/toolchain-key.sh; toolchain_lines stub/libs'], { cwd: root, encoding: 'utf8' });
    assert.match(lines, new RegExp(`^needs stub/compilers ${after.compilers}$`, 'm'));
    clean();
});

test("a file under toolchains/libs/ changes neither the compilers' nor vm's key", async () => {
    const before = await stubKeys();
    put('light/packs/stub/toolchains/libs/framework.c', 'int framework(void) { return 4; }\n');
    put('light/packs/stub/toolchains/libs/extra.h', '#define EXTRA 1\n');
    const after = await stubKeys();
    assert.equal(after.compilers, before.compilers);
    assert.equal(after.vm, before.vm);
    assert.notEqual(after.libs, before.libs);
    clean();
});

test('a library both units name re-keys both, and the unit built with one of them through its needs line', async () => {
    const before = await stubKeys();
    fs.appendFileSync(path.join(root, 'light/packs/stub/lib.sh'), '# a note\n');
    const after = await stubKeys();
    assert.notEqual(after.compilers, before.compilers);
    assert.notEqual(after.vm, before.vm);
    assert.notEqual(after.libs, before.libs);
    clean();
});

test('a unit cannot name a sibling unit\'s files, a path outside its pack, or a path that is not there', async () => {
    for (const [line, why] of [
        ['toolchains/compilers/pins.sh', /'toolchains\/compilers\/pins\.sh' names light\/packs\/stub\/toolchains\/compilers\/pins\.sh, under toolchains\/: .*a sibling's files are never its inputs/],
        ['*.sh', /'\*\.sh' names light\/packs\/stub\/(compiler\/cc\.sh|toolchains\/\S+), under toolchains\/|'\*\.sh' names light\/packs\/stub\/toolchains\//],
        ['../tool/src/compiler.c', /'\.\.\/tool\/src\/compiler\.c' climbs out of the pack/],
        [':(glob)**', /is not a path inside the pack/],
        ['no-such-dir', /vm\/paths:3: 'no-such-dir' matches no file/],
    ]) {
        fs.appendFileSync(path.join(root, 'light/packs/stub/toolchains/vm/paths'), `${line}\n`);
        const r = await store('toolchain-key', 'stub/vm');
        assert.notEqual(r.code, 0, line);
        assert.equal(r.out, '');
        assert.match(r.err, why);
        clean();
    }
});

test('a cycle of needs is refused by name before any key is computed', async () => {
    put('light/packs/stub/toolchains/compilers/needs', 'stub/libs  # a cycle\n');
    for (const unit of ['stub/libs', 'stub/compilers']) {
        const r = await store('toolchain-key', unit);
        assert.equal(r.code, 1, r.err);
        assert.match(r.err, /the needs of these units form a cycle, so none can be built first: stub\/(libs -> stub\/compilers -> stub\/libs|compilers -> stub\/libs -> stub\/compilers)/);
    }
    // vm needs neither, and keeps its key.
    assert.equal((await store('toolchain-key', 'stub/vm')).code, 0);
    clean();
});

test('a needs line that is no unit, the unit itself or a repeat is named', async () => {
    put('light/packs/stub/toolchains/libs/needs', 'stub/compilers\nstub/nosuch\nstub/libs\nstub/compilers\nStub/Vm\n');
    const r = await store('toolchain-key', 'stub/libs');
    assert.equal(r.code, 1);
    assert.match(r.err, /needs:2: no toolchain unit stub\/nosuch/);
    assert.match(r.err, /needs:3: stub\/libs cannot need itself/);
    assert.match(r.err, /needs:4: stub\/compilers is listed twice/);
    assert.match(r.err, /needs:5: 'Stub\/Vm' is not a toolchain unit's name/);
    clean();
});

test('a change to the build environment changes every key', async () => {
    const before = [await key('tool/cc'), await key('other/main'), ...Object.values(await stubKeys())];
    // A comment is enough: the file is keyed whole, as what reaches a build.
    fs.appendFileSync(path.join(light, 'scripts/toolchain-build-env.sh'), '# another build environment\n');
    const after = [await key('tool/cc'), await key('other/main'), ...Object.values(await stubKeys())];
    for (const [i, k] of after.entries()) assert.notEqual(k, before[i]);
    clean();
});

test('a comment or helper change in the key or store scripts leaves every toolchain key unchanged', async () => {
    const before = [await key('tool/cc'), await key('other/main'), ...Object.values(await stubKeys())];
    const now = async () => [await key('tool/cc'), await key('other/main'), ...Object.values(await stubKeys())];
    fs.appendFileSync(path.join(light, 'scripts/toolchain-key.sh'), '# a comment on how keys are made\n');
    fs.appendFileSync(path.join(light, 'scripts/pack-store.sh'), '# a comment on the store\n');
    fs.appendFileSync(path.join(light, 'scripts/pack-lib.sh'), '\n# A new shared helper.\nsay_hello() { echo hello; }\n');
    put('light/scripts/pack-toolchain.sh', '#!/bin/sh\n# assembly\n', 0o755);
    assert.deepEqual(await now(), before);
    // Nor do they make a build dirty: none of them is an input.
    const dirty = await store('toolchain-dirty', 'tool/cc');
    assert.equal(dirty.code, 1, dirty.out + dirty.err);
    commit('scripts');
    assert.deepEqual(await now(), before);
    git('reset', '-q', '--hard', 'HEAD~1');
});

/**
 * The lines the key of the golden test's unit hashes, as toolchain-key.sh
 * defines them. `<build env>` stands for toolchain-build-env.sh's blob, and
 * `<dep>` for the key of the unit it needs, which hashes the build
 * environment too: both are lines of the key but no part of how keys are
 * computed, so the build environment may change without this test
 * noticing, as it should.
 */
const GOLDEN = `yukibana-toolchain/3
unit fix/main
100644 cd911e2352e44b4e43d1e1e4b48f1fe65803c11b light/packs/fix/patches/a.diff
100644 4e610c04d58371663d95ca8237eea260b08f090c light/packs/fix/src/a.c
120000 6bc0e647512d2a0bef4f26111e484dc87df7f5ca light/packs/fix/src/link.c
100644 d8805c92f24d9461a93c9a318ab62da581e3988c light/packs/fix/src/new.c
100644 1968469e71a0313143cb6d757611d881eb321eea light/packs/fix/toolchains/main/pins.sh
100755 666656ac3528feb4be6109698f22ab4d535b0148 light/packs/fix/toolchains/main/toolchain.sh
100644 <build env> light/scripts/toolchain-build-env.sh
needs fix/base <dep>
env LEVEL=3
`;

test('a fixed unit keeps its exact key lines and key until the format tag yukibana-toolchain/N is bumped', () => {
    // toolchain-key.sh is no input of any key, so nothing else would notice a
    // change of what it computes: a toolchain built under the old meaning
    // would be served for the new one. If this fails and the change is meant,
    // bump the tag in toolchain_lines and update GOLDEN here, in one commit.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-store-golden-'));
    try {
        const g = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
        const write = (rel, content, mode = 0o644) => {
            fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
            fs.writeFileSync(path.join(dir, rel), content);
            fs.chmodSync(path.join(dir, rel), mode);
        };
        fs.mkdirSync(path.join(dir, 'light/scripts'), { recursive: true });
        for (const name of COPIED) fs.copyFileSync(path.join(SCRIPTS, name), path.join(dir, 'light/scripts', name));
        write('.gitignore', '*.o\n');
        write('light/packs/fix/toolchains/main/paths', '# Its sources and a patch, besides this directory.\n  src/  \n\npatches/a.diff\n');
        write('light/packs/fix/toolchains/main/env', 'LEVEL variant  # another compiler\nMIRROR source  # the same bytes\nUNSET variant  # never set here\n');
        write('light/packs/fix/toolchains/main/needs', '# The base it builds with.\nfix/base  # its headers\n');
        write('light/packs/fix/toolchains/main/toolchain.sh', '#!/bin/sh\nmake\n', 0o755);
        write('light/packs/fix/toolchains/main/pins.sh', 'MAIN_VERSION=1\n');
        write('light/packs/fix/toolchains/main/outputs', 'bin/cc\n');
        write('light/packs/fix/toolchains/base/toolchain.sh', '#!/bin/sh\n', 0o755);
        write('light/packs/fix/toolchains/base/outputs', 'include/a.h\n');
        write('light/packs/fix/glue.sh', '#!/bin/sh\n', 0o755);
        write('light/packs/fix/glue.paths', 'glue.sh\nsrc/glue.js\n');
        write('light/packs/fix/src/a.c', 'int a;\n');
        write('light/packs/fix/src/a.o', 'ignored\n');
        fs.symlinkSync('a.c', path.join(dir, 'light/packs/fix/src/link.c'));
        write('light/packs/fix/patches/a.diff', '--- a\n+++ b\n');
        g('init', '-q');
        g('add', '-A');
        g('-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'fixture');
        // Untracked, not ignored: an input like any other.
        write('light/packs/fix/src/new.c', 'int n;\n');
        const env = { PATH: process.env.PATH, HOME: process.env.HOME, LEVEL: '3', MIRROR: 'https://mirror.example', UNDECLARED: '1' };
        const build = g('hash-object', 'light/scripts/toolchain-build-env.sh');
        const keyOf = (unit) => execFileSync(path.join(dir, 'light/scripts/pack-store.sh'), ['toolchain-key', unit], { env, encoding: 'utf8' }).trim();
        const lines = execFileSync('bash', ['-c', 'set -eu; source light/scripts/toolchain-key.sh; toolchain_lines fix/main'], { cwd: dir, env, encoding: 'utf8' });
        // src/glue.js is no file here and the glue's own business: no unit names it.
        const golden = GOLDEN.replace('<build env>', build).replace('<dep>', keyOf('fix/base'));
        assert.equal(lines, golden);
        assert.equal(keyOf('fix/main'), createHash('sha256').update(golden).digest('hex').slice(0, 40));
        const base = execFileSync('bash', ['-c', 'set -eu; source light/scripts/toolchain-key.sh; toolchain_lines fix/base'], { cwd: dir, env, encoding: 'utf8' });
        assert.equal(base, `yukibana-toolchain/3\nunit fix/base\n100755 ${g('hash-object', 'light/packs/fix/toolchains/base/toolchain.sh')} light/packs/fix/toolchains/base/toolchain.sh\n100644 ${build} light/scripts/toolchain-build-env.sh\n`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('an output-changing setting gives another key, and a setting the unit does not declare does not', async () => {
    const plain = await key();
    const o2 = await key('tool/cc', { OPT: '2' });
    const o3 = await key('tool/cc', { OPT: '3' });
    assert.equal(new Set([plain, o2, o3]).size, 3);
    assert.equal(await key('tool/cc', { MIRROR: 'https://mirror.example' }), plain);
    assert.equal(await key('tool/cc', { UNDECLARED: '1' }), plain);
    // `other/main` declares no settings at all.
    assert.equal(await key('other/main', { OPT: '2' }), await key('other/main'));
    // A setting of the compilers reaches the libraries built with them.
    const stub = await stubKeys();
    const level = await stubKeys({ STUB_LEVEL: '2' });
    assert.equal(level.compilers, stub.compilers);
    assert.notEqual(level.libs, stub.libs);
});

test('a comment or a source setting added to a unit\'s env rebuilds nothing, and only a set output-changing setting does', async () => {
    const plain = await key();
    const opt = await key('tool/cc', { OPT: '2' });
    fs.appendFileSync(path.join(root, 'light/packs/tool/toolchains/cc/env'), '# a note on the settings\nPROXYLESS source  # where sources come from\n');
    assert.equal(await key(), plain);
    assert.equal(await key('tool/cc', { OPT: '2', PROXYLESS: '1' }), opt);
    // The key stays, but the build is dirty until the edit is committed: the
    // file is no input, yet it decides which settings reach the build.
    const dirty = await store('toolchain-dirty', 'tool/cc');
    assert.equal(dirty.code, 0, dirty.err);
    assert.equal(dirty.out, 'light/packs/tool/toolchains/cc/env\n');
    commit('a note on the settings');
    assert.equal(await key(), plain);
    assert.equal((await store('toolchain-dirty', 'tool/cc')).code, 1);
    // A newly declared output-changing setting counts once it is set.
    fs.appendFileSync(path.join(root, 'light/packs/tool/toolchains/cc/env'), 'LTO variant  # link-time optimisation: another compiler\n');
    assert.equal(await key(), plain);
    assert.notEqual(await key('tool/cc', { LTO: '1' }), plain);
    git('reset', '-q', '--hard', 'HEAD~1');
});

test('a malformed toolchain setting is named, and no key is given', async () => {
    fs.appendFileSync(path.join(root, 'light/packs/tool/toolchains/cc/env'), 'lto variant\nJOBS sometimes  # how many\nDEP_CC variant  # a dependency\'s name\n');
    const r = await store('toolchain-key', 'tool/cc');
    assert.notEqual(r.code, 0);
    assert.equal(r.out, '');
    assert.match(r.err, /cc\/env:4: 'lto variant' is not 'NAME source\|variant {2}# why'/);
    assert.match(r.err, /cc\/env:5: 'JOBS sometimes {2}# how many'/);
    assert.match(r.err, /cc\/env:6: DEP_CC is a variable every build is given/);
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

test("an uncommitted edit to a pack's glue leaves its units clean", async () => {
    const before = await key();
    put('light/packs/tool/glue.sh', '#!/bin/sh\necho edited\n', 0o755);
    put('light/packs/tool/build.sh', '#!/bin/sh\necho edited\n', 0o755);
    put('light/packs/tool/requires.json', '{"edited":true}\n');
    put('light/packs/tool/src/glue.js', 'export const edited = true;\n');
    put('light/packs/stub/src/server.js', 'export const edited = true;\n');
    const r = await store('toolchain-dirty', 'tool/cc');
    assert.equal(r.code, 1, r.out + r.err);
    assert.equal(r.out, '');
    for (const unit of ['stub/compilers', 'stub/vm', 'stub/libs']) assert.equal((await store('toolchain-dirty', unit)).code, 1, unit);
    assert.equal(await key(), before);
    clean();
});

test('a dirty toolchain names the files that make it dirty, and a unit built with a dirty one is dirty too', async () => {
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 3; }\n');
    put('light/packs/tool/toolchains/cc/extra.c', 'int extra;\n');
    put('light/packs/tool/src/glue.js', 'export const edited = true;\n');
    const r = await store('toolchain-dirty', 'tool/cc');
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.out.trim().split('\n'), ['light/packs/tool/src/compiler.c', 'light/packs/tool/toolchains/cc/extra.c']);
    clean();
    assert.equal((await store('toolchain-dirty', 'tool/cc')).code, 1);

    put('light/packs/stub/toolchains/compilers/pins.sh', 'CC_VERSION=9\n');
    put('light/packs/stub/toolchains/libs/needs', 'stub/compilers\n# reworded\n');
    assert.equal((await store('toolchain-dirty', 'stub/compilers')).out, 'light/packs/stub/toolchains/compilers/pins.sh\n');
    assert.equal((await store('toolchain-dirty', 'stub/vm')).code, 1);
    assert.deepEqual((await store('toolchain-dirty', 'stub/libs')).out.trim().split('\n'), ['light/packs/stub/toolchains/compilers/pins.sh', 'light/packs/stub/toolchains/libs/needs']);
    clean();
});

test('a pack without toolchain units keeps its tree as its key', async () => {
    const r = await store('toolchain-key', 'demo/main');
    assert.equal(r.code, 2);
    assert.match(r.err, /demo has no toolchain units \(packs\/demo\/toolchains\/\): it is built whole by its build\.sh, and its tree is its key/);
    assert.equal((await store('tree', 'demo')).out.trim(), git('rev-parse', 'HEAD:light/packs/demo'));
    assert.equal((await store('toolchain-dirty', 'demo/main')).code, 2);
    assert.equal((await store('toolchain-units', 'demo')).code, 2);
});

test("a split pack's units are listed each after the units it needs", async () => {
    const r = await store('toolchain-units', 'stub');
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.out.trim().split('\n'), ['stub/compilers', 'stub/libs', 'stub/vm']);
});

test('a split pack is never put in the pack store', async () => {
    assets.set(`tool-${git('rev-parse', 'HEAD:light/packs/tool')}.tar.zst`, { bytes: archive('tool'), created: '2026-10-01T00:00:00Z' });
    for (const command of ['has', 'fetch', 'publish']) {
        const r = await store(command, 'tool');
        assert.equal(r.code, 2, `${command}: ${r.err}`);
        assert.match(r.err, /tool: split pack: fetch its toolchain units and assemble \(pack-toolchain\.sh\)/);
    }
    assert.equal(exists('light/app/static/packs/tool'), false);
});

test('the plan puts every unit in a wave after the units it needs, and leaves out the ones the store has', async () => {
    toolchains = new Map();
    const all = await store('toolchain-plan', '--waves', '3');
    assert.equal(all.code, 0, all.err);
    const rows = all.out.trim().split('\n').map((l) => l.split(' '));
    const stub = await stubKeys();
    assert.deepEqual(
        rows.map(([wave, unit, , needs]) => [wave, unit, needs]),
        [
            ['1', 'other/main', '-'],
            ['1', 'stub/compilers', '-'],
            ['2', 'stub/libs', 'stub/compilers'],
            ['1', 'stub/vm', '-'],
            ['1', 'tool/cc', '-'],
        ],
    );
    assert.equal(rows.find(([, unit]) => unit === 'stub/libs')?.[2], stub.libs);
    // What the store has is not built again.
    toolchains.set(`toolchain-stub-compilers-${stub.compilers}.tar.zst`, { bytes: Buffer.from('x'), created: '2026-10-01T00:00:00Z' });
    toolchains.set(`toolchain-tool-cc-${await key()}.tar.zst`, { bytes: Buffer.from('x'), created: '2026-10-01T00:00:00Z' });
    const missing = await store('toolchain-plan', '--missing');
    assert.equal(missing.code, 0, missing.err);
    assert.deepEqual(missing.out.trim().split('\n').map((l) => l.split(' ')[1]), ['other/main', 'stub/libs', 'stub/vm']);
    toolchains = new Map();
});

test('a unit deeper than the workflow has waves for is refused by name', async () => {
    put('light/packs/stub/toolchains/vm/needs', 'stub/libs  # a third wave\n');
    assert.equal((await store('toolchain-plan', '--waves', '3')).code, 0);
    const r = await store('toolchain-plan', '--waves', '2');
    assert.equal(r.code, 1);
    assert.match(r.err, /stub\/vm would build in wave 3, after the 2 waves light-packs\.yml has \(it needs stub\/libs\)/);
    clean();
});

test("a unit's toolchain key report names the file that changed it", async () => {
    const base = git('rev-parse', 'HEAD');
    const baseKey = await key();
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 4; }\n');
    put('light/packs/tool/src/glue.js', 'export const glue = 4;\n');
    commit('compiler 4');
    const r = await store('toolchain-key-report', 'tool/cc', base);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^toolchain tool\/cc against [0-9a-f]{40}:$/m);
    assert.match(r.out, /^M\tlight\/packs\/tool\/src\/compiler\.c$/m);
    assert.doesNotMatch(r.out, /glue\.js/);
    assert.match(r.out, new RegExp(`^old key: ${baseKey}$`, 'm'));
    assert.equal(r.out.trim().split('\n').at(-1), 'changed');

    const glueBase = git('rev-parse', 'HEAD');
    put('light/packs/tool/src/glue.js', 'export const glue = 5;\n');
    commit('glue 5');
    const glue = await store('toolchain-key-report', 'tool/cc', glueBase);
    assert.equal(glue.code, 0, glue.err);
    assert.doesNotMatch(glue.out, /^[AMDR]\t/m);
    assert.equal(glue.out.trim().split('\n').at(-1), 'unchanged');

    // The paths file is no input of itself: the report names it.
    const pathsBase = git('rev-parse', 'HEAD');
    const pathsKey = await key();
    fs.appendFileSync(path.join(root, 'light/packs/tool/toolchains/cc/paths'), 'src/glue.js\n');
    commit('the compiler reads the glue now');
    const paths = await store('toolchain-key-report', 'tool/cc', pathsBase);
    assert.equal(paths.code, 0, paths.err);
    assert.match(paths.out, new RegExp(`^old key: ${pathsKey}$`, 'm'));
    assert.match(paths.out, new RegExp(`^new key: ${await key()}$`, 'm'));
    assert.match(paths.out, /^M\tlight\/packs\/tool\/toolchains\/cc\/paths$/m);
    assert.match(paths.out, /^A\tlight\/packs\/tool\/src\/glue\.js$/m);
    assert.equal(paths.out.trim().split('\n').at(-1), 'changed');

    // A newly declared setting shows as env lines then and now.
    const envBase = git('rev-parse', 'HEAD');
    fs.appendFileSync(path.join(root, 'light/packs/tool/toolchains/cc/env'), 'LTO variant  # link-time optimisation: another compiler\n');
    commit('LTO');
    const env = await storeWith({ LTO: '1' }, 'toolchain-key-report', 'tool/cc', envBase);
    assert.equal(env.code, 0, env.err);
    assert.match(env.out, /^old env: \(none\)$/m);
    assert.match(env.out, /^new env: env LTO=1$/m);
    // Named once: the env file is no input, so only the report's own line
    // for it names it, never the diff of the inputs as well.
    assert.equal(env.out.match(/^M\tlight\/packs\/tool\/toolchains\/cc\/env$/gm)?.length, 1, env.out);
    assert.equal(env.out.trim().split('\n').at(-1), 'changed');
    assert.notEqual(baseKey, await key());
});

test('a key report names the unit it needs whose key changed, though no file of its own did', async () => {
    const base = git('rev-parse', 'HEAD');
    const before = await stubKeys();
    put('light/packs/stub/toolchains/compilers/pins.sh', 'CC_VERSION=1.1\n');
    commit('compilers 1.1');
    try {
        const r = await store('toolchain-key-report', 'stub/libs', base);
        assert.equal(r.code, 0, r.err);
        assert.doesNotMatch(r.out, /^[AMD]\tlight\//m);
        assert.match(r.out, /^M\tneeds stub\/compilers \(its key changed\)$/m);
        assert.match(r.out, new RegExp(`^old key: ${before.libs}$`, 'm'));
        assert.equal(r.out.trim().split('\n').at(-1), 'changed');
        const vm = await store('toolchain-key-report', 'stub/vm', base);
        assert.equal(vm.out.trim().split('\n').at(-1), 'unchanged');
    } finally {
        git('reset', '-q', '--hard', base);
    }
    // A unit new since base has no old key: changed.
    put('light/packs/stub/toolchains/extra/toolchain.sh', '#!/bin/sh\n', 0o755);
    put('light/packs/stub/toolchains/extra/needs', 'stub/vm\n');
    commit('a fourth unit');
    try {
        const r = await store('toolchain-key-report', 'stub/extra', base);
        assert.equal(r.code, 0, r.err);
        assert.match(r.out, /^old key: none \(no light\/packs\/stub\/toolchains\/extra at [0-9a-f]{40}\)$/m);
        assert.match(r.out, /^A\tneeds stub\/vm$/m);
        assert.equal(r.out.trim().split('\n').at(-1), 'changed');
    } finally {
        git('reset', '-q', '--hard', base);
    }
});

test("a change to the key's definition is named by the key report, with both keys, even though no input changed", async () => {
    // toolchain-key.sh is no input of any key, so a bumped format tag changes
    // every key while every input stays as it was: the report must say so on
    // the pull request that makes it, or a rebuild of every compiler would
    // be announced as `unchanged`.
    const base = git('rev-parse', 'HEAD');
    const baseKey = await key();
    const def = path.join(light, 'scripts/toolchain-key.sh');
    const text = fs.readFileSync(def, 'utf8');
    assert.match(text, /echo "yukibana-toolchain\/\d+"/);
    fs.writeFileSync(def, text.replace(/echo "yukibana-toolchain\/(\d+)"/, (_, n) => `echo "yukibana-toolchain/${Number(n) + 1}"`));
    commit('the key means something else now');
    try {
        const newKey = await key();
        assert.notEqual(newKey, baseKey);
        const r = await store('toolchain-key-report', 'tool/cc', base);
        assert.equal(r.code, 0, r.err);
        assert.match(r.out, /^M\tlight\/scripts\/toolchain-key\.sh \(the key's definition\)$/m);
        assert.match(r.out, new RegExp(`^old key: ${baseKey}$`, 'm'));
        assert.match(r.out, new RegExp(`^new key: ${newKey}$`, 'm'));
        assert.equal(r.out.trim().split('\n').at(-1), 'changed');
    } finally {
        git('reset', '-q', '--hard', base);
    }

    // A comment there is named too, and keeps the key: `unchanged`.
    fs.appendFileSync(def, '# a comment on how keys are made\n');
    commit('a comment on the key');
    try {
        const r = await store('toolchain-key-report', 'tool/cc', base);
        assert.equal(r.code, 0, r.err);
        assert.match(r.out, /^M\tlight\/scripts\/toolchain-key\.sh \(the key's definition\)$/m);
        assert.match(r.out, new RegExp(`^old key: ${baseKey}$`, 'm'));
        assert.match(r.out, new RegExp(`^new key: ${baseKey}$`, 'm'));
        assert.equal(r.out.trim().split('\n').at(-1), 'unchanged');
    } finally {
        git('reset', '-q', '--hard', base);
    }
});

/**
 * The names of the variables and functions toolchain-build-env.sh defines
 * that the toolchain-key.sh in `scripts` assigns or defines again, when
 * sourced as every store script sources it. Each such name would let an
 * unkeyed file decide what a keyed one claims to (the variables that reach
 * every build, which names a knob may not take, where a dependency is
 * found), and an identical copy is no better: the next edit lands in one of
 * the two. Each name is made read-only, in turn, at the end of a scratch
 * copy of the build environment, so any later assignment or definition of
 * it fails where it happens.
 */
function redefinedByKey(scripts) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-store-allowlist-'));
    try {
        const copy = path.join(dir, 'light/scripts');
        fs.mkdirSync(copy, { recursive: true });
        const def = fs.readFileSync(path.join(scripts, 'toolchain-key.sh'), 'utf8');
        const env = fs.readFileSync(path.join(scripts, 'toolchain-build-env.sh'), 'utf8');
        fs.writeFileSync(path.join(copy, 'toolchain-key.sh'), def);
        const own = execFileSync(
            'bash',
            ['-c', 'names() { compgen -v; compgen -A function; }; plain="$(names | sort)"; (source "$1"; names | sort | comm -13 <(printf "%s\\n" "$plain" plain) -)', 'bash', path.join(scripts, 'toolchain-build-env.sh')],
            { encoding: 'utf8' },
        )
            .split('\n')
            .filter(Boolean);
        assert.ok(own.includes('TOOLCHAIN_ENV_FIXED') && own.includes('toolchain_env_args') && own.includes('toolchain_dep_var'), own.join(' '));
        return own.filter((name) => {
            const kind = execFileSync('bash', ['-c', `source "$1"; declare -F "$2" >/dev/null && echo -f || echo`, 'bash', path.join(scripts, 'toolchain-build-env.sh'), name], { encoding: 'utf8' }).trim();
            fs.writeFileSync(path.join(copy, 'toolchain-build-env.sh'), `${env}\nreadonly ${kind} ${name}\n`);
            const r = spawnSync('bash', ['-c', 'set -eu; source "$1"', 'bash', path.join(copy, 'toolchain-key.sh')], { encoding: 'utf8' });
            return r.status !== 0 || r.stderr !== '';
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('what reaches every toolchain build is decided only by the keyed build environment, never by the unkeyed key definition', () => {
    assert.deepEqual(redefinedByKey(SCRIPTS), []);
    // The hazard itself: an allowlist entry added in toolchain-key.sh, or the
    // whole block copied there unchanged, would reach every build with no key
    // changing. The check above must see either.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-store-allowlist-'));
    try {
        const env = fs.readFileSync(path.join(SCRIPTS, 'toolchain-build-env.sh'), 'utf8');
        const block = env.slice(env.indexOf('TOOLCHAIN_ENV_FIXED='), env.indexOf('\n}\n', env.indexOf('toolchain_env_reserved()')) + 3);
        for (const [added, names] of [
            ['TOOLCHAIN_ENV_FIXED+=(EXTRA=1)\n', ['TOOLCHAIN_ENV_FIXED']],
            [block, ['TOOLCHAIN_ENV_FIXED', 'TOOLCHAIN_ENV_TRANSPORT', 'toolchain_env_reserved']],
            ['toolchain_dep_var() { echo "DEP_$1"; }\n', ['toolchain_dep_var']],
        ]) {
            fs.copyFileSync(path.join(SCRIPTS, 'toolchain-build-env.sh'), path.join(dir, 'toolchain-build-env.sh'));
            fs.writeFileSync(path.join(dir, 'toolchain-key.sh'), fs.readFileSync(path.join(SCRIPTS, 'toolchain-key.sh'), 'utf8') + added);
            assert.deepEqual(redefinedByKey(dir).sort(), names);
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a key report names a new input nobody has committed yet, as its key does', async () => {
    const base = git('rev-parse', 'HEAD');
    const baseKey = await key();
    put('light/packs/tool/toolchains/cc/new.c', 'int helper(void) { return 1; }\n');
    try {
        assert.notEqual(await key(), baseKey);
        const r = await store('toolchain-key-report', 'tool/cc', base);
        assert.equal(r.code, 0, r.err);
        assert.match(r.out, /^A\tlight\/packs\/tool\/toolchains\/cc\/new\.c$/m);
        assert.equal(r.out.trim().split('\n').at(-1), 'changed');
    } finally {
        clean();
    }
});

test('a key report against a commit the clone does not have says so', async () => {
    const missing = 'f'.repeat(40);
    const r = await store('toolchain-key-report', 'tool/cc', missing);
    assert.equal(r.code, 6);
    assert.match(r.err, new RegExp(`base commit ${missing} is not in this clone; fetch it first`));
});

test('a bad pack or unit name is bad usage, exit 2, like a pack that is not split', async () => {
    for (const args of [['toolchain-key', 'No_Such/x'], ['toolchain-has', 'nosuch/x'], ['toolchain-key', 'demo/x'], ['toolchain-key', 'tool'], ['toolchain-key', 'tool/nosuch'], ['toolchain-key', 'tool/Bad_Name']]) {
        const r = await store(...args);
        assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`);
        assert.match(r.err, /^pack-store\.sh: /);
    }
});

test('a store holding more toolchains than one page of the API lists still finds every one of them', async () => {
    toolchains = new Map();
    // The toolchain asked for is the last of 250: past the list GitHub
    // embeds in the release, and past the first two pages of its assets.
    for (let i = 0; i < 249; i++) toolchains.set(`toolchain-other-main-${i.toString(16).padStart(40, '0')}.tar.zst`, { bytes: Buffer.from('x'), created: '2026-09-01T00:00:00Z' });
    const k = await key();
    toolchains.set(`toolchain-tool-cc-${k}.tar.zst`, { bytes: toolchainArchive({ unit: 'tool/cc', key: k, commit: 'b'.repeat(40) }), created: '2026-10-01T00:00:00Z' });
    assetPages.length = 0;
    const has = await store('toolchain-has', 'tool/cc');
    assert.equal(has.code, 0, has.err);
    assert.deepEqual(assetPages, [1, 2, 3].map((n) => `/repos/test/repo/releases/2/assets?per_page=100&page=${n}`));
    const dir = path.join(root, 'fetched-paged');
    const fetched = await store('toolchain-fetch', 'tool/cc', dir);
    assert.equal(fetched.code, 0, fetched.err);
    assert.equal(fs.readFileSync(path.join(dir, 'bin/cc'), 'utf8'), '#!/bin/sh\necho cc\n');
    // A page of exactly 100 is not taken for the last: the next, empty, is.
    toolchains.delete(`toolchain-other-main-${(0).toString(16).padStart(40, '0')}.tar.zst`);
    assetPages.length = 0;
    assert.equal((await store('toolchain-has', 'tool/cc')).code, 0);
    assert.equal(assetPages.length, 3);
    toolchains = new Map();
});

test('an asset list GitHub refuses to give is a named failure, never a missing toolchain', async () => {
    const r = await storeWith({ LIGHT_PACKS_REPO: 'test/limited' }, 'toolchain-has', 'tool/cc');
    assert.equal(r.code, 1, r.err);
    assert.match(r.err, /pack-store\.sh: release light-toolchains of test\/limited: API rate limit exceeded/);
    assert.doesNotMatch(r.err, /no toolchain-tool/);
});

test('no toolchain for these inputs exits 3', async () => {
    toolchains = new Map();
    assert.equal((await store('toolchain-has', 'tool/cc')).code, 3);
    const r = await store('toolchain-fetch', 'tool/cc');
    assert.equal(r.code, 3);
    assert.match(r.err, /no toolchain-tool-cc-[0-9a-f]{40}\.tar\.zst in test\/repo's light-toolchains release/);
    toolchainsExist = false;
    assert.equal((await store('toolchain-fetch', 'tool/cc')).code, 3);
    toolchainsExist = true;
    assert.equal(exists(`cache/built/tool/cc`), false);
});

test('a toolchain is fetched for exactly its inputs, read-only, with each file recorded', async () => {
    const k = await key();
    const commitId = git('rev-parse', 'HEAD');
    toolchains = new Map([[`toolchain-tool-cc-${k}.tar.zst`, { bytes: toolchainArchive({ unit: 'tool/cc', key: k, commit: commitId }), created: '2026-10-01T00:00:00Z' }]]);
    const has = await store('toolchain-has', 'tool/cc');
    assert.equal(has.code, 0, has.err);
    assert.equal(exists(`cache/built/tool/cc/${k}`), false);
    const r = await store('toolchain-fetch', 'tool/cc');
    assert.equal(r.code, 0, r.err);
    const dir = path.join(root, `cache/built/tool/cc/${k}`);
    assert.equal(r.out.trim(), dir);
    assert.equal(fs.readFileSync(path.join(dir, 'bin/cc'), 'utf8'), '#!/bin/sh\necho cc\n');
    assert.equal(fs.statSync(path.join(dir, 'bin/cc')).mode & 0o222, 0);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'toolchain.json'), 'utf8'));
    const [size, mtime] = execFileSync('stat', ['-c', '%s %.9Y', path.join(dir, 'bin/cc')], { encoding: 'utf8' }).trim().split(' ');
    assert.deepEqual(
        manifest.files.map((f) => [f.path, f.size, f.mtime]),
        [['bin/cc', Number(size), mtime]],
    );
    assert.equal(exists(`cache/built/tool/cc/${k}.part`), false);
    // Fetching again replaces the read-only copy.
    const again = await store('toolchain-fetch', 'tool/cc');
    assert.equal(again.code, 0, again.err);
});

test('a fetched toolchain is refused when its manifest names another unit, other inputs or other files', async () => {
    const k = await key();
    const commitId = git('rev-parse', 'HEAD');
    const target = path.join(root, 'fetched-other');
    for (const [manifest, why] of [
        [{ unit: 'tool/cc', key: 'e'.repeat(40), commit: commitId }, /toolchain\.json names the inputs "e{40}", not [0-9a-f]{40}/],
        [{ unit: 'other/main', key: k, commit: commitId }, /toolchain\.json is of unit "other\/main", not tool\/cc/],
        [{ unit: 'tool/cc', key: k, commit: commitId, format: 1 }, /toolchain\.json is of format 1, not 2/],
        [{ unit: 'tool/cc', key: k, commit: 'HEAD' }, /toolchain\.json names no commit/],
        [{ unit: 'tool/cc', key: k, commit: 'dirty' }, /a dirty toolchain is never stored/],
        [{ unit: 'tool/cc', key: k, commit: commitId, files: [] }, /bin\/cc is not listed in toolchain\.json/],
        [{ unit: 'tool/cc', key: k, commit: commitId, files: listing({ 'bin/cc': 'other bytes\n' }).files }, /bin\/cc is \d+ bytes, not the \d+ listed/],
        [{ unit: 'tool/cc', key: k, commit: commitId, files: listing({ 'bin/cc': '#!/bin/sh\necho CC\n' }).files }, /bin\/cc does not have the sha256 listed/],
    ]) {
        toolchains = new Map([[`toolchain-tool-cc-${k}.tar.zst`, { bytes: toolchainArchive(manifest), created: '2026-10-01T00:00:00Z' }]]);
        const r = await store('toolchain-fetch', 'tool/cc', target);
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
            `toolchain-tool-cc-${k}.tar.zst`,
            { bytes: toolchainArchive({ unit: 'tool/cc', key: k, commit: git('rev-parse', 'HEAD') }), created: '2026-10-01T00:00:00Z', digest: `sha256:${'0'.repeat(64)}` },
        ],
    ]);
    const target = path.join(root, 'fetched-tampered');
    const r = await store('toolchain-fetch', 'tool/cc', target);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /sha256 mismatch/);
    assert.equal(fs.existsSync(target), false);
});

test('asking for any toolchain fetches the newest of that unit and says which', async () => {
    const [older, newer, current] = ['1', '2', await key()].map((c) => (c.length === 40 ? c : c.repeat(40)));
    const commitId = git('rev-parse', 'HEAD');
    toolchains = new Map([
        [`toolchain-tool-cc-${older}.tar.zst`, { bytes: toolchainArchive({ unit: 'tool/cc', key: older, commit: commitId }, { 'which': 'older' }), created: '2026-10-01T00:00:00Z' }],
        [`toolchain-tool-cc-${newer}.tar.zst`, { bytes: toolchainArchive({ unit: 'tool/cc', key: newer, commit: commitId }, { 'which': 'newer' }), created: '2026-10-05T00:00:00Z' }],
        [`toolchain-other-main-${'3'.repeat(40)}.tar.zst`, { bytes: toolchainArchive({ unit: 'other/main', key: '3'.repeat(40), commit: commitId }), created: '2026-10-09T00:00:00Z' }],
    ]);
    assert.equal((await store('toolchain-fetch', 'tool/cc')).code, 3, `no ${current} yet`);
    const target = path.join(root, 'fetched-any');
    const r = await store('toolchain-fetch', 'tool/cc', '--any', target);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, new RegExp(`taking the newest toolchain, ${newer}`));
    assert.equal(fs.readFileSync(path.join(target, 'which'), 'utf8'), 'newer');

    // The manifest must still be the one its name says.
    toolchains.set(`toolchain-tool-cc-${'4'.repeat(40)}.tar.zst`, {
        bytes: toolchainArchive({ unit: 'tool/cc', key: newer, commit: commitId }),
        created: '2026-10-07T00:00:00Z',
    });
    const wrong = await store('toolchain-fetch', 'tool/cc', '--any', path.join(root, 'fetched-any-wrong'));
    assert.notEqual(wrong.code, 0);
    assert.match(wrong.err, /names the inputs/);
});

test("a unit's archive from the same run is taken only when its name and manifest are this unit's inputs", async () => {
    const k = await key();
    const out = fs.mkdtempSync(path.join(root, 'out-'));
    const archived = await store('toolchain-archive', 'tool/cc', await builtToolchain(), out);
    assert.equal(archived.code, 0, archived.err);
    const file = path.join(out, `toolchain-tool-cc-${k}.tar.zst`);
    assert.equal(archived.out.trim(), file);
    const target = path.join(root, 'fetched-unpacked');
    const r = await store('toolchain-unpack', 'tool/cc', file, target);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out.trim(), target);
    assert.equal(fs.statSync(path.join(target, 'bin/cc')).mode & 0o222, 0);
    // Another unit's name, or another key's, is refused before it is read.
    const renamed = path.join(out, `toolchain-tool-cc-${'e'.repeat(40)}.tar.zst`);
    fs.copyFileSync(file, renamed);
    const wrong = await store('toolchain-unpack', 'tool/cc', renamed, path.join(root, 'fetched-renamed'));
    assert.notEqual(wrong.code, 0);
    assert.match(wrong.err, /is not toolchain-tool-cc-[0-9a-f]{40}\.tar\.zst, the toolchain of tool\/cc's inputs here/);
    assert.equal((await store('toolchain-unpack', 'other/main', file)).code, 1);
});

/** A PATH holding every command this one does but `command`, as links in one directory. */
function pathWithout(command) {
    const dir = path.join(root, `bin-without-${command}`);
    if (fs.existsSync(dir)) return dir;
    fs.mkdirSync(dir);
    for (const from of (process.env.PATH ?? '').split(path.delimiter)) {
        if (!from || !fs.existsSync(from)) continue;
        for (const name of fs.readdirSync(from)) {
            if (name === command || fs.existsSync(path.join(dir, name))) continue;
            fs.symlinkSync(path.join(from, name), path.join(dir, name));
        }
    }
    return dir;
}
/** The archive toolchain-archive writes of a toolchain built at HEAD with `manifest` over its own; asserts it was written. */
async function archived(manifest = {}) {
    const out = fs.mkdtempSync(path.join(root, 'out-'));
    const r = await store('toolchain-archive', 'tool/cc', await builtToolchain(manifest), out);
    assert.equal(r.code, 0, r.err);
    return r.out.trim();
}
/** An archive named as HEAD's toolchain of tool/cc whose toolchain.json is `manifest` over a listing of its files. */
async function namedArchive(manifest, files) {
    const file = path.join(fs.mkdtempSync(path.join(root, 'out-')), `toolchain-tool-cc-${await key()}.tar.zst`);
    fs.writeFileSync(file, toolchainArchive(manifest, files));
    return file;
}

test('a toolchain built from uncommitted inputs, a changed setting or another commit is never published or handed on', async () => {
    toolchains = new Map();
    attestations = new Map();
    ghCalls.length = 0;
    const built = await builtToolchain();
    const file = await archived();
    attest(fs.readFileSync(file));
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 6; }\n');
    const handed = await store('toolchain-archive', 'tool/cc', built, path.join(root, 'out-dirty'));
    assert.notEqual(handed.code, 0);
    assert.match(handed.err, /not storing a toolchain built from uncommitted inputs:\nlight\/packs\/tool\/src\/compiler\.c/);
    assert.equal(exists('out-dirty'), false);
    // The archive's name is HEAD's key no longer.
    const dirty = await store('toolchain-publish', 'tool/cc', file);
    assert.notEqual(dirty.code, 0);
    assert.match(dirty.err, /is not toolchain-tool-cc-[0-9a-f]{40}\.tar\.zst, the toolchain of tool\/cc's inputs at HEAD/);
    clean();

    const setting = await storeWith({ OPT: '3' }, 'toolchain-publish', 'tool/cc', file);
    assert.notEqual(setting.code, 0);
    assert.match(setting.err, /the toolchain of tool\/cc's inputs at HEAD/);

    // An uncommitted env leaves the key as it is, yet it decides what
    // reached the build: OPT, made a source setting, passes unkeyed.
    fs.writeFileSync(path.join(root, 'light/packs/tool/toolchains/cc/env'), 'OPT source  # no longer another compiler\n');
    const reclassified = await storeWith({ OPT: '3' }, 'toolchain-publish', 'tool/cc', file);
    assert.notEqual(reclassified.code, 0);
    assert.match(reclassified.err, /not storing a toolchain built from uncommitted inputs:\nlight\/packs\/tool\/toolchains\/cc\/env/);
    clean();

    const commitId = git('rev-parse', 'HEAD');
    for (const [archive, why] of [
        [await namedArchive({ unit: 'other/main', key: await key(), commit: commitId }), /toolchain\.json is of unit "other\/main", not tool\/cc/],
        [await namedArchive({ unit: 'tool/cc', key: await key(), commit: 'a'.repeat(40) }), /was built at a{40}, not at HEAD/],
        [
            await namedArchive({ unit: 'tool/cc', key: await key(), commit: commitId, files: listing({ 'bin/cc': '#!/bin/sh\n' }).files }, { 'bin/cc': '#!/bin/sh\n# changed after the build\n' }),
            /bin\/cc is \d+ bytes, not the \d+ listed/,
        ],
    ]) {
        attest(fs.readFileSync(archive));
        const r = await store('toolchain-publish', 'tool/cc', archive);
        assert.notEqual(r.code, 0);
        assert.match(r.err, why);
    }

    assert.deepEqual(ghCalls.filter(([group]) => group === 'release'), []);
    assert.equal(toolchains.size, 0);
});

test('only a toolchain whose attestation says the unit workflow built it on main is published', async () => {
    toolchains = new Map();
    attestations = new Map();
    ghCalls.length = 0;
    const file = await archived();
    const bytes = fs.readFileSync(file);
    for (const [ref, signer] of [
        [null, null],
        ['refs/pull/7/merge', SIGNER],
        ['refs/heads/feature', SIGNER],
        ['refs/heads/main', 'test/repo/.github/workflows/other.yml'],
    ]) {
        if (ref) attest(bytes, ref, signer);
        // Unset or not, publishing always asks for the attestation.
        const r = await storeWith({ LIGHT_TOOLCHAIN_PROVENANCE: undefined }, 'toolchain-publish', 'tool/cc', file);
        assert.notEqual(r.code, 0, ref);
        assert.match(r.err, /refused: no attestation says \.github\/workflows\/light-toolchain-unit\.yml of test\/repo built it on refs\/heads\/main/);
        assert.match(r.err, /gh: Error: verifying/);
    }
    assert.equal(toolchains.size, 0);
    attest(bytes);
    const r = await store('toolchain-publish', 'tool/cc', file);
    assert.equal(r.code, 0, r.err);
    // The bytes stored are the bytes attested.
    assert.deepEqual(toolchains.get(path.basename(file)).bytes, bytes);
});

test('publishing a toolchain never removes another, and a full release is refused by name', async () => {
    toolchains = new Map();
    toolchainsExist = false;
    attestations = new Map();
    ghCalls.length = 0;
    /** HEAD's archive of tool/cc, attested as main's. */
    const mainArchive = async () => {
        const file = await archived();
        attest(fs.readFileSync(file));
        return file;
    };
    const first = await store('toolchain-publish', 'tool/cc', await mainArchive());
    assert.equal(first.code, 0, first.err);
    const create = ghCalls.find(([, verb]) => verb === 'create');
    assert.ok(create?.includes('--prerelease') && create.includes('--latest=false'), JSON.stringify(create));
    const name = `toolchain-tool-cc-${await key()}.tar.zst`;
    assert.ok(toolchains.has(name));
    // What was stored is the toolchain, manifest included.
    const out = fs.mkdtempSync(path.join(root, 'out-'));
    fs.writeFileSync(path.join(out, 'a.tar.zst'), toolchains.get(name).bytes);
    execFileSync('tar', ['--zstd', '-xf', path.join(out, 'a.tar.zst'), '-C', out]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'toolchain.json'), 'utf8')).key, await key());

    const again = await store('toolchain-publish', 'tool/cc', await mainArchive());
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /is in the store already/);
    assert.equal(ghCalls.filter(([, verb]) => verb === 'upload').length, 1);

    // Nearly full: a warning naming how to evict, and nothing evicted.
    for (let i = 0; toolchains.size < 850; i++) toolchains.set(`toolchain-other-main-${i.toString(16).padStart(40, '0')}.tar.zst`, { bytes: Buffer.from('x'), created: '2026-09-01T00:00:00Z' });
    const kept = new Set(toolchains.keys());
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 7; }\n');
    commit('compiler 7');
    const warned = await store('toolchain-publish', 'tool/cc', await mainArchive());
    assert.equal(warned.code, 0, warned.err);
    assert.match(warned.err, /holds 850 of at most 1000 assets; evict toolchains no branch needs with gh release delete-asset light-toolchains <asset>/);
    for (const old of kept) assert.ok(toolchains.has(old), old);
    assert.equal(toolchains.size, 851);

    // Full: refused by name, still nothing evicted.
    for (let i = 1000; toolchains.size < 1000; i++) toolchains.set(`toolchain-other-main-${i.toString(16).padStart(40, '0')}.tar.zst`, { bytes: Buffer.from('x'), created: '2026-09-02T00:00:00Z' });
    put('light/packs/tool/src/compiler.c', 'int main(void) { return 8; }\n');
    commit('compiler 8');
    const full = await store('toolchain-publish', 'tool/cc', await mainArchive());
    assert.notEqual(full.code, 0);
    assert.match(full.err, /holds 1000 assets, GitHub's cap of 1000; nothing is evicted automatically: remove toolchains no branch needs with gh release delete-asset light-toolchains <asset>/);
    assert.equal(toolchains.size, 1000);
    assert.deepEqual(ghCalls.filter(([, verb]) => verb === 'delete-asset'), []);
    toolchains = new Map();
});

test('a toolchain from the store is used only when its attestation says main built it, and CI never uses one unchecked', async () => {
    const k = await key();
    const bytes = toolchainArchive({ unit: 'tool/cc', key: k, commit: git('rev-parse', 'HEAD') });
    toolchains = new Map([[`toolchain-tool-cc-${k}.tar.zst`, { bytes, created: '2026-10-01T00:00:00Z' }]]);
    attestations = new Map();
    const target = path.join(root, 'fetched-provenance');
    const required = { LIGHT_TOOLCHAIN_PROVENANCE: 'required' };
    // Written by a pull request's run, or by another workflow on main.
    for (const [ref, signer] of [
        [null, null],
        ['refs/pull/7/merge', SIGNER],
        ['refs/heads/main', 'test/repo/.github/workflows/light-packs.yml'],
    ]) {
        if (ref) attest(bytes, ref, signer);
        const r = await storeWith(required, 'toolchain-fetch', 'tool/cc', target);
        assert.equal(r.code, 1, r.err);
        assert.match(r.err, /toolchain-tool-cc-[0-9a-f]{40}\.tar\.zst: refused: no attestation says .* built it on refs\/heads\/main/);
        assert.equal(fs.existsSync(target), false);
    }
    // Without gh, CI fails by name rather than use it unchecked.
    const nogh = await storeWith({ ...required, PATH: pathWithout('gh') }, 'toolchain-fetch', 'tool/cc', target);
    assert.equal(nogh.code, 1);
    assert.match(nogh.err, /gh is needed to verify its provenance/);
    assert.equal(fs.existsSync(target), false);
    attest(bytes);
    const ok = await storeWith(required, 'toolchain-fetch', 'tool/cc', target);
    assert.equal(ok.code, 0, ok.err);
    assert.match(ok.err, /built by \.github\/workflows\/light-toolchain-unit\.yml on refs\/heads\/main, as its attestation says/);
    fs.rmSync(target, { recursive: true, force: true });
    const bad = await storeWith({ LIGHT_TOOLCHAIN_PROVENANCE: 'off' }, 'toolchain-fetch', 'tool/cc', target);
    assert.equal(bad.code, 1);
    assert.match(bad.err, /LIGHT_TOOLCHAIN_PROVENANCE is 'off'; it is 'required' or unset/);
});

test('on a machine, a toolchain is checked when gh is signed in, and said to be unchecked when it is not', async () => {
    const k = await key();
    const bytes = toolchainArchive({ unit: 'tool/cc', key: k, commit: git('rev-parse', 'HEAD') });
    toolchains = new Map([[`toolchain-tool-cc-${k}.tar.zst`, { bytes, created: '2026-10-01T00:00:00Z' }]]);
    attestations = new Map();
    const target = path.join(root, 'fetched-machine');
    signedIn = false;
    const unchecked = await store('toolchain-fetch', 'tool/cc', target);
    assert.equal(unchecked.code, 0, unchecked.err);
    assert.match(unchecked.err, /its provenance is NOT verified: gh is missing or not signed in here/);
    fs.rmSync(target, { recursive: true, force: true });
    signedIn = true;
    try {
        const refused = await store('toolchain-fetch', 'tool/cc', target);
        assert.equal(refused.code, 1);
        assert.match(refused.err, /refused: no attestation says/);
        attest(bytes);
        const checked = await store('toolchain-fetch', 'tool/cc', target);
        assert.equal(checked.code, 0, checked.err);
        assert.match(checked.err, /as its attestation says/);
    } finally {
        signedIn = false;
        fs.rmSync(target, { recursive: true, force: true });
    }
});

/** A zip holding `bytes` as the one file `name`, as upload-artifact makes one. */
function zipOf(name, bytes) {
    const dir = fs.mkdtempSync(path.join(root, 'out-'));
    fs.writeFileSync(path.join(dir, name), bytes);
    execFileSync('zip', ['-q', '-0', 'a.zip', name], { cwd: dir });
    return fs.readFileSync(path.join(dir, 'a.zip'));
}

test("a pull request reuses its own earlier build of a unit, and never another pull request's", async () => {
    const file = await archived();
    const name = path.basename(file, '.tar.zst');
    const mine = fs.readFileSync(file);
    const theirs = toolchainArchive({ unit: 'tool/cc', key: await key(), commit: git('rev-parse', 'HEAD') }, { 'bin/cc': '#!/bin/sh\necho theirs\n' });
    attestations = new Map();
    attest(mine, 'refs/pull/7/merge');
    attest(theirs, 'refs/pull/8/merge');
    artifactDownloads.length = 0;
    // Newest first: another pull request's of the same name and branch, then
    // one of another branch, then an expired one, then this one's.
    artifacts = [
        { id: 1, name, zip: zipOf(`${name}.tar.zst`, mine), branch: 'feature', created: '2026-10-01T00:00:00Z' },
        { id: 2, name, zip: zipOf(`${name}.tar.zst`, mine), branch: 'feature', created: '2026-10-02T00:00:00Z', expired: true },
        { id: 3, name, zip: zipOf(`${name}.tar.zst`, theirs), branch: 'other', created: '2026-10-03T00:00:00Z' },
        { id: 4, name, zip: zipOf(`${name}.tar.zst`, theirs), branch: 'feature', created: '2026-10-04T00:00:00Z' },
    ];
    const out = path.join(root, 'out-artifact');
    const token = { GH_TOKEN: 'token' };
    const r = await storeWith(token, 'toolchain-artifact', 'tool/cc', out, '--ref', 'refs/pull/7/merge', '--branch', 'feature');
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out.trim(), path.join(out, `${name}.tar.zst`));
    assert.deepEqual(fs.readFileSync(r.out.trim()), mine);
    assert.match(r.err, /artifact 4 has no attestation that .* built it on refs\/pull\/7\/merge; skipping it/);
    assert.match(r.err, /taking artifact 1/);
    // The other branch's and the expired one were never downloaded.
    assert.deepEqual(artifactDownloads, [4, 1]);
    // The pull request it was attested for is the only one that takes it.
    fs.rmSync(out, { recursive: true, force: true });
    const other = await storeWith(token, 'toolchain-artifact', 'tool/cc', out, '--ref', 'refs/pull/9/merge');
    assert.equal(other.code, 3, other.err);
    assert.match(other.err, /no artifact toolchain-tool-cc-[0-9a-f]{40} built on refs\/pull\/9\/merge; it builds/);
    assert.equal(fs.existsSync(out), false);
    // Another key's artifact is not even looked at.
    artifacts = [];
    const none = await storeWith(token, 'toolchain-artifact', 'tool/cc', out, '--ref', 'refs/pull/7/merge');
    assert.equal(none.code, 3);
    assert.match(none.err, /no unexpired artifact toolchain-tool-cc-/);
    const noToken = await store('toolchain-artifact', 'tool/cc', out, '--ref', 'refs/pull/7/merge');
    assert.equal(noToken.code, 1);
    assert.match(noToken.err, /needs GH_TOKEN/);
});
