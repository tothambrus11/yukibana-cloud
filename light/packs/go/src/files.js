// What the Go pack's workers share: downloads with progress, the in-memory
// file system the compiler and linker see (browser_wasi_shim), and the
// standard library's index (std/index.json, written by ../build.sh).

import { Directory, File } from '@bjorn3/browser_wasi_shim';

/* global PACK_SIZES */
/** Decoded sizes of the pack's files by name (build.sh), for progress. */
const SIZES = typeof PACK_SIZES === 'object' ? PACK_SIZES : {};

/**
 * Downloads `name` (relative to the pack's directory) and resolves to its
 * bytes, calling `onLoading(label, loaded, total)` as they arrive. `total`
 * is the decoded size when build.sh recorded it, else what arrived so far.
 */
export async function download(name, onLoading = () => {}) {
    const response = await fetch(new URL(name, import.meta.url));
    if (!response.ok || !response.body) throw new Error(`${name}: HTTP ${response.status}`);
    const total = SIZES[name] ?? Number(response.headers.get('content-length') ?? 0);
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    onLoading(name, 0, total);
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        onLoading(name, loaded, Math.max(total, loaded));
    }
    const bytes = new Uint8Array(loaded);
    let at = 0;
    for (const c of chunks) {
        bytes.set(c, at);
        at += c.length;
    }
    return bytes;
}

/** Downloads a wasm module, with download()'s progress, and compiles it. */
export async function compileModule(name, onLoading = () => {}) {
    return WebAssembly.compile(await download(name, onLoading));
}

// ---------------------------------------------------------------- file system

/** The directory at `path` under `root`, created with its parents. */
export function mkdirp(root, path) {
    let dir = root;
    for (const part of path.split('/')) {
        if (!part || part === '.') continue;
        let next = dir.contents.get(part);
        if (!next) {
            next = new Directory(new Map());
            dir.contents.set(part, next);
            next.parent = dir;
        }
        if (!(next instanceof Directory)) throw new Error(`${path}: ${part} is a file`);
        dir = next;
    }
    return dir;
}

/** Writes `data` (bytes or text) at `path` under `root`, as a view, not a copy. */
export function writeFile(root, path, data) {
    const at = path.lastIndexOf('/');
    const dir = mkdirp(root, path.slice(0, at));
    // File's constructor copies a Uint8Array; set the view afterwards instead.
    const file = new File(new ArrayBuffer(0));
    file.data = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    dir.contents.set(path.slice(at + 1), file);
    file.parent = dir;
    return file;
}

/** The bytes of the file at `path` under `root`, or null. */
export function readFile(root, path) {
    let node = root;
    for (const part of path.split('/')) if (part) node = node?.contents?.get(part);
    return node instanceof File ? node.data : null;
}

/** Removes `path` under `root`, if it is there. */
export function remove(root, path) {
    const at = path.lastIndexOf('/');
    let node = root;
    for (const part of path.slice(0, at).split('/')) if (part) node = node?.contents?.get(part);
    node?.contents?.delete(path.slice(at + 1));
}

// ---------------------------------------------------------------- standard library

/**
 * The standard library's index, std/index.json:
 *
 *   { toolchain: "1.27.3",
 *     targets: { "linux/amd64": { packages: { "fmt": { imports: [...], size } },
 *                                 unshipped: [...] }, ... } }
 *
 * `packages` are the ones shipped, each with its direct imports (in the
 * standard library) and its archive's size in bytes; `unshipped` the rest
 * of that target's standard library.
 */
export async function loadIndex(onLoading) {
    return JSON.parse(new TextDecoder().decode(await download('std/index.json', onLoading)));
}

/** The index as gotool.wasm's yk_init takes it (project.LibraryIndex). */
export function libraryIndex(index) {
    const out = {};
    for (const [target, { packages, unshipped }] of Object.entries(index.targets)) {
        out[target] = { packages: Object.keys(packages), unshipped };
    }
    return out;
}

/** Where a target's archive of a package is: std/linux-amd64/fmt.a. */
export function archiveName(target, importPath) {
    return `std/${target.replace('/', '-')}/${importPath}.a`;
}

/**
 * Every package `roots` need, directly or not, in the target's standard
 * library, `roots` included, sorted. A package not in the index is left
 * out (the planner reports such an import before anything is fetched).
 */
export function closure(index, target, roots) {
    const packages = index.targets[target]?.packages ?? {};
    const seen = new Set();
    const stack = [...roots];
    while (stack.length) {
        const path = stack.pop();
        if (seen.has(path) || !packages[path]) continue;
        seen.add(path);
        stack.push(...packages[path].imports);
    }
    return [...seen].sort();
}
