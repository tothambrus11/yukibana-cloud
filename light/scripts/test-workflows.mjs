// Tests of the rules light-packs.yml (and light-toolchain-unit.yml, which
// only it calls), light-caches.yml and light-release.yml must keep, which no
// run checks until a release, hours in, or a pull request, unnoticed, does
// the wrong thing: a release never builds or publishes a toolchain and
// never skips a pack; the units build in waves, each with a cache of its
// own; only main writes a store or deletes a cache, and never another ref's;
// every toolchain fetched is verified; every third-party action is pinned by
// commit.
//
// Most of these rules are hygiene, not the control: a same-repository pull
// request runs its own copy of the workflows and of this file, so it can
// break any of them on its own branch. The control is that a toolchain is
// used only when its attestation, which carries the ref from the run's
// OIDC token, says main built it (pack-store.sh, Provenance). These rules
// keep main's own workflows from drifting away from that.
//
//   node --test scripts/test-workflows.mjs   (from light/; needs only node)
//
// The workflows are read with readYaml below, a reader of the subset of
// YAML the repository's workflows use, so this runs on a runner with
// nothing installed. Anything outside that subset is an error naming the
// line, never a guess: a misread workflow would make these tests pass on
// nothing. (A `yq` would not do instead: the runners ship one yq, many
// machines another whose YAML 1.1 reads the key `on` as `true`.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Reads YAML text into plain values: block mappings and sequences (a
 * sequence item may open a mapping, `- name: x`), plain, single- and
 * double-quoted scalars, flow sequences of plain scalars (`[a, b]`), literal
 * and folded block scalars (`|`, `|-`, `>`, `>-`), and comments. Plain
 * `true`, `false`, `null` and integers become those values, as a YAML 1.2
 * library would read them; everything else stays a string.
 *
 * Throws an Error naming the line for anything else (anchors, tags, flow
 * mappings, multi-line plain scalars, tabs in indentation, a key twice),
 * because a construct read wrongly would silently change what the tests
 * below look at.
 *
 * @param {string} text
 * @returns {unknown}
 */
export function readYaml(text) {
    const lines = text.split('\n').map((raw, i) => ({ n: i + 1, raw }));
    let at = 0;
    const fail = (line, why) => {
        throw new Error(`line ${line.n}: ${why}: ${line.raw.trim()}`);
    };
    const indentOf = (raw) => raw.length - raw.trimStart().length;
    const significant = (raw) => raw.trim() !== '' && !raw.trimStart().startsWith('#');
    // The next line that is neither blank nor a comment, as { n, raw, indent,
    // text }, or null at the end. A line a sequence item opened a mapping on
    // is rewritten in place (see readSequence), so its indent is the
    // mapping's.
    const peek = () => {
        while (at < lines.length && !significant(lines[at].raw)) at++;
        if (at >= lines.length) return null;
        const line = lines[at];
        if (/^ *\t/.test(line.raw)) fail(line, 'a tab in the indentation');
        const indent = line.indent ?? indentOf(line.raw);
        return { ...line, indent, text: line.raw.slice(indentOf(line.raw)) };
    };

    const scalar = (line, source) => {
        const s = source.trim();
        if (s.startsWith('"')) {
            const m = /^("(?:[^"\\]|\\.)*")\s*(#.*)?$/.exec(s);
            if (!m) fail(line, 'an unterminated or trailing double-quoted scalar');
            return JSON.parse(m[1]);
        }
        if (s.startsWith("'")) {
            const m = /^'((?:[^']|'')*)'\s*(#.*)?$/.exec(s);
            if (!m) fail(line, 'an unterminated or trailing single-quoted scalar');
            return m[1].replaceAll("''", "'");
        }
        if (s.startsWith('[')) {
            const m = /^\[([^\]{}[]*)\]\s*(#.*)?$/.exec(s);
            if (!m) fail(line, 'a flow sequence of more than plain scalars');
            return m[1].trim() === '' ? [] : m[1].split(',').map((item) => scalar(line, item));
        }
        if (/^[&*!{|>]/.test(s)) fail(line, 'an anchor, alias, tag or flow mapping');
        const plain = s.replace(/\s+#.*$/, '');
        if (plain === 'true') return true;
        if (plain === 'false') return false;
        if (plain === 'null' || plain === '~' || plain === '') return null;
        if (/^-?(0|[1-9][0-9]*)$/.test(plain)) return Number(plain);
        return plain;
    };

    // The block scalar after a `|` or `>` header on line `line`, whose
    // content is indented deeper than `parent`.
    const blockScalar = (line, header, parent) => {
        const m = /^([|>])([-+]?)\s*(#.*)?$/.exec(header);
        if (!m) fail(line, 'a block scalar header with an explicit indentation');
        const body = [];
        let indent = null;
        while (at < lines.length) {
            const raw = lines[at].raw;
            if (raw.trim() === '') {
                body.push('');
                at++;
                continue;
            }
            const i = indentOf(raw);
            if (i <= parent) break;
            indent ??= i;
            if (i < indent) fail(lines[at], 'a block scalar line indented less than its first');
            body.push(raw.slice(indent));
            at++;
        }
        while (body.length > 0 && body[body.length - 1] === '') body.pop();
        let value;
        if (m[1] === '|') value = body.join('\n');
        else {
            value = '';
            for (const [i, l] of body.entries()) {
                if (i === 0) value = l;
                else if (l === '') value += '\n';
                else value += value.endsWith('\n') ? l : ` ${l}`;
            }
        }
        if (m[2] === '-' || body.length === 0) return value;
        return `${value}\n`;
    };

    // The value of a key or item whose text after `:` or `-` is `rest`, on
    // line `line` at indent `indent`.
    const valueAfter = (line, rest, indent) => {
        const r = rest.trim();
        if (r.startsWith('|') || r.startsWith('>')) return blockScalar(line, r, indent);
        if (r !== '' && !r.startsWith('#')) {
            const next = peek();
            if (next && next.indent > indent) fail(next, 'a multi-line plain scalar or a value after a key with one');
            return scalar(line, r);
        }
        const next = peek();
        if (!next || next.indent <= indent) return null;
        return readBlock(next.indent);
    };

    const KEY = /^((?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"-][^:#]*?|-[^\s:#][^:#]*?)):(?:\s+(.*))?$/;

    const readMapping = (indent) => {
        const map = {};
        for (let line = peek(); line && line.indent === indent; line = peek()) {
            if (line.text === '-' || line.text.startsWith('- ')) fail(line, 'a sequence item where a key was expected');
            const m = KEY.exec(line.text);
            if (!m) fail(line, 'not a key');
            const key = scalar(line, m[1]);
            if (Object.hasOwn(map, String(key))) fail(line, `${key} twice`);
            at++;
            map[String(key)] = valueAfter(line, m[2] ?? '', indent);
        }
        return map;
    };

    const readSequence = (indent) => {
        const seq = [];
        for (let line = peek(); line && line.indent === indent && (line.text === '-' || line.text.startsWith('- ')); line = peek()) {
            const rest = line.text.slice(1);
            const content = rest.trimStart();
            if (content === '' || content.startsWith('#')) {
                at++;
                const next = peek();
                seq.push(next && next.indent > indent ? readBlock(next.indent) : null);
            } else if (KEY.test(content) && !/^["'[]/.test(content)) {
                // `- key: value` opens a mapping at the content's column: the
                // line is read again as that mapping's first key.
                lines[at] = { n: line.n, raw: line.raw, indent: indent + 1 + (rest.length - content.length) };
                lines[at].raw = ' '.repeat(lines[at].indent) + content;
                seq.push(readMapping(lines[at].indent));
            } else {
                at++;
                seq.push(valueAfter(line, content, indent));
            }
        }
        return seq;
    };

    const readBlock = (indent) => {
        const line = peek();
        return line.text === '-' || line.text.startsWith('- ') ? readSequence(indent) : readMapping(indent);
    };

    const first = peek();
    if (!first) return null;
    if (first.indent !== 0) fail(first, 'the document does not start at column 0');
    const doc = readBlock(0);
    const rest = peek();
    if (rest) fail(rest, 'indented inconsistently with what precedes it');
    return doc;
}

/**
 * One step of a job, as far as these tests read it.
 * @typedef {{ name?: string, id?: string, uses?: string, if?: string, run?: string, env?: Record<string, string>, with?: Record<string, string> }} Step
 */
/**
 * One job, a step list or a call of a reusable workflow.
 * @typedef {{ name?: string, if?: string, needs?: string[], uses?: string, 'runs-on'?: string, permissions?: Record<string, string>, env?: Record<string, string>, strategy?: { matrix: Record<string, unknown> }, steps?: Step[], with?: Record<string, string> }} Job
 */
/**
 * A workflow file.
 * @typedef {{ name?: string, on: Record<string, { paths?: string[] } | null>, permissions?: Record<string, string>, env?: Record<string, string>, jobs: Record<string, Job> }} Workflow
 */

/**
 * Reads the workflow at repository path `file`, refusing one without the
 * `on` and `jobs` mappings every workflow has; the rest of its shape is the
 * typedef's promise, which each test checks as far as it reads.
 * @param {string} file
 * @returns {Workflow}
 */
function readWorkflow(file) {
    const doc = readYaml(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const isMap = (/** @type {unknown} */ v) => typeof v === 'object' && v !== null && !Array.isArray(v);
    if (!isMap(doc)) throw new Error(`${file}: not a mapping`);
    const map = /** @type {Record<string, unknown>} */ (doc);
    if (!isMap(map.on) || !isMap(map.jobs)) throw new Error(`${file}: no on: or jobs: mapping`);
    return /** @type {Workflow} */ (/** @type {unknown} */ (doc));
}

const WORKFLOWS = '.github/workflows';
const workflow = readWorkflow(`${WORKFLOWS}/light-packs.yml`);
const UNIT_WORKFLOW = './.github/workflows/light-toolchain-unit.yml';
const unitWorkflow = readWorkflow(UNIT_WORKFLOW);
const cachesWorkflow = readWorkflow(`${WORKFLOWS}/light-caches.yml`);
const releaseWorkflow = readWorkflow(`${WORKFLOWS}/light-release.yml`);
const modulesWorkflow = readWorkflow(`${WORKFLOWS}/light-modules.yml`);
const jobs = workflow.jobs;
/** @param {Job} job */
const stepsOf = (job) => job.steps ?? [];
const allSteps = Object.values(jobs).flatMap(stepsOf);
const unitJob = /** @type {Job} */ (unitWorkflow.jobs.unit);
const unitSteps = stepsOf(unitJob);
const waves = Object.entries(jobs).filter(([, job]) => job.uses === UNIT_WORKFLOW);
/** @param {Step[]} steps */
const uploads = (steps) => steps.filter((s) => String(s.uses ?? '').startsWith('actions/upload-artifact@')).map((s) => String(s.with?.name));
/** @param {Step[]} steps @param {string} id */
const stepById = (steps, id) => {
    const step = steps.find((s) => s.id === id);
    assert.ok(step, `a step with id ${id}`);
    return step;
};
// A step that can build a toolchain, or write one to the store: ensure
// without --fetch-only, or a publish.
/** @param {Step} s */
const builds = (s) => typeof s.run === 'string' && (/toolchain-publish/.test(s.run) || (/pack-toolchain\.sh ensure/.test(s.run) && !/--fetch-only/.test(s.run)));
/** @param {Step} s */
const writesAStore = (s) => typeof s.run === 'string' && /pack-store\.sh (toolchain-)?publish|gh release (upload|create|delete-asset|edit)/.test(s.run);
/** The condition a step runs under: its job's and its own. @param {Job} job @param {Step} step */
const conditionOf = (job, step) => `${job.if ?? ''} && ${step.if ?? ''}`;
const ON_MAIN = /github\.ref == 'refs\/heads\/main'/;
const ON_TAG = /startsWith\(github\.ref, 'refs\/tags\/light-v'\)/;
/** The scopes a job may ask to write without being main's: signing its own work for its own ref. */
const SIGNING = new Set(['id-token', 'attestations']);
/** The split packs, by their toolchains/ directory. */
const SPLIT = fs.readdirSync(path.join(ROOT, 'light/packs')).filter((p) => fs.existsSync(path.join(ROOT, 'light/packs', p, 'toolchains')));
/** The repository's workflow files and local actions that pin actions, by path. */
const PINNED = [
    `${WORKFLOWS}/light-packs.yml`,
    `${WORKFLOWS}/light-toolchain-unit.yml`,
    `${WORKFLOWS}/light-caches.yml`,
    `${WORKFLOWS}/light-release.yml`,
    `${WORKFLOWS}/light-modules.yml`,
    '.github/actions/once/action.yml',
];

test('a release run of the pack workflow cannot reach a step that builds or publishes a toolchain', () => {
    // The pack workflow itself builds nothing outside a release's reach...
    for (const [name, job] of Object.entries(jobs)) {
        for (const step of stepsOf(job).filter(builds)) {
            assert.match(conditionOf(job, step), /!inputs\.upload/, `step "${step.name}" of job ${name} runs in a release`);
        }
    }
    // ...and the unit workflow, which does, is reached only by the wave
    // jobs, each of which a release skips, and from no event of its own.
    assert.ok(unitSteps.filter(builds).length >= 1, 'the unit workflow has a step that builds its unit');
    assert.deepEqual(Object.keys(unitWorkflow.on), ['workflow_call']);
    assert.ok(waves.length > 0, 'the pack workflow calls the unit workflow');
    for (const [name, job] of waves) assert.match(String(job.if), /!inputs\.upload/, `job ${name} runs in a release`);
    for (const file of fs.readdirSync(path.join(ROOT, WORKFLOWS))) {
        if (file === 'light-packs.yml') continue;
        const text = fs.readFileSync(path.join(ROOT, WORKFLOWS, file), 'utf8');
        assert.doesNotMatch(text, /uses:\s*\S*light-toolchain-unit\.yml/, `${file} calls the unit workflow`);
    }
});

test('a release run fails by name when a unit of a split pack is not in the store', () => {
    const assemble = stepsOf(/** @type {Job} */ (jobs.assemble));
    const step = assemble.find((s) => s.name === 'A release never builds a compiler');
    assert.ok(step, 'the assemble job has the step');
    assert.match(String(step.if), /inputs\.upload && steps\.units\.outputs\.missing != ''/);
    assert.match(String(step.run), /::error title=.*a release never builds a compiler/);
    assert.match(String(step.run), /exit 1/);
    // and the units it looks for are fetched, never built
    assert.match(String(stepById(assemble, 'units').run), /ensure "\$unit" --fetch-only/);
});

test('a release run never skips a pack', () => {
    const gates = Object.entries(jobs)
        .filter(([name]) => name !== 'plan')
        .flatMap(([, job]) => stepsOf(job))
        .filter((s) => s.uses === './.github/actions/once' && s.with?.paths !== undefined);
    assert.equal(gates.length, 1, 'one once gate outside the plan job: the assemble job');
    assert.ok(stepsOf(/** @type {Job} */ (jobs.assemble)).includes(/** @type {Step} */ (gates[0])));
    assert.match(String(gates[0]?.if), /!inputs\.upload/);
});

test('every script that keys, fetches, verifies, builds or assembles a toolchain starts the pack workflow', () => {
    // toolchain-key.sh and toolchain-build-env.sh are the key; pack-lib.sh
    // their helpers; pack-store.sh fetches and verifies; pack-toolchain.sh
    // and toolchain-manifest.mjs build, check and assemble. Not all are key
    // inputs, but a change to any can break a pack, and only this workflow
    // would show it.
    const scripts = ['toolchain-key.sh', 'toolchain-build-env.sh', 'pack-lib.sh', 'pack-store.sh', 'pack-toolchain.sh', 'toolchain-manifest.mjs', 'cache-prune.mjs'];
    const files = [...scripts.map((name) => `light/scripts/${name}`), '.github/workflows/light-toolchain-unit.yml', '.github/workflows/light-caches.yml'];
    for (const event of ['push', 'pull_request']) {
        const paths = workflow.on[event]?.paths ?? [];
        for (const file of files) assert.ok(paths.includes(file), `${file} is not in on.${event}.paths`);
    }
});

test('what a pack was made from is uploaded beside it under a name no pack-* pattern takes for a pack', () => {
    // The release downloads pattern pack-* straight into static/packs, so
    // every artifact whose name starts with pack- must be a pack; what it
    // was made from is toolchain-key-<pack>, and a unit's toolchain
    // toolchain-<pack>-<unit>-<key>.
    for (const job of ['pack', 'assemble']) {
        const names = uploads(stepsOf(/** @type {Job} */ (jobs[job])));
        assert.deepEqual(names.filter((n) => n.startsWith('pack-')), ['pack-${{ matrix.pack }}'], job);
        assert.ok(names.includes('toolchain-key-${{ matrix.pack }}'), `${job}: ${names.join(' ')}`);
    }
    assert.deepEqual(uploads(unitSteps), ['toolchain-${{ env.PACK }}-${{ env.UNIT_NAME }}-${{ inputs.key }}']);
});

test('the units build in three waves, each after the one before, and the packs are assembled after all of them', () => {
    assert.deepEqual(
        waves.map(([name, job]) => [name, job.needs]),
        [
            ['wave-1', ['plan', 'store']],
            ['wave-2', ['plan', 'store', 'wave-1']],
            ['wave-3', ['plan', 'store', 'wave-2']],
        ],
    );
    for (const [name, job] of waves) {
        assert.equal(job.strategy?.matrix.include, `\${{ fromJSON(needs.plan.outputs.${name}) }}`);
        assert.match(String(job.if), new RegExp(`needs\\.plan\\.outputs\\.${name} != '\\[\\]'`));
        // A wave runs whatever the one before it did, so a unit that does
        // not need the failed one still builds.
        assert.match(String(job.if), /!cancelled\(\)/);
    }
    assert.deepEqual(jobs.assemble?.needs, ['plan', 'store', 'wave-1', 'wave-2', 'wave-3']);
    // The plan refuses a unit deeper than the waves there are.
    const plan = String(stepById(stepsOf(/** @type {Job} */ (jobs.plan)), 'units').run);
    for (const m of plan.matchAll(/toolchain-plan[^\n]*--waves (\d+)/g)) assert.equal(Number(m[1]), waves.length);
    assert.match(plan, /for wave in 1 2 3;/);
});

test('a unit job builds the unit its plan found missing, even when another run stores it meanwhile', () => {
    // Fetched instead, its toolchain.json would name the other run's
    // commit, and archive and store-units (clean_toolchain_key) would fail
    // though the right toolchain is in the store. The units it needs are
    // still fetched: --no-build-deps keeps --no-fetch to the unit.
    const build = String(stepById(unitSteps, 'build').run);
    assert.match(build, /pack-toolchain\.sh ensure "\$UNIT"[^\n]*--no-build-deps/);
    assert.match(build, /pack-toolchain\.sh ensure "\$UNIT"[^\n]*--no-fetch/);
});

test('a unit job installs only the system packages in its own key', () => {
    const install = unitSteps.find((s) => s.name === 'Install build dependencies');
    assert.ok(install, 'the unit workflow has the step');
    for (const text of [String(install.if), String(install.run)]) {
        assert.match(text, /UNIT_DIR/);
        assert.doesNotMatch(text, /light\/packs\/(\{0\}|\$PACK)\/deps\.apt/, 'a pack-level deps.apt is in no unit\'s key');
    }
});

test('each unit has its own build cache, under a prefix no other unit or pack starts with', () => {
    const restore = unitSteps.find((s) => String(s.uses ?? '').startsWith('actions/cache/restore@'));
    const save = unitSteps.find((s) => String(s.uses ?? '').startsWith('actions/cache/save@'));
    assert.ok(restore?.with && save?.with);
    const prefix = 'light/${{ inputs.unit }}/';
    assert.ok(String(restore.with.key).startsWith(prefix), restore.with.key);
    assert.equal(save.with.key, restore.with.key);
    for (const key of String(restore.with['restore-keys']).trim().split('\n')) {
        assert.ok(key.startsWith(prefix) && key.endsWith('/'), `restore key ${key}`);
    }
});

test('the pack workflow names no split pack', () => {
    // Which packs are split is data (toolchains/). A job that named one
    // would go on treating it as split, or as whole, after that changed.
    // The store job alone names the stub, to lint its scripts.
    for (const [name, job] of Object.entries(jobs)) {
        for (const step of stepsOf(job)) {
            for (const pack of SPLIT) {
                assert.doesNotMatch(String(step.if ?? ''), new RegExp(`'${pack}'`), `step "${step.name}" of ${name} names ${pack}`);
                if (name !== 'store') assert.doesNotMatch(String(step.run ?? ''), new RegExp(`packs/${pack}\\b|\\b${pack}/[a-z]`), `step "${step.name}" of ${name} names ${pack}`);
            }
        }
    }
    // The pack job builds unsplit packs whole; a split one is the assemble
    // job's, from the plan, never listed.
    const include = /** @type {Array<{ pack: string }>} */ (jobs.pack?.strategy?.matrix.include);
    assert.deepEqual(include.map((e) => e.pack).filter((p) => SPLIT.includes(p)), []);
    assert.equal(jobs.assemble?.strategy?.matrix.pack, '${{ fromJSON(needs.plan.outputs.split) }}');
});

test('workflow-level permissions are read only, and only jobs gated on main or a light-v tag ask to write', () => {
    // Hygiene, not the control (the header says why), so that main's own
    // workflows hand a pull request's run nothing to write with.
    for (const [file, wf] of [
        ['light-packs.yml', workflow],
        ['light-toolchain-unit.yml', unitWorkflow],
        ['light-caches.yml', cachesWorkflow],
        ['light-release.yml', releaseWorkflow],
    ]) {
        const own = /** @type {Workflow} */ (wf);
        // The unit workflow's own block bounds its one job, which signs.
        for (const [scope, level] of Object.entries(own.permissions ?? {})) {
            if (file === 'light-toolchain-unit.yml' && SIGNING.has(scope)) continue;
            assert.notEqual(level, 'write', `${file}: permissions.${scope} is write at the workflow's level`);
        }
        assert.ok(own.permissions, `${file} says what it is granted`);
        for (const [name, job] of Object.entries(own.jobs)) {
            // A call of light-packs.yml must grant what its jobs may ask.
            if (job.uses === './.github/workflows/light-packs.yml') continue;
            const writes = Object.entries(job.permissions ?? {}).filter(([scope, level]) => level === 'write' && !SIGNING.has(scope));
            if (writes.length === 0) continue;
            assert.ok(ON_MAIN.test(String(job.if)) || ON_TAG.test(String(job.if)), `${file}: job ${name} asks to write ${writes.map(([s]) => s).join(', ')} and runs off main`);
        }
    }
    // The unit workflow writes nothing but its own attestation.
    for (const [scope, level] of Object.entries(unitWorkflow.permissions ?? {})) {
        if (level === 'write') assert.ok(SIGNING.has(scope), `light-toolchain-unit.yml asks to write ${scope}`);
    }
});

test('only a job gated on main writes a store, and never in a release', () => {
    for (const [name, job] of Object.entries(jobs)) {
        for (const step of stepsOf(job).filter(writesAStore)) {
            assert.match(conditionOf(job, step), ON_MAIN, `step "${step.name}" of ${name} writes a store off main`);
            assert.match(conditionOf(job, step), /!inputs\.upload/, `step "${step.name}" of ${name} writes a store in a release`);
        }
    }
    assert.deepEqual(unitSteps.filter(writesAStore).map((s) => s.name), []);
    // What main stores is the archive the unit job attested, byte for byte.
    const store = String(stepsOf(/** @type {Job} */ (jobs['store-units'])).find(writesAStore)?.run);
    assert.match(store, /pack-store\.sh toolchain-publish "\$unit" "\$archive"/);
    assert.deepEqual(jobs['store-units']?.needs, ['plan', 'wave-1', 'wave-2', 'wave-3']);
});

test('every toolchain a CI job fetches from the store is verified to be built on main', () => {
    for (const [file, wf] of [
        ['light-packs.yml', workflow],
        ['light-toolchain-unit.yml', unitWorkflow],
    ]) {
        assert.equal(/** @type {Workflow} */ (wf).env?.LIGHT_TOOLCHAIN_PROVENANCE, 'required', file);
        for (const job of Object.values(/** @type {Workflow} */ (wf).jobs)) {
            for (const step of stepsOf(job)) assert.equal(step.env?.LIGHT_TOOLCHAIN_PROVENANCE, undefined, `${file}: step "${step.name}" sets its own`);
        }
    }
    // The archive is signed in the job that built it, for the run's own ref.
    const attest = unitSteps.find((s) => String(s.uses ?? '').startsWith('actions/attest-build-provenance@'));
    assert.ok(attest, 'the unit job attests its archive');
    assert.equal(attest.with?.['subject-path'], '${{ steps.archive.outputs.path }}');
    assert.equal(unitWorkflow.permissions?.['id-token'], 'write');
    for (const [name, job] of waves) assert.equal(job.permissions?.['id-token'], 'write', name);
});

test("a pull request reuses its own earlier build of a unit, and builds nothing it took", () => {
    const earlier = stepById(unitSteps, 'earlier');
    assert.match(String(earlier.if), /github\.event_name == 'pull_request'/);
    assert.match(String(earlier.run), /pack-store\.sh toolchain-artifact "\$UNIT" [^\n]*\n?\s*--ref "\$GITHUB_REF"/);
    // Everything that builds waits on it.
    for (const id of ['build', 'cache']) assert.match(String(stepById(unitSteps, id).if), /steps\.earlier\.outputs\.path == ''/, id);
    const upload = unitSteps.find((s) => String(s.uses ?? '').startsWith('actions/upload-artifact@'));
    assert.equal(upload?.with?.path, '${{ steps.earlier.outputs.path || steps.archive.outputs.path }}');
});

test('no cache is deleted without naming its ref, and only main deletes one', () => {
    /** @type {string[]} */
    const files = [];
    for (const dir of [WORKFLOWS, '.github/actions/once', 'light/scripts']) {
        for (const name of fs.readdirSync(path.join(ROOT, dir))) if (/\.(ya?ml|sh|mjs)$/.test(name) && !name.startsWith('test-')) files.push(`${dir}/${name}`);
    }
    for (const file of files) {
        const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
        for (const line of text.split('\n').filter((l) => /gh cache delete/.test(l) && !/^\s*(#|\/\/)/.test(l))) {
            assert.match(line, /--ref\b/, `${file}: ${line.trim()}`);
        }
        // A command built as a list says --ref in the same list.
        for (const m of text.matchAll(/\['cache', 'delete',[^\]]*\]/g)) assert.match(m[0], /'--ref'/, `${file}: ${m[0]}`);
    }
    // The pack workflow prunes main's own caches only, in a job only main runs.
    const pruning = Object.entries(jobs).filter(([, job]) => stepsOf(job).some((s) => /cache-prune\.mjs --|gh cache delete/.test(String(s.run ?? ''))));
    assert.deepEqual(pruning.map(([name]) => name), ['caches']);
    const caches = /** @type {Job} */ (jobs.caches);
    assert.match(String(caches.if), ON_MAIN);
    assert.match(String(stepsOf(caches).at(-1)?.run), /cache-prune\.mjs --ref "\$GITHUB_REF"/);
    assert.equal(unitSteps.some((s) => /cache-prune|gh cache delete/.test(String(s.run ?? ''))), false);
    // The pull requests' caches go on a schedule, from main.
    assert.deepEqual(Object.keys(cachesWorkflow.on).sort(), ['schedule', 'workflow_dispatch']);
    const prune = /** @type {Job} */ (cachesWorkflow.jobs.prune);
    assert.match(String(prune.if), ON_MAIN);
    assert.match(String(stepsOf(prune).at(-1)?.run), /cache-prune\.mjs --stale-pulls/);
});

test('every third-party action is pinned by commit', () => {
    // A tag can be moved to code nobody reviewed, and the jobs it runs in
    // sign toolchains or write the stores.
    for (const file of PINNED) {
        const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
        for (const [i, line] of lines.entries()) {
            const m = /^\s*(?:-\s+)?uses:\s*(\S+)/.exec(line);
            if (!m || /^\s*#/.test(line)) continue;
            const target = String(m[1]);
            if (target.startsWith('./')) continue;
            assert.match(target, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${file}:${i + 1}: ${target} is not pinned by commit`);
            assert.match(line, /#\s*v\d+(\.\d+)*\s*$/, `${file}:${i + 1}: say which version the commit is`);
        }
    }
});

test('a light-v release is published only once every asset is attached', () => {
    const publish = /** @type {Job} */ (releaseWorkflow.jobs.publish);
    const run = String(stepsOf(publish).find((s) => /gh release create/.test(String(s.run ?? '')))?.run);
    assert.match(run, /gh release create [^\n]*--draft/);
    assert.ok(run.indexOf('--draft=false') > run.indexOf('gh release create'), 'published after the draft is made');
    assert.match(String(publish.if), ON_TAG);
    assert.doesNotMatch(String(publish.if), /yukibana-light/, 'a branch push publishes no release');
});

test('a push to yukibana-light deploys, one deploy at a time, and builds no slow pack to do it', () => {
    // The integration branch goes live at light.yukibana.dev on every push
    // that changes Light, as a tag does; the stores are main's only, so a
    // deploy that built what they lack would build compilers for hours.
    const push = /** @type {{ tags?: string[], branches?: string[], paths?: string[] }} */ (releaseWorkflow.on.push);
    assert.deepEqual(push.tags, ['light-v*']);
    assert.deepEqual(push.branches, ['yukibana-light']);
    for (const p of ['light/**', '.github/workflows/light-release.yml', '.github/workflows/light-packs.yml']) assert.ok(push.paths?.includes(p), `${p} is not in on.push.paths`);
    const deploy = /** @type {Job & { concurrency?: Record<string, unknown>, environment?: Record<string, string> }} */ (releaseWorkflow.jobs.deploy);
    assert.match(String(deploy.if), ON_TAG);
    assert.match(String(deploy.if), /github\.ref == 'refs\/heads\/yukibana-light'/);
    assert.match(String(deploy.if), /github\.event_name == 'push'/, 'a run by hand deploys nothing');
    assert.deepEqual(deploy.concurrency, { group: 'light-deploy', 'cancel-in-progress': false });
    assert.equal(deploy.environment?.name, 'light');
    // The branch's packs run takes stored builds; a tag's does not.
    const packs = /** @type {Job} */ (releaseWorkflow.jobs.packs);
    assert.equal(packs.with?.upload, true);
    assert.equal(packs.with?.stored, "${{ github.event_name == 'push' && github.ref == 'refs/heads/yukibana-light' }}");
    // With `stored`, a pack the store lacks is its newest stored build, and
    // nothing in the pack job builds.
    const pack = stepsOf(/** @type {Job} */ (jobs.pack));
    const lookup = stepById(pack, 'output');
    assert.equal(lookup.env?.STORED, '${{ inputs.upload && inputs.stored && !matrix.deploy-builds }}');
    // Only a pack that builds in minutes may be built by a deploy.
    const include = /** @type {{ pack: string, timeout: number, 'deploy-builds'?: boolean }[]} */ (/** @type {any} */ (jobs.pack).strategy.matrix.include);
    for (const entry of include.filter((e) => e['deploy-builds'])) assert.ok(entry.timeout <= 30, `${entry.pack} says deploy-builds but may take ${entry.timeout} minutes`);
    assert.match(String(lookup.run), /any=\(--any\)/);
    assert.match(String(lookup.run), /pack-store\.sh "\$COMMAND" "\$PACK" "\$\{any\[@\]\}"/);
    assert.match(String(lookup.run), /::error title=\$PACK::[^\n]*a deploy never builds a pack/);
    assert.match(String(lookup.run), /::warning title=\$PACK::/);
    assert.match(String(stepById(pack, 'need').env?.BUILD), /!inputs\.stored/);
    const build = pack.filter((s) => /\.\/build\.sh/.test(String(s.run ?? '')));
    assert.equal(build.length, 1, 'one step runs build.sh');
    assert.match(String(build[0]?.if), /!inputs\.stored/);
    // What the release records is the tree it shipped, not HEAD's.
    const record = pack.find((s) => s.name === 'Record what the pack was made from');
    assert.match(String(record?.run), /\.pack-trees\/\$PACK/);
});

test("the modules' tarballs are released only from a light-modules-v tag, tested first, whole, and never as the latest release", () => {
    // Light's own release (light-v*) stays the repository's latest; the
    // modules' tarballs are what a docs site installs by URL (step MP1).
    const ON_MODULES_TAG = /^startsWith\(github\.ref, 'refs\/tags\/light-modules-v'\)$/;
    assert.deepEqual(modulesWorkflow.on.push, { tags: ['light-modules-v*'] });
    assert.deepEqual(modulesWorkflow.permissions, { contents: 'read' });
    for (const [name, job] of Object.entries(modulesWorkflow.jobs)) {
        const writes = Object.entries(job.permissions ?? {}).filter(([, level]) => level === 'write');
        if (writes.length > 0) assert.match(String(job.if), ON_MODULES_TAG, `job ${name} asks to write off a modules tag`);
    }
    const pack = stepsOf(/** @type {Job} */ (modulesWorkflow.jobs.pack)).map((step) => String(step.run ?? ''));
    const at = (pattern) => pack.findIndex((run) => pattern.test(run));
    assert.ok(at(/node --test "\.\.\/modules\/\*\*\/\*\.test\.mjs"/) !== -1, 'the modules are tested, the installed packages among them');
    assert.ok(at(/node --test/) < at(/build\.mjs --pack/), 'tested before they are packed');
    const publish = /** @type {Job} */ (modulesWorkflow.jobs.publish);
    assert.match(String(publish.if), ON_MODULES_TAG);
    assert.deepEqual(publish.needs, 'pack');
    const run = String(stepsOf(publish).find((s) => /gh release create/.test(String(s.run ?? '')))?.run);
    assert.match(run, /gh release create [^\n]*--draft --latest=false/);
    assert.match(run, /gh release edit [^\n]*--draft=false --latest=false/);
    assert.ok(run.indexOf('--draft=false') > run.indexOf('gh release create'), 'published after the draft is made');
    for (const name of ['protocol', 'runtime']) assert.match(run, new RegExp(`modules/yukibana-${name}-\\$version\\.tgz`), name);
});

// What a runner sets in every job without a workflow saying so.
const RUNNER_ENV = ['CI', 'GITHUB_ACTIONS'];

test("a workflow's own environment cannot change what the script tests it runs check", () => {
    // A step that runs light/scripts/test-*.mjs inherits the workflow's,
    // the job's and its own env, and passes it on to the scripts each test
    // spawns (a test that spawns nothing is not concerned). Every such name a tested script reads must be in that test's
    // OWN list, which it removes before setting what it means; otherwise a
    // workflow env change breaks, or quietly weakens, its own test job, as
    // LIGHT_TOOLCHAIN_PROVENANCE=required once broke light-packs.yml's store
    // job while the tests passed everywhere else.
    const scriptsDir = path.join(ROOT, 'light/scripts');
    const scripts = fs.readdirSync(scriptsDir).filter((f) => /\.(sh|mjs)$/.test(f) && !f.startsWith('test-'));
    const reads = (file, name) => new RegExp(`\\b${name}\\b`).test(fs.readFileSync(path.join(scriptsDir, file), 'utf8'));
    let checked = 0;
    for (const file of fs.readdirSync(path.join(ROOT, WORKFLOWS)).filter((f) => f.endsWith('.yml'))) {
        if (!fs.readFileSync(path.join(ROOT, WORKFLOWS, file), 'utf8').includes('test-')) continue;
        const wf = readWorkflow(`${WORKFLOWS}/${file}`);
        for (const [jobName, job] of Object.entries(wf.jobs)) {
            const defaults = /** @type {{ defaults?: { run?: { 'working-directory'?: string } } }} */ (job).defaults;
            for (const step of stepsOf(job)) {
                const run = typeof step.run === 'string' ? step.run : '';
                const command = /node --test ([^\n]*)/.exec(run);
                if (!command) continue;
                const dir = /** @type {{ 'working-directory'?: string }} */ (step)['working-directory'] ?? defaults?.run?.['working-directory'] ?? '.';
                const env = [...RUNNER_ENV, ...Object.keys(wf.env ?? {}), ...Object.keys(job.env ?? {}), ...Object.keys(step.env ?? {})];
                for (const arg of String(command[1]).split(/\s+/)) {
                    const test = path.resolve(ROOT, dir, arg);
                    if (path.dirname(test) !== scriptsDir || !/^test-.*\.mjs$/.test(path.basename(test))) continue;
                    const source = fs.readFileSync(test, 'utf8');
                    // A test that runs no program passes nothing on.
                    if (!/\b(spawn|spawnSync|execFile|execFileSync)\(/.test(source)) continue;
                    const ownList = /^const OWN = \[([^\]]*)\];/m.exec(source);
                    const own = ownList ? [...String(ownList[1]).matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
                    const tested = scripts.filter((f) => source.includes(f));
                    assert.ok(tested.length > 0, `${path.basename(test)} names no script it tests`);
                    for (const name of env) {
                        const reader = tested.find((f) => reads(f, name));
                        if (!reader) continue;
                        assert.ok(
                            own.includes(name),
                            `${file}: job ${jobName}, step "${step.name}": ${name} reaches ${path.basename(test)}, and ${reader} reads it, but the test's OWN does not clear it`,
                        );
                    }
                    checked++;
                }
            }
        }
    }
    assert.ok(checked >= 4, `only ${checked} script test runs found: the rule reads nothing`);
});

test('the workflow reader reads what YAML means and refuses what it does not know', () => {
    const doc = readYaml(
        [
            'on:',
            '  push:',
            '    paths:',
            '      - a/**   # a comment',
            "      - 'b c'",
            'jobs:',
            '  x:',
            '    needs: [plan, store]',
            '    steps:',
            '      - name: one',
            '        if: >-',
            '          a &&',
            '          b',
            '        run: |',
            '          echo "a: b"',
            '',
            '          # kept',
            '      - uses: x',
            '        with:',
            '          n: 3',
            '          t: true',
        ].join('\n'),
    );
    assert.deepEqual(doc, {
        on: { push: { paths: ['a/**', 'b c'] } },
        jobs: {
            x: {
                needs: ['plan', 'store'],
                steps: [
                    { name: 'one', if: 'a && b', run: 'echo "a: b"\n\n# kept\n' },
                    { uses: 'x', with: { n: 3, t: true } },
                ],
            },
        },
    });
    assert.throws(() => readYaml('a: &x 1'), /line 1: an anchor/);
    assert.throws(() => readYaml('a: 1\na: 2'), /line 2: a twice/);
    assert.throws(() => readYaml('a: b\n  c'), /line 2/);
});
