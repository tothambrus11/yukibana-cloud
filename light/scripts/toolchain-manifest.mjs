// The manifest of a toolchain unit's directory, toolchain.json, and the
// sidecar of a pack assembled from its units: the one place their format is
// written and read. pack-toolchain.sh writes a manifest when it builds a
// unit and checks it before reusing or assembling one; pack-store.sh adopts
// the manifest of a unit it fetched. Part of assembly, not of any key.
//
//   node toolchain-manifest.mjs write <dir> <unit> <key> <commit> <knobs-json> <needs-json>
//   node toolchain-manifest.mjs check <dir> <unit> <key|->     prints "<key> <commit>"
//   node toolchain-manifest.mjs adopt <dir> <unit> <key>
//   node toolchain-manifest.mjs overlap <dir>...               refuses two units writing one path
//   node toolchain-manifest.mjs needs <dir>...                 refuses a unit given with another key of a unit it needs
//   node toolchain-manifest.mjs linked <pack> <out> <sidecar> <0|1> <dir>...
//   node toolchain-manifest.mjs sidecar <file>                 prints "<pack> <0|1>", then "<unit> <key> <commit>" per unit
//
// A unit is named <pack>/<unit> (cpp/compilers), as everywhere else.
//
// Every failure is one line on stderr naming the file at fault, and exit 1.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * One regular file of a toolchain, as toolchain.json lists it.
 *
 * `path` is relative to the toolchain directory, with `/` separators.
 * `size` is in bytes. `sha256` is the lower-case hex digest of its content.
 * `mtime` is its modification time exactly as `stat -c '%.9Y'` prints it
 * (seconds since the epoch, a dot, nine digits of nanoseconds), compared as
 * a string: a float would lose the nanoseconds, and with them the cheap
 * check that a file was not touched.
 * @typedef {{ path: string, size: number, sha256: string, mtime: string }} ToolchainFile
 */

/**
 * One symbolic link of a toolchain, kept as a link by assembly.
 * @typedef {{ path: string, target: string }} ToolchainLink
 */

/**
 * toolchain.json, the manifest at the root of every toolchain unit's
 * directory.
 *
 * `format` is 2 (1 named a whole pack, `pack`, before toolchains were
 * units). `unit` and `key` name the toolchain (pack-store.sh toolchain-key
 * <unit>). `commit` is the 40-hex commit it was built at, or 'dirty' when it
 * was built from uncommitted inputs, with a set variant knob, or over a
 * dirty unit it needs: such a toolchain is used locally and never
 * published. `knobs` maps each variant knob that was set to its value.
 * `needs` maps each unit it was built with to that unit's key: what it
 * was built over. With HEAD's keys the unit's own key already covers them;
 * assembly still checks it (the `needs` command), because a unit and a unit
 * it needs taken each at its newest (`ensure --any`) can be of different
 * builds. `built` is an ISO 8601 time. `files` and `links` list everything in
 * the directory but toolchain.json itself, sorted by path; a fetch rewrites
 * each `mtime` to the local copy's, as an archive keeps whole seconds at
 * best.
 * @typedef {{ format: 2, unit: string, key: string, commit: string, knobs: Record<string, string>, needs: Record<string, string>, built: string, files: ToolchainFile[], links: ToolchainLink[] }} Manifest
 */

const MANIFEST = 'toolchain.json';

class Refusal extends Error {}

/** Throws the refusal `why`, which main prints as the one line it says. */
function refuse(why) {
    throw new Refusal(why);
}

/**
 * The modification time of the lstat result `s` exactly as `stat -c '%.9Y'`
 * prints it. `s` must come from a `{ bigint: true }` call.
 * @param {fs.BigIntStats} s
 */
export function mtimeOf(s) {
    const ns = s.mtimeNs;
    return `${ns / 1_000_000_000n}.${(ns % 1_000_000_000n).toString().padStart(9, '0')}`;
}

/**
 * Every entry under `dir` but its top-level toolchain.json, sorted by path
 * (byte order): regular files with size and mtime, and symbolic links with
 * their target. Anything else (a device, a socket, a fifo) is refused, as is
 * a name holding a newline, which no line-based tool could carry.
 * @param {string} dir
 * @returns {{ files: Omit<ToolchainFile, 'sha256'>[], links: ToolchainLink[] }}
 */
export function walk(dir) {
    /** @type {Omit<ToolchainFile, 'sha256'>[]} */
    const files = [];
    /** @type {ToolchainLink[]} */
    const links = [];
    const visit = (/** @type {string} */ rel) => {
        for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
            const p = rel ? `${rel}/${e.name}` : e.name;
            if (p.includes('\n')) refuse(`${JSON.stringify(p)}: a toolchain file's name may not hold a newline`);
            if (e.isDirectory()) visit(p);
            else if (e.isSymbolicLink()) links.push({ path: p, target: fs.readlinkSync(path.join(dir, p)) });
            else if (e.isFile()) {
                if (p === MANIFEST) continue;
                const s = fs.lstatSync(path.join(dir, p), { bigint: true });
                files.push({ path: p, size: Number(s.size), mtime: mtimeOf(s) });
            } else refuse(`${p} is neither a file, a directory nor a symbolic link`);
        }
    };
    visit('');
    const byPath = (/** @type {{ path: string }} */ a, /** @type {{ path: string }} */ b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return { files: files.sort(byPath), links: links.sort(byPath) };
}

/** The sha256 of the file at `file`, hex, read in chunks. */
function sha256Of(/** @type {string} */ file) {
    const hash = createHash('sha256');
    const fd = fs.openSync(file, 'r');
    try {
        const buf = Buffer.allocUnsafe(1 << 20);
        for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0; ) hash.update(buf.subarray(0, n));
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest('hex');
}

/**
 * Reads and shape-checks `dir`/toolchain.json against `unit` and, unless it
 * is '-', `key`. A manifest of another format, unit or key is refused by
 * name: it describes some other toolchain.
 * @returns {Manifest}
 */
export function readManifest(/** @type {string} */ dir, /** @type {string} */ unit, /** @type {string} */ key) {
    /** @type {unknown} */
    let m;
    try {
        m = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
    } catch (e) {
        refuse(`${MANIFEST} is not JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (m === null || typeof m !== 'object' || Array.isArray(m)) refuse(`${MANIFEST} is not an object`);
    const o = /** @type {Record<string, unknown>} */ (m);
    if (o.format !== 2) refuse(`${MANIFEST} is of format ${JSON.stringify(o.format)}, not 2`);
    if (o.unit !== unit) refuse(`${MANIFEST} is of unit ${JSON.stringify(o.unit)}, not ${unit}`);
    if (key !== '-' && o.key !== key) refuse(`${MANIFEST} names the inputs ${JSON.stringify(o.key)}, not ${key}`);
    if (typeof o.key !== 'string' || !/^[0-9a-f]{40}$/.test(o.key)) refuse(`${MANIFEST} names no key (${JSON.stringify(o.key)})`);
    if (typeof o.commit !== 'string' || !/^([0-9a-f]{40}|dirty)$/.test(o.commit)) refuse(`${MANIFEST} names no commit (${JSON.stringify(o.commit)})`);
    if (!Array.isArray(o.files) || !Array.isArray(o.links)) refuse(`${MANIFEST} lists no files and links`);
    for (const f of o.files) {
        if (typeof f?.path !== 'string' || !Number.isSafeInteger(f.size) || typeof f.sha256 !== 'string' || typeof f.mtime !== 'string') {
            refuse(`${MANIFEST} has a malformed file entry: ${JSON.stringify(f)}`);
        }
    }
    for (const l of o.links) {
        if (typeof l?.path !== 'string' || typeof l.target !== 'string') refuse(`${MANIFEST} has a malformed link entry: ${JSON.stringify(l)}`);
    }
    return /** @type {Manifest} */ (m);
}

/**
 * Compares what `found` holds with what manifest `m` lists, by path, and
 * refuses the first difference by name: a file gone, a file not listed, a
 * link changed, or a file for which `same(listed, found)` says why it
 * differs (a string) instead of returning null.
 * @param {Manifest} m
 * @param {ReturnType<typeof walk>} found
 * @param {(listed: ToolchainFile, found: Omit<ToolchainFile, 'sha256'>) => string | null} same
 */
function compare(m, found, same) {
    const have = new Map(found.files.map((f) => [f.path, f]));
    for (const f of m.files) {
        const h = have.get(f.path);
        if (!h) refuse(`${f.path} is listed in ${MANIFEST} but gone`);
        const why = same(f, h);
        if (why) refuse(`${f.path} ${why}`);
        have.delete(f.path);
    }
    for (const p of have.keys()) refuse(`${p} is not listed in ${MANIFEST}`);
    const links = new Map(found.links.map((l) => [l.path, l.target]));
    for (const l of m.links) {
        if (links.get(l.path) !== l.target) refuse(`${l.path} is not the link to ${l.target} that ${MANIFEST} lists`);
        links.delete(l.path);
    }
    for (const p of links.keys()) refuse(`${p} is not listed in ${MANIFEST}`);
}

/**
 * The unit `dir`/toolchain.json names, unchecked, for the commands that take
 * whichever units they are given; readManifest then checks the rest.
 */
function readUnit(/** @type {string} */ dir) {
    try {
        const u = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'))?.unit;
        if (typeof u === 'string') return u;
    } catch {
        // Named below, by readManifest.
    }
    return '?';
}

/** `size` and `mtime` agree, the cheap check that a file was not touched. */
const untouched = (/** @type {ToolchainFile} */ f, /** @type {Omit<ToolchainFile, 'sha256'>} */ h) =>
    f.size !== h.size ? `changed size (${f.size} bytes listed, ${h.size} found)` : f.mtime !== h.mtime ? `changed (modified at ${h.mtime}, listed at ${f.mtime})` : null;

const commands = {
    /** Writes the manifest of the freshly built toolchain `dir`. */
    write(/** @type {string[]} */ [dir, unit, key, commit, knobs, needs]) {
        const found = walk(dir);
        /** @type {Manifest} */
        const m = {
            format: 2,
            unit,
            key,
            commit,
            knobs: JSON.parse(knobs),
            needs: JSON.parse(needs),
            built: new Date().toISOString(),
            files: found.files.map((f) => ({ path: f.path, size: f.size, sha256: sha256Of(path.join(dir, f.path)), mtime: f.mtime })),
            links: found.links,
        };
        fs.writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(m, null, 1)}\n`);
    },
    /** Whether `dir` is still exactly the toolchain its manifest lists, by size and mtime; prints its key and commit. */
    check(/** @type {string[]} */ [dir, unit, key]) {
        const m = readManifest(dir, unit, key);
        compare(m, walk(dir), untouched);
        console.log(`${m.key} ${m.commit}`);
    },
    /** Checks a fetched toolchain's every file by size and sha256, then records the local mtimes. */
    adopt(/** @type {string[]} */ [dir, unit, key]) {
        const m = readManifest(dir, unit, key);
        if (m.commit === 'dirty') refuse(`${MANIFEST} names no commit ("dirty"): a dirty toolchain is never stored`);
        const found = walk(dir);
        compare(m, found, (f, h) =>
            f.size !== h.size ? `is ${h.size} bytes, not the ${f.size} listed` : sha256Of(path.join(dir, f.path)) !== f.sha256 ? 'does not have the sha256 listed' : null,
        );
        const local = new Map(found.files.map((f) => [f.path, f.mtime]));
        for (const f of m.files) f.mtime = /** @type {string} */ (local.get(f.path));
        fs.writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(m, null, 1)}\n`);
    },
    /**
     * Refuses units whose toolchains `dirs` would write one path of the
     * assembled pack twice: the same file or link in two, or a file in one
     * where another has a directory. Assembly links every unit into one
     * tree, so either would leave one unit's file silently in place of
     * another's.
     */
    overlap(/** @type {string[]} */ dirs) {
        /** @type {Map<string, string>} */
        const owner = new Map();
        /** @type {Map<string, string>} */
        const dirOwner = new Map();
        for (const dir of dirs) {
            const m = readManifest(dir, readUnit(dir), '-');
            for (const p of [...m.files, ...m.links].map((f) => f.path)) {
                const other = owner.get(p);
                if (other) refuse(`${p} is written by both ${other} and ${m.unit}; units of one pack may not write the same path`);
                owner.set(p, m.unit);
                const parts = p.split('/');
                for (let i = 1; i < parts.length; i++) {
                    const d = parts.slice(0, i).join('/');
                    if (!dirOwner.has(d)) dirOwner.set(d, m.unit);
                }
            }
        }
        for (const [p, unit] of owner) {
            const d = dirOwner.get(p);
            if (d) refuse(`${p} is a file of ${unit} and a directory of ${d}; units of one pack may not write the same path`);
        }
    },
    /**
     * Refuses a unit among the toolchains `dirs` whose manifest records a
     * key for a unit it needs that differs from the key of that unit's
     * toolchain among `dirs`: libraries built over one compilers toolchain
     * assembled with another (D44). A needed unit not among `dirs` (of
     * another pack) is not checked here; assemble already takes every unit
     * of its pack.
     */
    needs(/** @type {string[]} */ dirs) {
        const manifests = dirs.map((dir) => readManifest(dir, readUnit(dir), '-'));
        const keyOf = new Map(manifests.map((m) => [m.unit, m.key]));
        for (const m of manifests) {
            const needs = m.needs ?? {};
            if (typeof needs !== 'object' || Array.isArray(needs)) refuse(`${m.unit}'s ${MANIFEST} has a malformed needs: ${JSON.stringify(needs)}`);
            for (const [dep, built] of Object.entries(needs)) {
                const given = keyOf.get(dep);
                if (given !== undefined && given !== built) {
                    refuse(`${m.unit} was built over ${dep} ${built}, but is given with ${dep} ${given}; a unit is assembled only with the toolchains it was built over`);
                }
            }
        }
    },
    /** Checks that assembly left every file of the units `dirs` in `out` as it is in its toolchain, and writes the sidecar. */
    linked(/** @type {string[]} */ [pack, out, sidecar, other, ...dirs]) {
        if (fs.existsSync(path.join(out, MANIFEST))) refuse(`the assembled pack holds a ${MANIFEST}; it is a toolchain's, not the pack's`);
        const units = dirs.map((dir) => {
            const m = readManifest(dir, readUnit(dir), '-');
            /** @type {ToolchainFile[]} */
            const files = [];
            for (const f of m.files) {
                let s;
                try {
                    s = fs.lstatSync(path.join(out, f.path), { bigint: true });
                } catch {
                    refuse(`${f.path}, a file of ${m.unit}, is missing from the assembled pack (did glue.sh remove it?)`);
                }
                if (!s.isFile()) refuse(`${f.path}, a file of ${m.unit}, is no longer a file in the assembled pack`);
                const why = untouched(f, { path: f.path, size: Number(s.size), mtime: mtimeOf(s) });
                if (why) refuse(`${f.path}, a file of ${m.unit}, ${why} in the assembled pack: glue.sh must not change it`);
                files.push({ ...f, mtime: mtimeOf(s) });
            }
            return { unit: m.unit, key: m.key, commit: m.commit, toolchain: path.resolve(dir), files };
        });
        const record = { format: 2, pack, otherToolchain: other === '1', units };
        fs.mkdirSync(path.dirname(sidecar), { recursive: true });
        fs.writeFileSync(sidecar, `${JSON.stringify(record, null, 1)}\n`);
    },
    /** Prints a sidecar's pack and whether another commit's toolchain was allowed, then each unit's name, key and commit. */
    sidecar(/** @type {string[]} */ [file]) {
        /** @type {unknown} */
        let s;
        try {
            s = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) {
            refuse(`${file} cannot be read: ${e instanceof Error ? e.message : String(e)}`);
        }
        const o = /** @type {Record<string, unknown>} */ (s ?? {});
        if (o.format !== 2 || typeof o.pack !== 'string' || !Array.isArray(o.units)) refuse(`${file} is not a sidecar of format 2`);
        console.log(`${o.pack} ${o.otherToolchain === true ? 1 : 0}`);
        for (const u of o.units) {
            if (typeof u?.unit !== 'string' || typeof u.key !== 'string' || typeof u.commit !== 'string') refuse(`${file} has a malformed unit: ${JSON.stringify(u)}`);
            console.log(`${u.unit} ${u.key} ${u.commit}`);
        }
    },
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [command, ...args] = process.argv.slice(2);
    const run = commands[/** @type {keyof typeof commands} */ (command)];
    if (!run) {
        console.error(`toolchain-manifest.mjs: no command ${JSON.stringify(command)} (write, check, adopt, overlap, needs, linked, sidecar)`);
        process.exit(2);
    }
    try {
        run(args);
    } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        console.error(`toolchain-manifest.mjs: ${args[0]}: ${e.message}`);
        process.exit(1);
    }
}
