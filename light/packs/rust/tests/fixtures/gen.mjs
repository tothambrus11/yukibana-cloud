// Writes the fixtures test-mir.mjs reads: the MIR, LLVM IR and assembly of
// sample.json's crates, unfiltered, as explorer.js asks rustc for them,
// from Rust 1.98.1's own rustc, which is rustc.wasm's release and prints
// what it prints (toolchains/compilers/toolchain.sh, "description").
//
//   node tests/fixtures/gen.mjs     (rustup with 1.98.1 and its wasm32-wasip1,
//                                    x86_64- and aarch64-unknown-linux-musl targets)
//
// The project is copied to a directory of its own and compiled there with
// --remap-path-prefix=<it>/=, as the workers compile /project.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const files = JSON.parse(readFileSync(join(HERE, 'sample.json'), 'utf8'));
const project = mkdtempSync(join(tmpdir(), 'rust-fixtures-'));
for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), text);
}
const rustc = (args) => execFileSync('rustc', ['+1.98.1', ...args], { cwd: project, env: { ...process.env, RUSTC_BOOTSTRAP: '1' }, maxBuffer: 1 << 28 }).toString();
// With rust-src installed, rustc names the standard library's files where
// rustup put them; without it, as in the browser, by the path Rust's build
// remapped them to, /rustc/<commit>/library/...: the fixtures say what the
// browser sees.
const sysroot = rustc(['--print', 'sysroot']).trim();
const commit = /commit-hash: (\w+)/.exec(rustc(['-vV']))[1];
const asBrowser = (text) => text.replaceAll(`${sysroot}/lib/rustlib/src/rust/`, `/rustc/${commit}/`);
const common = (target) => ['--target', target, '--edition', '2021', `--remap-path-prefix=${project}/=`];
const out = join(project, 'out');
mkdirSync(out);
const library = (target) => {
    rustc(['--crate-type=lib', '--crate-name=shapes', '--emit=metadata', '-Zalways-encode-mir', '-o', join(out, `libshapes-${target}.rmeta`), join(project, 'src/lib.rs'), ...common(target)]);
    return ['--extern', `shapes=${join(out, `libshapes-${target}.rmeta`)}`];
};

const MIR_TARGET = 'x86_64-unknown-linux-musl';
const mirLib = library(MIR_TARGET);
for (const [root, crate] of [['src/main.rs', mirLib], ['src/lib.rs', ['--crate-type=lib']]])
    for (const [suffix, opt] of [['', '0'], ['-O', '3']]) {
        const name = `${root.split('/').pop()}${suffix}.mir`;
        writeFileSync(join(HERE, name), asBrowser(rustc(['--crate-name=shapes', join(project, root), ...crate, `-Copt-level=${opt}`, '-Zunpretty=mir', '-Zmir-include-spans', ...common(MIR_TARGET)])));
        console.log(name);
    }

// LLVM IR and assembly of src/main.rs, as the views make them: line
// tables only, one codegen unit.
for (const [target, emit, opt] of [
    ['wasm32-wasip1', 'llvm-ir', '0'],
    ['x86_64-unknown-linux-musl', 'asm', '0'],
    ['aarch64-unknown-linux-musl', 'asm', '3'],
]) {
    const name = `main.rs${opt === '0' ? '' : '-O'}.${target}.${emit === 'asm' ? 's' : 'll'}`;
    const file = join(out, name);
    rustc(['--crate-name=shapes', join(project, 'src/main.rs'), ...library(target), `-Copt-level=${opt}`, `--emit=${emit}`, '-o', file, '-Cdebuginfo=line-tables-only', '-Ccodegen-units=1', ...(emit === 'asm' ? ['-Zverbose-asm'] : []), ...common(target)]);
    writeFileSync(join(HERE, name), asBrowser(readFileSync(file, 'utf8')));
    console.log(name);
}
rmSync(project, { recursive: true });
