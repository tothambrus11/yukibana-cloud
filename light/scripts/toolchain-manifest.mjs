// The manifest of a toolchain directory, toolchain.json, and the sidecar of a
// pack assembled from one: the one place their format is written and read.
// pack-toolchain.sh writes a manifest when it builds a toolchain and checks
// it before reusing or assembling one; pack-store.sh adopts the manifest of a
// toolchain it fetched. Part of assembly, not of any toolchain's key.
//
//   node toolchain-manifest.mjs write <dir> <pack> <key> <commit> <knobs-json>
//   node toolchain-manifest.mjs check <dir> <pack> <key|->     prints "<key> <commit>"
//   node toolchain-manifest.mjs adopt <dir> <pack> <key>
//   node toolchain-manifest.mjs linked <dir> <pack> <out> <sidecar> <0|1>
//   node toolchain-manifest.mjs sidecar <file>                 prints "<pack> <key> <commit> <0|1>"
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
 * toolchain.json, the manifest at the root of every toolchain directory.
 *
 * `format` is 1. `pack` and `key` name the toolchain (pack-store.sh
 * toolchain-key). `commit` is the 40-hex commit it was built at, or 'dirty'
 * when it was built from uncommitted inputs or with a set variant knob: such
 * a toolchain is used locally and never published. `knobs` maps each variant
 * knob that was set to its value. `built` is an ISO 8601 time. `files` and
 * `links` list everything in the directory but toolchain.json itself,
 * sorted by path; a fetch rewrites each `mtime` to the local copy's, as an
 * archive keeps whole seconds at best.
 * @typedef {{ format: 1, pack: string, key: string, commit: string, knobs: Record<string, string>, built: string, files: ToolchainFile[], links: ToolchainLink[] }} Manifest
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
 * Reads and shape-checks `dir`/toolchain.json against `pack` and, unless it
 * is '-', `key`. A manifest of another format, pack or key is refused by
 * name: it describes some other toolchain.
 * @returns {Manifest}
 */
export function readManifest(/** @type {string} */ dir, /** @type {string} */ pack, /** @type {string} */ key) {
    /** @type {unknown} */
    let m;
    try {
        m = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
    } catch (e) {
        refuse(`${MANIFEST} is not JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (m === null || typeof m !== 'object' || Array.isArray(m)) refuse(`${MANIFEST} is not an object`);
    const o = /** @type {Record<string, unknown>} */ (m);
    if (o.pack !== pack) refuse(`${MANIFEST} is of pack ${JSON.stringify(o.pack)}, not ${pack}`);
    if (key !== '-' && o.key !== key) refuse(`${MANIFEST} names the inputs ${JSON.stringify(o.key)}, not ${key}`);
    if (typeof o.key !== 'string' || !/^[0-9a-f]{40}$/.test(o.key)) refuse(`${MANIFEST} names no key (${JSON.stringify(o.key)})`);
    if (typeof o.commit !== 'string' || !/^([0-9a-f]{40}|dirty)$/.test(o.commit)) refuse(`${MANIFEST} names no commit (${JSON.stringify(o.commit)})`);
    if (o.format !== 1) refuse(`${MANIFEST} is of format ${JSON.stringify(o.format)}, not 1`);
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

/** `size` and `mtime` agree, the cheap check that a file was not touched. */
const untouched = (/** @type {ToolchainFile} */ f, /** @type {Omit<ToolchainFile, 'sha256'>} */ h) =>
    f.size !== h.size ? `changed size (${f.size} bytes listed, ${h.size} found)` : f.mtime !== h.mtime ? `changed (modified at ${h.mtime}, listed at ${f.mtime})` : null;

const commands = {
    /** Writes the manifest of the freshly built toolchain `dir`. */
    write(/** @type {string[]} */ [dir, pack, key, commit, knobs]) {
        const found = walk(dir);
        /** @type {Manifest} */
        const m = {
            format: 1,
            pack,
            key,
            commit,
            knobs: JSON.parse(knobs),
            built: new Date().toISOString(),
            files: found.files.map((f) => ({ path: f.path, size: f.size, sha256: sha256Of(path.join(dir, f.path)), mtime: f.mtime })),
            links: found.links,
        };
        fs.writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(m, null, 1)}\n`);
    },
    /** Whether `dir` is still exactly the toolchain its manifest lists, by size and mtime; prints its key and commit. */
    check(/** @type {string[]} */ [dir, pack, key]) {
        const m = readManifest(dir, pack, key);
        compare(m, walk(dir), untouched);
        console.log(`${m.key} ${m.commit}`);
    },
    /** Checks a fetched toolchain's every file by size and sha256, then records the local mtimes. */
    adopt(/** @type {string[]} */ [dir, pack, key]) {
        const m = readManifest(dir, pack, key);
        if (m.commit === 'dirty') refuse(`${MANIFEST} names no commit ("dirty"): a dirty toolchain is never stored`);
        const found = walk(dir);
        compare(m, found, (f, h) =>
            f.size !== h.size ? `is ${h.size} bytes, not the ${f.size} listed` : sha256Of(path.join(dir, f.path)) !== f.sha256 ? 'does not have the sha256 listed' : null,
        );
        const local = new Map(found.files.map((f) => [f.path, f.mtime]));
        for (const f of m.files) f.mtime = /** @type {string} */ (local.get(f.path));
        fs.writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(m, null, 1)}\n`);
    },
    /** Checks that assembly left every toolchain file in `out` as it is in `dir`, and writes the sidecar. */
    linked(/** @type {string[]} */ [dir, pack, out, sidecar, other]) {
        const m = readManifest(dir, pack, '-');
        if (fs.existsSync(path.join(out, MANIFEST))) refuse(`the assembled pack holds a ${MANIFEST}; it is the toolchain's, not the pack's`);
        /** @type {ToolchainFile[]} */
        const files = [];
        for (const f of m.files) {
            let s;
            try {
                s = fs.lstatSync(path.join(out, f.path), { bigint: true });
            } catch {
                refuse(`${f.path}, a file of the toolchain, is missing from the assembled pack (did glue.sh remove it?)`);
            }
            if (!s.isFile()) refuse(`${f.path}, a file of the toolchain, is no longer a file in the assembled pack`);
            const why = untouched(f, { path: f.path, size: Number(s.size), mtime: mtimeOf(s) });
            if (why) refuse(`${f.path}, a file of the toolchain, ${why} in the assembled pack: glue.sh must not change it`);
            files.push({ ...f, mtime: mtimeOf(s) });
        }
        const record = { format: 1, pack: m.pack, key: m.key, commit: m.commit, otherToolchain: other === '1', toolchain: path.resolve(dir), files };
        fs.mkdirSync(path.dirname(sidecar), { recursive: true });
        fs.writeFileSync(sidecar, `${JSON.stringify(record, null, 1)}\n`);
    },
    /** Prints a sidecar's pack, key, commit and whether another commit's toolchain was allowed. */
    sidecar(/** @type {string[]} */ [file]) {
        /** @type {unknown} */
        let s;
        try {
            s = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) {
            refuse(`${file} cannot be read: ${e instanceof Error ? e.message : String(e)}`);
        }
        const o = /** @type {Record<string, unknown>} */ (s ?? {});
        if (o.format !== 1 || typeof o.pack !== 'string' || typeof o.key !== 'string' || typeof o.commit !== 'string') refuse(`${file} is not a sidecar of format 1`);
        console.log(`${o.pack} ${o.key} ${o.commit} ${o.otherToolchain === true ? 1 : 0}`);
    },
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [command, ...args] = process.argv.slice(2);
    const run = commands[/** @type {keyof typeof commands} */ (command)];
    if (!run) {
        console.error(`toolchain-manifest.mjs: no command ${JSON.stringify(command)} (write, check, adopt, linked, sidecar)`);
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
