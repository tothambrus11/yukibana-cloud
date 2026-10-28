// Deletes the Actions caches of Light's pack builds that nothing will
// restore again, one ref at a time, and never another ref's.
//
//   node cache-prune.mjs --ref <ref>       on <ref> (a run's own GITHUB_REF),
//       every Light build cache but the newest of each prefix
//   node cache-prune.mjs --stale-pulls     on every refs/pull/<n>/merge: all
//       of a closed pull request's Light build caches, and an open one's
//       all but the newest of each prefix
//
// A Light build cache is one of a toolchain unit, light/<pack>/<unit>/...,
// or of an unsplit pack, light-<pack>-...; its prefix is that start, up to
// and including the separator, so one unit's never matches another's
// (haskell/ghc and haskell/ghc-wasm). Any other key is left alone.
//
// Why by ref. A cache belongs to the ref that saved it: a pull request's run
// can restore main's caches but not delete them unless it is handed
// `actions: write`, and a delete without `--ref` deletes the key on every
// ref. Pruning across refs let a pull request delete main's warm cache of a
// compiler, so main rebuilt it cold (RR3-7). So light-packs.yml prunes only
// main's own caches, in a job only main runs, and light-caches.yml prunes the
// pull requests' on a schedule, from main; pull request runs have
// `actions: read` and prune nothing. Every delete names its ref.
//
// Reads with `gh cache list` and `gh pr list`, deletes with
// `gh cache delete <key> --ref <ref>`, in the repository GITHUB_REPOSITORY
// (or gh's own), with GH_TOKEN. Each deletion is printed; a failed one is
// named and makes the exit status 1 after the rest are tried.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * One Actions cache as `gh cache list --json key,ref,createdAt` gives it.
 * @typedef {{ key: string, ref: string, createdAt: string }} Cache
 */

/**
 * The prefix a Light build cache's key starts with: `light/<pack>/<unit>/`
 * for a toolchain unit, `light-<pack>-` for an unsplit pack (a pack's name
 * has no `-`); null for any other key, which is no cache of Light's builds.
 * @param {string} key
 * @returns {string | null}
 */
export function prefixOf(key) {
    const unit = /^light\/[a-z][a-z0-9]*\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\//.exec(key);
    if (unit) return unit[0];
    const pack = /^light-[a-z][a-z0-9]*-/.exec(key);
    return pack ? pack[0] : null;
}

/**
 * The pull request number of a ref `refs/pull/<n>/merge`, or null.
 * @param {string} ref
 * @returns {number | null}
 */
export function pullOf(ref) {
    const m = /^refs\/pull\/([1-9][0-9]*)\/merge$/.exec(ref);
    return m ? Number(m[1]) : null;
}

/**
 * Of `caches`, those on ref `ref` that are not the newest of their prefix:
 * the newest holds everything the older ones did, as each build restored
 * the newest before it saved. Ties keep the one listed first.
 * @param {readonly Cache[]} caches
 * @param {string} ref
 * @returns {Cache[]}
 */
export function olderOnRef(caches, ref) {
    /** @type {Map<string, Cache>} */
    const newest = new Map();
    const ours = caches.filter((c) => c.ref === ref && prefixOf(c.key) !== null);
    for (const c of ours) {
        const p = /** @type {string} */ (prefixOf(c.key));
        const kept = newest.get(p);
        if (kept === undefined || c.createdAt > kept.createdAt) newest.set(p, c);
    }
    return ours.filter((c) => newest.get(/** @type {string} */ (prefixOf(c.key))) !== c);
}

/**
 * Of `caches`, the Light build caches of pull requests to delete: every one
 * of a pull request not in `open`, and an open one's older ones
 * (olderOnRef). A cache on any ref that is no pull request's merge ref,
 * main's above all, is never among them.
 * @param {readonly Cache[]} caches
 * @param {ReadonlySet<number>} open
 * @returns {Cache[]}
 */
export function stalePullCaches(caches, open) {
    const refs = new Set(caches.map((c) => c.ref).filter((ref) => pullOf(ref) !== null));
    /** @type {Cache[]} */
    const out = [];
    for (const ref of [...refs].sort()) {
        if (open.has(/** @type {number} */ (pullOf(ref)))) out.push(...olderOnRef(caches, ref));
        else out.push(...caches.filter((c) => c.ref === ref && prefixOf(c.key) !== null));
    }
    return out;
}

/**
 * Parses what gh printed as JSON, naming `what` when it is not the array
 * expected.
 * @param {string} text
 * @param {string} what
 * @returns {unknown[]}
 */
function jsonArray(text, what) {
    /** @type {unknown} */
    let value;
    try {
        value = JSON.parse(text);
    } catch {
        throw new Error(`${what}: not JSON: ${text.slice(0, 200)}`);
    }
    if (!Array.isArray(value)) throw new Error(`${what}: not a list: ${text.slice(0, 200)}`);
    return value;
}

/**
 * The caches gh lists, every field checked.
 * @param {string[]} repo `--repo <r>` or nothing
 * @param {string[]} filter more `gh cache list` options
 * @returns {Cache[]}
 */
function listCaches(repo, filter) {
    const text = execFileSync('gh', ['cache', 'list', ...repo, ...filter, '--limit', '1000', '--json', 'key,ref,createdAt'], { encoding: 'utf8' });
    return jsonArray(text, 'gh cache list').map((c) => {
        if (typeof c !== 'object' || c === null) throw new Error(`gh cache list: an entry is not an object: ${JSON.stringify(c)}`);
        const { key, ref, createdAt } = /** @type {Record<string, unknown>} */ (c);
        if (typeof key !== 'string' || typeof ref !== 'string' || typeof createdAt !== 'string') throw new Error(`gh cache list: an entry lacks key, ref or createdAt: ${JSON.stringify(c)}`);
        return { key, ref, createdAt };
    });
}

/**
 * Runs the command line `args`; returns the exit status.
 * @param {string[]} args
 * @returns {number}
 */
export function main(args) {
    const repo = process.env.GITHUB_REPOSITORY ? ['--repo', process.env.GITHUB_REPOSITORY] : [];
    /** @type {Cache[]} */
    let doomed;
    if (args[0] === '--ref' && args.length === 2 && args[1]) {
        doomed = olderOnRef(listCaches(repo, ['--ref', args[1]]), args[1]);
    } else if (args[0] === '--stale-pulls' && args.length === 1) {
        const pulls = jsonArray(execFileSync('gh', ['pr', 'list', ...repo, '--state', 'open', '--limit', '1000', '--json', 'number'], { encoding: 'utf8' }), 'gh pr list');
        const open = new Set(
            pulls.map((p) => {
                const n = typeof p === 'object' && p !== null ? /** @type {Record<string, unknown>} */ (p).number : undefined;
                if (typeof n !== 'number') throw new Error(`gh pr list: an entry has no number: ${JSON.stringify(p)}`);
                return n;
            }),
        );
        doomed = stalePullCaches(listCaches(repo, []), open);
    } else {
        console.error('usage: cache-prune.mjs --ref <ref> | --stale-pulls');
        return 2;
    }
    let status = 0;
    for (const c of doomed) {
        console.log(`deleting ${c.key} on ${c.ref}`);
        try {
            execFileSync('gh', ['cache', 'delete', c.key, '--ref', c.ref, ...repo], { stdio: ['ignore', 'inherit', 'inherit'] });
        } catch {
            console.error(`cache-prune.mjs: deleting ${c.key} on ${c.ref} failed`);
            status = 1;
        }
    }
    if (doomed.length === 0) console.log('nothing to delete');
    return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (e) {
        console.error(`cache-prune.mjs: ${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 1;
    }
}
