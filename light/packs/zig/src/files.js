// What the Zig pack's workers share: downloads with progress, the in-memory
// file systems the compiler and ZLS see (browser_wasi_shim), and the
// standard library's sources, unpacked from lib.tar (../build.sh).

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
    const dir = mkdirp(root, at < 0 ? '' : path.slice(0, at));
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

/**
 * Unpacks a ustar archive (build.sh writes lib.tar with --format=ustar)
 * into `root`: regular files only, each a view into `bytes`, so the 19 MB
 * of sources are not copied. Paths are the name field, prefixed by the
 * prefix field when there is one.
 */
export function untar(bytes, root) {
    const decoder = new TextDecoder();
    const field = (at, length) => {
        const end = bytes.indexOf(0, at);
        return decoder.decode(bytes.subarray(at, end < 0 || end > at + length ? at + length : end));
    };
    let at = 0;
    let count = 0;
    while (at + 512 <= bytes.length && bytes[at] !== 0) {
        const name = field(at, 100);
        const size = parseInt(field(at + 124, 12).trim() || '0', 8);
        const type = String.fromCharCode(bytes[at + 156] || 48);
        const prefix = field(at + 345, 155);
        const path = prefix ? `${prefix}/${name}` : name;
        if (type === '0') {
            writeFile(root, path, bytes.subarray(at + 512, at + 512 + size));
            count++;
        } else if (type === '5') {
            mkdirp(root, path);
        }
        at += 512 + Math.ceil(size / 512) * 512;
    }
    return count;
}

/**
 * The project's files written into `root` (a directory the compiler sees
 * as its working directory), replacing the ones a previous run wrote but
 * keeping `keep` (the toolchain's own directory).
 */
export function writeProject(root, files, keep) {
    for (const name of [...root.contents.keys()]) if (name !== keep) root.contents.delete(name);
    for (const [path, text] of Object.entries(files)) writeFile(root, path, text);
}
