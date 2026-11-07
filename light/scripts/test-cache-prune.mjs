// Tests of cache-prune.mjs, which deletes Light's stale build caches from
// light-packs.yml (main's own) and light-caches.yml (the pull requests'):
// the rules as tables, then the command against a stand-in `gh` that
// records what it was asked.
//
//   node --test scripts/test-cache-prune.mjs   (from light/; needs only node)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { branchOf, olderOnRef, prefixOf, pullOf, staleBranchCaches, stalePullCaches } from './cache-prune.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache-prune.mjs');
const MAIN = 'refs/heads/main';
/**
 * The variables cache-prune.mjs gets only from a test: removed from what this
 * process inherited, so a workflow's GH_TOKEN never reaches the stand-in gh
 * (test-workflows.mjs keeps this list covering what the workflows set).
 */
const OWN = ['GH_TOKEN', 'GITHUB_REPOSITORY'];
/** @param {string} key @param {string} ref @param {string} createdAt */
const cache = (key, ref, createdAt) => ({ key, ref, createdAt });

test("a unit's caches and a pack's caches each have a prefix no other unit's or pack's starts with", () => {
    for (const [key, prefix] of [
        ['light/haskell/ghc/abc/1-1', 'light/haskell/ghc/'],
        ['light/haskell/ghc-wasm/abc/1-1', 'light/haskell/ghc-wasm/'],
        ['light/stub/compilers/k/9-2', 'light/stub/compilers/'],
        ['light-java-0123-9-1', 'light-java-'],
        ['light-javascript-0123-9-1', 'light-javascript-'],
        ['light-pack-store-abc', 'light-pack-'],
        ['node-cache-Linux-x64', null],
        ['light/', null],
    ]) assert.equal(prefixOf(String(key)), prefix, String(key));
    assert.equal(pullOf('refs/pull/12/merge'), 12);
    assert.equal(pullOf(MAIN), null);
    assert.equal(pullOf('refs/pull/12/head'), null);
    assert.equal(branchOf('refs/heads/ci/ccache'), 'ci/ccache');
    assert.equal(branchOf('refs/heads/'), null);
    assert.equal(branchOf('refs/pull/12/merge'), null);
});

test('main keeps the newest cache of each unit and pack, and loses no cache of another ref', () => {
    const caches = [
        cache('light/stub/vm/a/1-1', MAIN, '2026-10-01T00:00:00Z'),
        cache('light/stub/vm/b/2-1', MAIN, '2026-10-03T00:00:00Z'),
        cache('light/stub/vm/c/3-1', 'refs/pull/5/merge', '2026-10-04T00:00:00Z'),
        cache('light/stub/vm-x/a/1-1', MAIN, '2026-10-01T00:00:00Z'),
        cache('light-cpp-a-1-1', MAIN, '2026-10-01T00:00:00Z'),
        cache('light-cpp-b-2-1', MAIN, '2026-10-02T00:00:00Z'),
        cache('setup-node-1', MAIN, '2026-09-01T00:00:00Z'),
    ];
    assert.deepEqual(
        olderOnRef(caches, MAIN).map((c) => c.key),
        ['light/stub/vm/a/1-1', 'light-cpp-a-1-1'],
    );
});

test("a closed pull request's caches all go, an open one's keep their newest, and main's are never touched", () => {
    const caches = [
        cache('light/stub/vm/a/1-1', 'refs/pull/5/merge', '2026-10-01T00:00:00Z'),
        cache('light/stub/vm/b/2-1', 'refs/pull/5/merge', '2026-10-02T00:00:00Z'),
        cache('light/stub/vm/c/3-1', 'refs/pull/6/merge', '2026-10-01T00:00:00Z'),
        cache('light-cpp-a-1-1', 'refs/pull/6/merge', '2026-10-01T00:00:00Z'),
        cache('other-cache', 'refs/pull/6/merge', '2026-10-01T00:00:00Z'),
        cache('light/stub/vm/d/4-1', MAIN, '2026-09-01T00:00:00Z'),
        cache('light/stub/vm/e/5-1', MAIN, '2026-09-02T00:00:00Z'),
        cache('light/stub/vm/f/6-1', 'refs/heads/feature', '2026-09-02T00:00:00Z'),
    ];
    assert.deepEqual(
        stalePullCaches(caches, new Set([5])).map((c) => `${c.key} ${c.ref}`),
        ['light/stub/vm/a/1-1 refs/pull/5/merge', 'light/stub/vm/c/3-1 refs/pull/6/merge', 'light-cpp-a-1-1 refs/pull/6/merge'],
    );
});

test("a deleted branch's caches all go, an existing one's keep their newest, and main's and the pull requests' are never touched", () => {
    const caches = [
        cache('light/rust/compilers/a/1-1', 'refs/heads/feature', '2026-10-01T00:00:00Z'),
        cache('light/rust/compilers/b/2-1', 'refs/heads/feature', '2026-10-02T00:00:00Z'),
        cache('light/rust/compilers/c/3-1', 'refs/heads/gone', '2026-10-01T00:00:00Z'),
        cache('light-cpp-a-1-1', 'refs/heads/gone', '2026-10-01T00:00:00Z'),
        cache('other-cache', 'refs/heads/gone', '2026-10-01T00:00:00Z'),
        cache('light/rust/compilers/d/4-1', MAIN, '2026-09-01T00:00:00Z'),
        cache('light/rust/compilers/e/5-1', MAIN, '2026-09-02T00:00:00Z'),
        cache('light/rust/compilers/f/6-1', 'refs/pull/5/merge', '2026-09-01T00:00:00Z'),
        cache('light/rust/compilers/g/7-1', 'refs/tags/light-v1', '2026-09-01T00:00:00Z'),
    ];
    assert.deepEqual(
        staleBranchCaches(caches, new Set(['main', 'feature'])).map((c) => `${c.key} ${c.ref}`),
        ['light/rust/compilers/a/1-1 refs/heads/feature', 'light/rust/compilers/c/3-1 refs/heads/gone', 'light-cpp-a-1-1 refs/heads/gone'],
    );
    // Main is spared even when a listing lacks it.
    assert.deepEqual(staleBranchCaches(caches, new Set(['feature'])).filter((c) => c.ref === MAIN), []);
});

/**
 * Runs cache-prune.mjs with `args` against a stand-in gh that answers
 * `cache list` with `caches`, `pr list` with `open`, `api .../branches`
 * with `branches`, and fails deleting `failing`; returns the run and every
 * gh call, as its arguments.
 * @param {string[]} args
 * @param {object} world
 * @param {Array<{ key: string, ref: string, createdAt: string }>} world.caches
 * @param {number[]} [world.open]
 * @param {string[]} [world.branches]
 * @param {string} [world.failing]
 */
function run(args, { caches, open = [], branches = ['main'], failing = '' }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-prune-test-'));
    try {
        const log = path.join(dir, 'calls');
        fs.writeFileSync(path.join(dir, 'caches.json'), JSON.stringify(caches));
        fs.writeFileSync(path.join(dir, 'pulls.json'), JSON.stringify(open.map((number) => ({ number }))));
        fs.writeFileSync(
            path.join(dir, 'gh'),
            `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === 'cache' && args[1] === 'list') {
    const at = args.indexOf('--ref');
    const all = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dir, 'caches.json'))}, 'utf8'));
    process.stdout.write(JSON.stringify(at < 0 ? all : all.filter((c) => c.ref === args[at + 1])));
} else if (args[0] === 'pr' && args[1] === 'list') {
    process.stdout.write(fs.readFileSync(${JSON.stringify(path.join(dir, 'pulls.json'))}, 'utf8'));
} else if (args[0] === 'api' && args.includes('repos/test/repo/branches?per_page=100') && args.includes('--paginate')) {
    process.stdout.write(${JSON.stringify(branches.map((b) => `${b}\n`).join(''))});
} else if (args[0] === 'cache' && args[1] === 'delete') {
    process.exit(args[2] === ${JSON.stringify(failing)} ? 1 : 0);
} else process.exit(2);
`,
            { mode: 0o755 },
        );
        const env = { ...process.env };
        for (const name of OWN) delete env[name];
        const r = spawnSync(process.execPath, [SCRIPT, ...args], {
            encoding: 'utf8',
            env: { ...env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, GITHUB_REPOSITORY: 'test/repo' },
        });
        const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
        return { ...r, calls };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('every cache deleted is deleted on its own ref, and a failed delete fails the run after the rest are tried', () => {
    const caches = [
        cache('light/stub/vm/a/1-1', 'refs/pull/5/merge', '2026-10-01T00:00:00Z'),
        cache('light/stub/vm/b/1-1', 'refs/pull/5/merge', '2026-10-02T00:00:00Z'),
        cache('light-cpp-a-1-1', 'refs/pull/7/merge', '2026-10-01T00:00:00Z'),
        cache('light/stub/vm/c/1-1', MAIN, '2026-10-01T00:00:00Z'),
        cache('light/stub/vm/d/1-1', MAIN, '2026-10-02T00:00:00Z'),
    ];
    const pulls = run(['--stale-pulls'], { caches, open: [5], failing: 'light/stub/vm/a/1-1' });
    assert.equal(pulls.status, 1, pulls.stderr);
    assert.match(pulls.stderr, /deleting light\/stub\/vm\/a\/1-1 on refs\/pull\/5\/merge failed/);
    const deletes = pulls.calls.filter(([a, b]) => a === 'cache' && b === 'delete');
    assert.deepEqual(deletes, [
        ['cache', 'delete', 'light/stub/vm/a/1-1', '--ref', 'refs/pull/5/merge', '--repo', 'test/repo'],
        ['cache', 'delete', 'light-cpp-a-1-1', '--ref', 'refs/pull/7/merge', '--repo', 'test/repo'],
    ]);

    const main = run(['--ref', MAIN], { caches });
    assert.equal(main.status, 0, main.stderr);
    assert.deepEqual(
        main.calls.filter(([a, b]) => a === 'cache' && b === 'delete'),
        [['cache', 'delete', 'light/stub/vm/c/1-1', '--ref', MAIN, '--repo', 'test/repo']],
    );
    assert.ok(main.calls.some((c) => c[1] === 'list' && c.includes('--ref') && c.includes(MAIN)), 'main lists its own ref only');

    const usage = run(['--ref'], { caches });
    assert.equal(usage.status, 2);
    assert.deepEqual(usage.calls, []);
});

test("branches' caches are pruned with the pull requests' in one run, each on its own ref, and a branch listing without main deletes nothing", () => {
    const caches = [
        cache('light/rust/compilers/a/1-1', 'refs/heads/feature', '2026-10-01T00:00:00Z'),
        cache('light/rust/compilers/b/1-1', 'refs/heads/feature', '2026-10-02T00:00:00Z'),
        cache('light/rust/compilers/c/1-1', 'refs/heads/gone', '2026-10-01T00:00:00Z'),
        cache('light/stub/vm/a/1-1', 'refs/pull/5/merge', '2026-10-01T00:00:00Z'),
        cache('light/stub/vm/c/1-1', MAIN, '2026-10-01T00:00:00Z'),
        cache('light/stub/vm/d/1-1', MAIN, '2026-10-02T00:00:00Z'),
    ];
    const both = run(['--stale-pulls', '--stale-branches'], { caches, open: [], branches: ['main', 'feature'] });
    assert.equal(both.status, 0, both.stderr);
    assert.deepEqual(
        both.calls.filter(([a, b]) => a === 'cache' && b === 'delete'),
        [
            ['cache', 'delete', 'light/stub/vm/a/1-1', '--ref', 'refs/pull/5/merge', '--repo', 'test/repo'],
            ['cache', 'delete', 'light/rust/compilers/a/1-1', '--ref', 'refs/heads/feature', '--repo', 'test/repo'],
            ['cache', 'delete', 'light/rust/compilers/c/1-1', '--ref', 'refs/heads/gone', '--repo', 'test/repo'],
        ],
    );
    const lost = run(['--stale-branches'], { caches, branches: [] });
    assert.equal(lost.status, 1);
    assert.match(lost.stderr, /main is not among the branches listed/);
    assert.deepEqual(lost.calls.filter(([a, b]) => a === 'cache' && b === 'delete'), []);
    for (const bad of [['--stale-branches', '--stale-branches'], ['--stale-branches', '--ref', MAIN]]) {
        const usage = run(bad, { caches });
        assert.equal(usage.status, 2, bad.join(' '));
        assert.deepEqual(usage.calls, []);
    }
});
