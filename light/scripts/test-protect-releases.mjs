// Tests of protect-releases.sh, which a repository admin runs once to make
// Light's releases immutable, against a stand-in `gh` that keeps the
// repository's releases, rulesets and immutability setting in a JSON file
// and records every call.
//
//   node --test scripts/test-protect-releases.mjs   (from light/; needs only node and bash)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'protect-releases.sh');

/** The stand-in gh: `release view|create`, and `api` for rulesets, immutability and a release by tag. */
const GH = `#!/usr/bin/env node
const fs = require('fs');
const file = process.env.FAKE_STATE;
const s = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
s.calls.push(args);
const done = (code, out = '') => { fs.writeFileSync(file, JSON.stringify(s)); process.stdout.write(out); process.exit(code); };
const input = () => JSON.parse(fs.readFileSync(0, 'utf8'));
if (args[0] === 'release' && args[1] === 'view') done(s.releases[args[2]] ? 0 : 1);
if (args[0] === 'release' && args[1] === 'create') { s.releases[args[2]] = { immutable: s.immutable && s.lockStores }; done(0); }
if (args[0] !== 'api') done(2);
const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
const url = args.find((a) => a.startsWith('repos/'));
if (url.startsWith('repos/test/repo/rulesets?')) done(0, s.rulesets.filter((r) => r.name === 'light-v releases').map((r) => r.id).join('\\n') + (s.rulesets.length ? '\\n' : ''));
if (url === 'repos/test/repo/rulesets' && method === 'POST') { s.rulesets.push({ id: 10 + s.rulesets.length, ...input() }); done(0); }
const put = /^repos\\/test\\/repo\\/rulesets\\/(\\d+)$/.exec(url);
if (put && method === 'PUT') { const i = s.rulesets.findIndex((r) => r.id === Number(put[1])); s.rulesets[i] = { id: Number(put[1]), ...input() }; done(0); }
if (url === 'repos/test/repo/immutable-releases') {
    s.immutable = method === 'PUT';
    if (s.immutable && s.lockStores) for (const r of Object.values(s.releases)) r.immutable = true;
    done(0);
}
const tag = /^repos\\/test\\/repo\\/releases\\/tags\\/(.+)$/.exec(url);
if (tag) done(0, String(s.releases[tag[1]]?.immutable ?? false) + '\\n');
done(2);
`;

/**
 * Runs protect-releases.sh against a repository in `state`; returns the run
 * and the state afterwards.
 * @param {Record<string, unknown>} state
 */
function protect(state) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protect-releases-test-'));
    try {
        const file = path.join(dir, 'state.json');
        fs.writeFileSync(file, JSON.stringify({ releases: {}, rulesets: [], immutable: false, lockStores: false, calls: [], ...state }));
        fs.writeFileSync(path.join(dir, 'gh'), GH, { mode: 0o755 });
        const r = spawnSync('bash', [SCRIPT], {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, FAKE_STATE: file, LIGHT_PACKS_REPO: 'test/repo' },
        });
        return { ...r, state: JSON.parse(fs.readFileSync(file, 'utf8')) };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('the stores exist before release immutability is on, and light-v tags can neither move nor be deleted', () => {
    const r = protect({});
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(Object.keys(r.state.releases).sort(), ['light-packs', 'light-toolchains']);
    assert.equal(r.state.immutable, true);
    const order = r.state.calls.map((/** @type {string[]} */ c) => `${c[0]} ${c[1]} ${c.find((a) => a.startsWith('repos/')) ?? c[2]}`);
    const created = order.lastIndexOf('release create light-toolchains');
    const locked = order.findIndex((/** @type {string} */ c) => c.endsWith('repos/test/repo/immutable-releases'));
    assert.ok(created >= 0 && created < locked, order.join('\n'));
    assert.equal(r.state.rulesets.length, 1);
    const [ruleset] = r.state.rulesets;
    assert.equal(ruleset.target, 'tag');
    assert.equal(ruleset.enforcement, 'active');
    assert.deepEqual(ruleset.conditions.ref_name.include, ['refs/tags/light-v*']);
    assert.deepEqual(ruleset.rules.map((/** @type {{ type: string }} */ x) => x.type).sort(), ['deletion', 'update']);
});

test('running it again changes the ruleset in place rather than adding a second', () => {
    const r = protect({ rulesets: [{ id: 10, name: 'light-v releases', rules: [] }], releases: { 'light-packs': {}, 'light-toolchains': {} } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.state.rulesets.length, 1);
    assert.equal(r.state.rulesets[0].rules.length, 2);
    assert.ok(!r.state.calls.some((/** @type {string[]} */ c) => c[1] === 'create'));
});

test('a store that immutability would lock turns immutability off again and fails by name', () => {
    const r = protect({ lockStores: true });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /release light-packs is immutable, so the store could take no new build; release immutability is off again/);
    assert.equal(r.state.immutable, false);
});
