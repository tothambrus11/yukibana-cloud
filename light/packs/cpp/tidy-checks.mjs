// Prints tidy-checks.json, the clang-tidy checks clangd-tidy.wasm has, for
// the app's rule editor: build-clangd-tidy.sh runs it over the LLVM source
// tree that clangd was built from,
//
//   node tidy-checks.mjs <llvm-project source tree> <LLVM version>
//
// and the result is a pure function of that tree. For each check: its name,
// the first paragraph of its documentation as plain text (`summary`),
// whether it offers fixes, what it is an alias of, and what clangd does with
// it: `speed` is clangd's own measurement (clangd/TidyFastChecks.inc,
// "fast", "slow" or "unknown"), and clangd runs only the fast ones unless
// .clangd's Diagnostics.ClangTidy.FastCheckFilter says otherwise;
// `clangd: false` marks the checks clangd always turns off
// (TidyProvider.cpp, disableUnusableChecks), which may be listed but never
// run. The static analyzer's checks (clang-analyzer-*, and mpi-*, which
// need it) are not linked into clangd and are left out.
//
// Fails, naming what it could not read, rather than print a partial list:
// the editor would offer checks that do not exist, or hide ones that do.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [src, version] = process.argv.slice(2);
if (!src || !version) {
    console.error('usage: node tidy-checks.mjs <llvm-project source tree> <LLVM version>');
    process.exit(2);
}
const extra = join(src, 'clang-tools-extra');
const read = (path) => readFileSync(join(extra, path), 'utf8');

/** `:doc:`name <module/check>`` cells and the rest of a csv-table row. */
const DOC = /:doc:`([a-z0-9.-]+) <([a-z0-9/.-]+)>`/g;
const NOT_LINKED = /^(clang-analyzer|mpi)-/;

const list = read('docs/clang-tidy/checks/list.rst');
const aliasesAt = list.indexOf('Check aliases');
if (aliasesAt < 0) throw new Error('list.rst has no "Check aliases" section');

/** The plain text of reStructuredText inline markup. */
function plain(text) {
    return text
        .replace(/:[a-z]+:`([^`<]*?)\s*<[^>]*>`/g, '$1')
        .replace(/:[a-z]+:`([^`]*)`/g, '$1')
        .replace(/``([^`]*)``/g, '$1')
        .replace(/`([^`<]*?)\s*<[^>]*>`_+/g, '$1')
        .replace(/`([^`]*)`_*/g, '$1')
        .replace(/\*\*([^*]*)\*\*/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * The first paragraph of a check's page after its title that says what it
 * does: not one saying which alias "redirects here", which a page an alias
 * points to often starts with.
 */
function summaryOf(doc) {
    const lines = read(`docs/clang-tidy/checks/${doc}.rst`).split('\n');
    let i = lines.findIndex((l) => /^=+\s*$/.test(l));
    if (i < 0) throw new Error(`${doc}.rst has no title`);
    let first = null;
    for (i++; i < lines.length; ) {
        while (i < lines.length && lines[i].trim() === '') i++;
        const paragraph = [];
        while (i < lines.length && lines[i].trim() !== '') paragraph.push(lines[i++]);
        if (paragraph.length === 0 || /^[-=~^]+$/.test(paragraph.at(-1).trim())) break; // the next section
        if (paragraph[0].startsWith('..')) continue;
        const text = plain(paragraph.join(' '));
        first ??= text;
        if (!/redirects here|is an alias/i.test(text)) return text;
    }
    return first ?? '';
}

const speeds = new Map();
for (const m of read('clangd/TidyFastChecks.inc').matchAll(/^(FAST|SLOW)\(([a-z0-9.-]+),/gm)) speeds.set(m[2], m[1] === 'FAST' ? 'fast' : 'slow');
if (speeds.size === 0) throw new Error('clangd/TidyFastChecks.inc lists no checks');

const provider = read('clangd/TidyProvider.cpp');
const from = provider.indexOf('disableUnusableChecks(');
const to = provider.indexOf('size_t Size', from);
if (from < 0 || to < 0) throw new Error('TidyProvider.cpp has no disableUnusableChecks list');
const unusable = new Set([...provider.slice(from, to).matchAll(/"-([a-z0-9.-]+)"/g)].map((m) => m[1]));
if (unusable.size === 0) throw new Error('disableUnusableChecks names no checks');

const checks = [];
for (const [i, part] of [list.slice(0, aliasesAt), list.slice(aliasesAt)].entries()) {
    for (const row of part.split('\n')) {
        const docs = [...row.matchAll(DOC)];
        if (docs.length === 0) continue;
        const [, name, doc] = docs[0];
        if (NOT_LINKED.test(name)) continue;
        const alias = i === 1 ? docs[1]?.[1] : undefined;
        if (i === 1 && !alias) throw new Error(`list.rst: the alias ${name} names no check`);
        const target = alias ? docs[1][2] : doc;
        checks.push({
            name,
            summary: summaryOf(alias && NOT_LINKED.test(alias) ? doc : target),
            fixes: /"Yes"\s*$/.test(row),
            ...(alias ? { alias } : {}),
            speed: speeds.get(name) ?? 'unknown',
            ...(unusable.has(name) ? { clangd: false } : {}),
        });
    }
}
// An alias of a check that is not linked is not linked either.
const linked = checks.filter((c) => !(c.alias && NOT_LINKED.test(c.alias)));
linked.sort((a, b) => a.name.localeCompare(b.name));
if (linked.length < 300) throw new Error(`only ${linked.length} checks found in list.rst`);
process.stdout.write(JSON.stringify({ llvm: version, checks: linked }) + '\n');
