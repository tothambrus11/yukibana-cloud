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
import { olderOnRef, prefixOf, pullOf, stalePullCaches } from './cache-prune.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache-prune.mjs');
const MAIN = 'refs/heads/main';
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

/**
 * Runs cache-prune.mjs with `args` against a stand-in gh that answers
 * `cache list` with `caches`, `pr list` with `open`, and fails deleting
 * `failing`; returns the run and every gh call, as its arguments.
 * @param {string[]} args
 * @param {object} world
 * @param {Array<{ key: string, ref: string, createdAt: string }>} world.caches
 * @param {number[]} [world.open]
 * @param {string} [world.failing]
 */
function run(args, { caches, open = [], failing = '' }) {
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
} else if (args[0] === 'cache' && args[1] === 'delete') {
    process.exit(args[2] === ${JSON.stringify(failing)} ? 1 : 0);
} else process.exit(2);
`,
            { mode: 0o755 },
        );
        const r = spawnSync(process.execPath, [SCRIPT, ...args], {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, GITHUB_REPOSITORY: 'test/repo' },
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
