// Tests of pack-store.sh's reading side (`tree`, `has`, `fetch`), which
// light/setup.sh and every light-packs.yml job rely on, against a server of
// its own that answers like GitHub's releases API: a throwaway git
// repository laid out like this one (light/scripts, light/packs/demo) gets a
// copy of the script, and the store holds archives made here. `publish`
// writes to GitHub and is exercised by light-packs.yml itself.
//
//   node scripts/test-pack-store.mjs      (from light/; needs git, tar, zstd)
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pack-store.sh');

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

// The release the server answers with: asset name -> { bytes, created, digest }.
let assets = new Map();
let releaseExists = true;
const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url === '/repos/test/repo/releases/tags/light-packs') {
        if (!releaseExists) return res.writeHead(404).end(JSON.stringify({ message: 'Not Found', status: '404' }));
        const list = [...assets].map(([name, a]) => ({
            name,
            created_at: a.created,
            digest: a.digest ?? `sha256:${createHash('sha256').update(a.bytes).digest('hex')}`,
            browser_download_url: `${base}/download/${name}`,
        }));
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ assets: list }));
    }
    const name = req.url.replace(/^\/download\//, '');
    const asset = assets.get(name);
    if (!asset) return res.writeHead(404).end();
    res.writeHead(200).end(asset.bytes);
});

/** Runs pack-store.sh; asynchronously, as the server answering it is in this process. */
function store(...args) {
    return new Promise((done) => {
        const child = spawn(path.join(light, 'scripts/pack-store.sh'), args, {
            env: { ...process.env, LIGHT_PACKS_REPO: 'test/repo', LIGHT_PACKS_API: `http://127.0.0.1:${server.address().port}`, GH_TOKEN: '' },
        });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        child.on('close', (code) => done({ code, out, err }));
    });
}
const served = () => fs.readFileSync(path.join(light, 'app/static/packs/demo/server.js'), 'utf8');
const stamp = () => fs.readFileSync(path.join(light, '.pack-trees/demo'), 'utf8').trim();

before(async () => {
    fs.mkdirSync(path.join(light, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(light, 'packs/demo'), { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(light, 'scripts/pack-store.sh'));
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
