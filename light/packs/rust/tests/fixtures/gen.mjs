// Writes the fixtures test-mir.mjs reads: the MIR of sample.json's crates,
// unfiltered, as explorer.js asks the shipped Miri (as rustc) for it, with
// and without -O.
//
//   node tests/fixtures/gen.mjs [dir with miri.wasm and sysroot.tar]
//
// (default: ../../app/static/packs/rust, what build.sh wrote).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Directory, Fd, File, OpenFile, PreopenDirectory, WASI, WASIProcExit } from '@bjorn3/browser_wasi_shim';
import { untar } from '../../src/cargo.js';
import { tree } from '../../src/tree.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = resolve(process.argv[2] ?? join(HERE, '../../../../app/static/packs/rust'));
const files = JSON.parse(readFileSync(join(HERE, 'sample.json'), 'utf8'));
const module = await WebAssembly.compile(readFileSync(join(dir, 'miri.wasm')));
const sysroot = tree(untar(new Uint8Array(readFileSync(join(dir, 'sysroot.tar')))));
const project = tree(Object.entries(files).map(([p, t]) => [p, new TextEncoder().encode(t)]));
const out = new Directory([]);

class Collect extends Fd {
    text = '';
    fd_write(data) {
        this.text += new TextDecoder().decode(data);
        return { ret: 0, nwritten: data.byteLength };
    }
}
function rustc(args) {
    const stdout = new Collect();
    const stderr = new Collect();
    const fds = [new OpenFile(new File([])), stdout, stderr, ...['/sysroot', '/project', '/out', '/tmp'].map((p) => new PreopenDirectory(p, []))];
    fds[3].dir = sysroot;
    fds[4].dir = project;
    fds[5].dir = out;
    const wasi = new WASI(['miri', ...args], ['MIRI_BE_RUSTC=target'], fds);
    const imports = { wasi_snapshot_preview1: wasi.wasiImport };
    for (const { module: from, name, kind } of WebAssembly.Module.imports(module))
        if (from !== 'wasi_snapshot_preview1' && kind === 'function') (imports[from] ??= {})[name] ??= () => { throw new Error(name); };
    let code;
    try {
        code = wasi.start(new WebAssembly.Instance(module, imports));
    } catch (e) {
        if (!(e instanceof WASIProcExit)) throw e;
        code = e.code;
    }
    if (code !== 0) throw new Error(`rustc ${args.join(' ')}: ${stderr.text}`);
    return stdout.text;
}
const common = ['--sysroot', '/sysroot', '--target', 'x86_64-unknown-linux-gnu', '--edition', '2021', '--remap-path-prefix=/project/='];
rustc(['--crate-type=lib', '--crate-name=shapes', '--emit=metadata', '-o', '/out/libshapes.rmeta', '/project/src/lib.rs', ...common]);
for (const [root, crate] of [['src/main.rs', ['--extern', 'shapes=/out/libshapes.rmeta', '-L', '/out']], ['src/lib.rs', ['--crate-type=lib']]])
    for (const [suffix, opt] of [['', []], ['-O', ['-Copt-level=3']]]) {
        const name = `${root.split('/').pop()}${suffix}.mir`;
        writeFileSync(join(HERE, name), rustc(['--crate-name=shapes', `/project/${root}`, ...crate, ...opt, '-Zunpretty=mir', '-Zmir-include-spans', ...common]));
        console.log(name);
    }
