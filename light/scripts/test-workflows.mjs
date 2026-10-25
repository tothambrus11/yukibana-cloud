// Tests of the rules light-packs.yml (and light-toolchain-unit.yml, which
// only it calls) must keep, which no run of it checks until a release, hours
// in, does the wrong thing: a release never builds or publishes a toolchain,
// never skips a pack, and every script a toolchain's key reads starts the
// workflow; the units build in waves, each with a cache of its own.
//
//   node --test scripts/test-workflows.mjs   (from light/; needs only node)
//
// The workflow is read with readYaml below, a reader of the subset of YAML
// the repository's workflows use, so this runs on a runner with nothing
// installed. Anything outside that subset is an error naming the line, never
// a guess: a misread workflow would make these tests pass on nothing.
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

const read = (file) => /** @type {any} */ (readYaml(fs.readFileSync(path.join(ROOT, file), 'utf8')));
const workflow = read('.github/workflows/light-packs.yml');
const UNIT_WORKFLOW = './.github/workflows/light-toolchain-unit.yml';
const unitWorkflow = read(UNIT_WORKFLOW);
const jobs = /** @type {Record<string, Record<string, any>>} */ (workflow.jobs);
const stepsOf = (job) => /** @type {Array<Record<string, any>>} */ (job.steps ?? []);
const allSteps = Object.values(jobs).flatMap(stepsOf);
const unitSteps = stepsOf(unitWorkflow.jobs.unit);
const waves = Object.entries(jobs).filter(([, job]) => job.uses === UNIT_WORKFLOW);
const uploads = (steps) => steps.filter((s) => String(s.uses ?? '').startsWith('actions/upload-artifact@')).map((s) => String(s.with?.name));
// A step that can build a toolchain: ensure without --fetch-only, or a
// publish.
const builds = (s) => typeof s.run === 'string' && (/toolchain-publish/.test(s.run) || (/pack-toolchain\.sh ensure/.test(s.run) && !/--fetch-only/.test(s.run)));

test('a release run of the pack workflow cannot reach a step that builds or publishes a toolchain', () => {
    // The pack workflow itself builds nothing outside a release's reach...
    for (const step of allSteps.filter(builds)) {
        assert.match(String(step.if ?? ''), /!inputs\.upload/, `step "${step.name}" runs in a release`);
    }
    // ...and the unit workflow, which does, is reached only by the wave
    // jobs, each of which a release skips, and from no event of its own.
    assert.ok(unitSteps.filter(builds).length >= 2, 'the unit workflow has a step that builds a unit and one that publishes it');
    assert.deepEqual(Object.keys(unitWorkflow.on), ['workflow_call']);
    assert.ok(waves.length > 0, 'the pack workflow calls the unit workflow');
    for (const [name, job] of waves) assert.match(String(job.if), /!inputs\.upload/, `job ${name} runs in a release`);
    for (const file of fs.readdirSync(path.join(ROOT, '.github/workflows'))) {
        if (file === 'light-packs.yml') continue;
        const text = fs.readFileSync(path.join(ROOT, '.github/workflows', file), 'utf8');
        assert.doesNotMatch(text, /uses:\s*\S*light-toolchain-unit\.yml/, `${file} calls the unit workflow`);
    }
});

test('a release run fails by name when a unit of a split pack is not in the store', () => {
    const step = stepsOf(jobs.assemble).find((s) => s.name === 'A release never builds a compiler');
    assert.ok(step, 'the assemble job has the step');
    assert.match(String(step.if), /inputs\.upload && steps\.units\.outputs\.missing != ''/);
    assert.match(step.run, /::error title=.*a release never builds a compiler/);
    assert.match(step.run, /exit 1/);
    // and the units it looks for are fetched, never built
    const units = stepsOf(jobs.assemble).find((s) => s.id === 'units');
    assert.match(units.run, /ensure "\$unit" --fetch-only/);
});

test('a release run never skips a pack', () => {
    const gates = Object.entries(jobs)
        .filter(([name]) => name !== 'plan')
        .flatMap(([, job]) => stepsOf(job))
        .filter((s) => s.uses === './.github/actions/once' && s.with?.paths !== undefined);
    assert.equal(gates.length, 1, 'one once gate outside the plan job: the assemble job');
    assert.ok(stepsOf(jobs.assemble).includes(gates[0]));
    assert.match(String(gates[0].if), /!inputs\.upload/);
});

test('every script the toolchain key reads starts the pack workflow', () => {
    const scripts = ['toolchain-key.sh', 'toolchain-build-env.sh', 'pack-lib.sh', 'pack-store.sh', 'pack-toolchain.sh'];
    const files = [...scripts.map((name) => `light/scripts/${name}`), '.github/workflows/light-toolchain-unit.yml'];
    for (const event of ['push', 'pull_request']) {
        const paths = workflow.on[event].paths;
        for (const file of files) assert.ok(paths.includes(file), `${file} is not in on.${event}.paths`);
    }
});

test('what a pack was made from is uploaded beside it under a name no pack-* pattern takes for a pack', () => {
    // The release downloads pattern pack-* straight into static/packs, so
    // every artifact whose name starts with pack- must be a pack; what it
    // was made from is toolchain-key-<pack>, and a unit's toolchain
    // toolchain-<pack>-<unit>-<key>.
    for (const job of ['pack', 'assemble']) {
        const names = uploads(stepsOf(jobs[job]));
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
        assert.equal(job.strategy.matrix.include, `\${{ fromJSON(needs.plan.outputs.${name}) }}`);
        assert.match(String(job.if), new RegExp(`needs\\.plan\\.outputs\\.${name} != '\\[\\]'`));
        // A wave runs whatever the one before it did, so a unit that does
        // not need the failed one still builds.
        assert.match(String(job.if), /!cancelled\(\)/);
    }
    assert.deepEqual(jobs.assemble.needs, ['plan', 'store', 'wave-1', 'wave-2', 'wave-3']);
    // The plan refuses a unit deeper than the waves there are.
    const plan = stepsOf(jobs.plan).find((s) => s.id === 'units');
    for (const m of plan.run.matchAll(/toolchain-plan[^\n]*--waves (\d+)/g)) assert.equal(Number(m[1]), waves.length);
    assert.match(plan.run, /for wave in 1 2 3;/);
});

test('each unit has its own build cache, under a prefix no other unit or pack starts with', () => {
    const restore = unitSteps.find((s) => String(s.uses ?? '').startsWith('actions/cache/restore@'));
    const save = unitSteps.find((s) => String(s.uses ?? '').startsWith('actions/cache/save@'));
    const prefix = 'light/${{ inputs.unit }}/';
    assert.ok(restore.with.key.startsWith(prefix), restore.with.key);
    assert.equal(save.with.key, restore.with.key);
    for (const key of restore.with['restore-keys'].trim().split('\n')) {
        assert.ok(key.startsWith(prefix) && key.endsWith('/'), `restore key ${key}`);
    }
    const prune = unitSteps.find((s) => /gh cache delete/.test(String(s.run ?? '')));
    assert.match(prune.run, /--key "light\/\$UNIT\/"/);
});

test('the pack workflow names no split pack', () => {
    const named = allSteps.filter((s) => /matrix\.pack == '(cpp|stub)'/.test(String(s.if ?? '')));
    assert.deepEqual(named.map((s) => s.name), []);
    // The pack job builds unsplit packs whole; a split one is the assemble
    // job's, from the plan, never listed.
    const listed = jobs.pack.strategy.matrix.include.map((/** @type {{ pack: string }} */ e) => e.pack);
    const split = listed.filter((p) => fs.existsSync(path.join(ROOT, 'light/packs', p, 'toolchains')));
    assert.deepEqual(split, []);
    assert.equal(jobs.assemble.strategy.matrix.pack, '${{ fromJSON(needs.plan.outputs.split) }}');
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
