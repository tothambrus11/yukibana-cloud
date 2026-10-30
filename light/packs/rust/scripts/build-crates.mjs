// Compiles the crates.io packages of crates/ (quickcheck and what it depends
// on) for every target of the runner, and packs their sources for
// rust-analyzer.
//
//   node scripts/build-crates.mjs <toolchain> <cargo target dir> <out dir> <name> <rustc triples> <miri triples>
//
// with the triples comma-separated, and in the environment MIRI and
// CARGO_MIRI (the native Miri and cargo-miri of the same Rust release) and
// MIRI_SYSROOTS, a directory holding Miri's standard library for each Miri
// triple under its triple. Writes into <out dir>:
//
//   <name>-<triple>.tar        for each rustc triple: the crates' rlibs
//                              (lib<crate>.rlib), for the runner's
//                              `--extern` and `-L dependency=`
//   <name>-miri-<triple>.tar   for each Miri triple: their rlibs as Miri
//                              makes them (metadata with every function's
//                              MIR, no code), for Miri's
//   <name>-src.tar             their sources (<package>-<version>/**.rs,
//                              without tests, benches, examples and build
//                              scripts) and crates.json, which tells
//                              rust-analyzer the crate graph: for each crate
//                              its id, name, edition, root file, cfgs and
//                              dependencies, in dependency order, and which
//                              crates a project may name in its Cargo.toml
//                              (`direct`)
//
// Cargo builds them, with Rust's own release of the version the pack's
// rustc.wasm and miri.wasm are (the toolchain argument): a crate is loaded
// only by a compiler whose version string is the same to the byte, and
// ours is built to say what the release says (rustc/build.sh). `cargo
// build --target <triple>` for rustc; `cargo miri build` for Miri, as
// `cargo miri test` builds a project's dependencies (metadata only, with
// MIR, cfg miri). Cargo.lock pins every version and checksum.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET = 'x86_64-unknown-linux-gnu';
const HERE = dirname(fileURLToPath(import.meta.url));
const CRATES = resolve(HERE, '../crates');

const [toolchain, targetDir, outDir, name, rustcList, miriList] = process.argv.slice(2);
if (miriList === undefined || !process.env.MIRI || !process.env.CARGO_MIRI || !process.env.MIRI_SYSROOTS) {
    console.error('usage: MIRI=… CARGO_MIRI=… MIRI_SYSROOTS=… node scripts/build-crates.mjs <toolchain> <cargo target dir> <out dir> <name> <rustc triples> <miri triples>');
    process.exit(2);
}
const rustcTriples = rustcList.split(',').filter(Boolean);
const miriTriples = miriList.split(',').filter(Boolean);

// ---- what Cargo would do

const cargo = (args, env = {}) =>
    execFileSync('cargo', [`+${toolchain}`, ...args], { cwd: CRATES, env: { ...process.env, CARGO_TARGET_DIR: targetDir, ...env }, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const metadata = JSON.parse(cargo(['metadata', '--format-version=1', '--locked', `--filter-platform=${TARGET}`]));
const messages = cargo(['check', '--locked', `--target=${TARGET}`, '--message-format=json'])
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const packages = new Map(metadata.packages.map((p) => [p.id, p]));
const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
const root = metadata.resolve.root;
/** cfgs a build script told Cargo to pass (`cargo:rustc-cfg`), by package id. */
const scriptCfgs = new Map();
/** Variables a build script told Cargo to set (`cargo:rustc-env`), by package id. */
const scriptEnv = new Map();
/** Lib crates in the order Cargo finished them: each after its dependencies. */
const crates = [];
for (const m of messages) {
    if (m.reason === 'build-script-executed') {
        scriptCfgs.set(m.package_id, m.cfgs);
        scriptEnv.set(m.package_id, m.env);
        if (m.linked_libs.length) throw new Error(`${m.package_id}: links ${m.linked_libs.join(', ')}; Miri cannot call native libraries`);
    }
    if (m.reason === 'compiler-artifact' && m.target.kind.includes('lib') && m.package_id !== root) crates.push(m);
}

const pkgOf = (id) => packages.get(id) ?? (() => { throw new Error(`no package ${id}`); })();
const idOf = (pkg) => `${pkg.name}-${pkg.version}`;
const crateName = (m) => m.target.name.replace(/-/g, '_');
/** Normal (not dev, not build) dependencies of a package, as `[extern name, package id]`. */
const depsOf = (id) =>
    nodes.get(id).deps.filter((d) => d.dep_kinds.some((k) => k.kind === null)).map((d) => [d.name, d.pkg]);
const names = new Map();
for (const m of crates) {
    const n = crateName(m);
    if (names.has(n)) throw new Error(`two crates named ${n}: ${names.get(n)} and ${m.package_id}`);
    names.set(n, m.package_id);
}

// ---- the files, in memory

/** A ustar archive of [path, bytes], in the order given; paths up to 255 bytes. */
function tar(entries) {
    const encoder = new TextEncoder();
    const blocks = [];
    for (const [path, data] of entries) {
        const header = new Uint8Array(512);
        const put = (at, length, text) => header.set(encoder.encode(text).subarray(0, length), at);
        let base = path;
        let prefix = '';
        if (encoder.encode(path).length > 100) {
            const cut = path.lastIndexOf('/', 155);
            if (cut <= 0 || encoder.encode(path.slice(cut + 1)).length > 100) throw new Error(`path too long for ustar: ${path}`);
            prefix = path.slice(0, cut);
            base = path.slice(cut + 1);
        }
        put(0, 100, base);
        put(100, 8, '0000644\0');
        put(108, 8, '0000000\0');
        put(116, 8, '0000000\0');
        put(124, 12, `${data.length.toString(8).padStart(11, '0')}\0`);
        put(136, 12, '00000000000\0');
        put(156, 1, '0');
        put(257, 8, 'ustar\x0000');
        put(345, 155, prefix);
        header.fill(32, 148, 156);
        const sum = header.reduce((a, b) => a + b, 0);
        put(148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
        blocks.push(header, data, new Uint8Array((512 - (data.length % 512)) % 512));
    }
    blocks.push(new Uint8Array(1024));
    return Buffer.concat(blocks);
}

/** The files of a directory, recursively, as [path relative to it, bytes]. */
function walk(dir, base = dir) {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        return statSync(path).isDirectory() ? walk(path, base) : [[relative(base, path), readFileSync(path)]];
    });
}

/** The .rs files of a package that its lib can include: not its tests,
 * benches, examples or build script. */
const sources = (pkg) =>
    walk(dirname(pkg.manifest_path)).filter(([path]) => path.endsWith('.rs') && path !== 'build.rs' && !/^(tests|benches|examples)\//.test(path));

// ---- the crate graph, for rust-analyzer

/** /src: every crate's sources, as <package>-<version>/... */
const srcEntries = crates.flatMap((m) => {
    const pkg = pkgOf(m.package_id);
    return sources(pkg).map(([path, data]) => [`${idOf(pkg)}/${path}`, data]);
});
const graph = crates.map((m) => {
    const pkg = pkgOf(m.package_id);
    const rootPath = `${idOf(pkg)}/${relative(dirname(pkg.manifest_path), m.target.src_path)}`;
    const deps = depsOf(m.package_id).map(([dep, pkgId]) => ({ name: dep, id: idOf(pkgOf(pkgId)) }));
    const cfgs = [...m.features.map((f) => `feature="${f}"`), ...(scriptCfgs.get(m.package_id) ?? [])];
    return { id: idOf(pkg), name: crateName(m), version: pkg.version, edition: m.target.edition, root: rootPath, cfg: cfgs, deps, license: pkg.license };
});
const direct = depsOf(root).map(([dep]) => dep);
const crateJson = Buffer.from(`${JSON.stringify({ crates: graph, direct }, null, 1)}\n`);
writeFileSync(join(outDir, `${name}-src.tar`), tar([['crates.json', crateJson], ...srcEntries.sort(([a], [b]) => (a < b ? -1 : 1))]));
console.log(`${name}-src.tar: ${srcEntries.length} files; direct: ${direct.join(', ')}`);

// ---- compiling

/**
 * The lib crates a build made for its target, from Cargo's JSON messages
 * (not the empty package's own, and not build scripts' host crates), as
 * [lib<crate>.<ext>, bytes]: the graph differs between targets
 * (getrandom needs libc on Linux and wasi on WASI). Renamed without
 * Cargo's hash, since rustc finds a dependency by its crate name and
 * checks its hash itself, and the runner names a direct dependency
 * without knowing it.
 */
function collect(out, ext) {
    const files = new Map();
    for (const line of out.split('\n')) {
        if (!line.startsWith('{')) continue;
        const m = JSON.parse(line);
        if (m.reason !== 'compiler-artifact' || m.package_id === root || !m.target.kind.includes('lib')) continue;
        const file = m.filenames.find((f) => f.endsWith(`.${ext}`));
        if (!file) throw new Error(`${m.package_id}: no .${ext} among ${m.filenames.join(', ')}`);
        files.set(`lib${crateName(m)}.${ext}`, readFileSync(file));
    }
    return [...files].sort(([a], [b]) => (a < b ? -1 : 1));
}

// Panic locations as Cargo's registry paths end: quickcheck-1.0.3/src/tester.rs:165:28.
const registry = dirname(dirname(pkgOf(crates[0].package_id).manifest_path));
const remap = `--remap-path-prefix=${registry}=`;
const flags = (extra) => [remap, ...extra].join('\x1f');

for (const triple of rustcTriples) {
    // As the runner's crates: optimized, with line tables (a backtrace and
    // a debugger stepping into quickcheck have file and line), like std.
    const out = cargo(['build', '--locked', '--release', `--target=${triple}`, '--message-format=json'], {
        CARGO_ENCODED_RUSTFLAGS: flags([]),
        CARGO_PROFILE_RELEASE_DEBUG: 'line-tables-only',
    });
    const files = collect(out, 'rlib');
    writeFileSync(join(outDir, `${name}-${triple}.tar`), tar(files));
    console.log(`${name}-${triple}.tar: ${files.map(([n, d]) => `${n} ${d.length}`).join(', ')}`);
}

for (const triple of miriTriples) {
    const out = execFileSync(process.env.CARGO_MIRI, ['miri', 'build', '--locked', `--target=${triple}`, '--message-format=json'], {
        cwd: CRATES,
        env: {
            ...process.env,
            CARGO_TARGET_DIR: targetDir,
            MIRI_BUILD_TEST_DEPS: '1',
            MIRI_SYSROOT: join(process.env.MIRI_SYSROOTS, triple),
            RUSTUP_TOOLCHAIN: toolchain,
            CARGO_ENCODED_RUSTFLAGS: flags([]),
        },
        stdio: ['ignore', 'pipe', 'inherit'],
        maxBuffer: 1 << 28,
    }).toString();
    const files = collect(out, 'rlib');
    writeFileSync(join(outDir, `${name}-miri-${triple}.tar`), tar(files));
    console.log(`${name}-miri-${triple}.tar: ${files.map(([n, d]) => `${n} ${d.length}`).join(', ')}`);
}
