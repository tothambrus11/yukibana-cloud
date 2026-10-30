// Which target a Rust project is built for: `[build] target` in its
// .cargo/config.toml, the file Cargo itself reads, so a downloaded project
// builds for the same target with `cargo build`. No file, or no such key,
// is the default, WebAssembly (WASI). Pure, no imports but the table, so
// node runs its tests.
//
// targets.json: each target's triple (what rustc and Cargo call it), what
// runs a program built for it (the runner's own WASI, or Linux under the
// C/C++ pack's QEMU), which of the pack's two compilers builds for it, and
// the Miri target a project on it starts with when Miri is turned on.
//
// miri-targets.json: the targets Miri interprets a program for, chosen in
// the Build settings apart from the build's (`options.miri`), so that one
// program can be seen on several: the size, alignment and layout of every
// type, pointer width and endianness are the target's. All are glibc
// Linux triples, since Miri's shims are glibc's (its musl support is
// partial, and it cannot run WASI's: std on wasm32-wasip1 prints through
// a foreign function Miri does not have); the layout is the same as musl's
// of the same architecture. WebAssembly's starts on ARMv7, whose pointers
// are 32-bit and whose u64 and f64 are 8-aligned, as wasm32's are (i686's
// are 4-aligned; wasm32's u128 is 16-aligned and ARMv7's 8).

import TARGETS from './targets.json' with { type: 'json' };
import MIRI_TARGETS from './miri-targets.json' with { type: 'json' };

export { TARGETS, MIRI_TARGETS };

/** The Miri target with this id, or undefined. */
export const miriTarget = (id) => MIRI_TARGETS.find((t) => t.id === id);

/** The default target's row. */
export const DEFAULT_TARGET = TARGETS.find((t) => t.default);

/**
 * The target `.cargo/config.toml` (its text, or undefined) names:
 * `{ target }` with its row, `{ unsupported: triple }` for a triple the
 * pack does not build for, or the default. A line-based reading of the
 * `[build]` table's `target = "..."` (or `build.target = "..."` at the top
 * level), the last one winning; a list of targets is not supported
 * (`unsupported` with the list's text). Accepts a target's id or its
 * triple, and `wasm32-wasi`'s triples `wasm32-wasip1` and `wasm32-wasi`.
 */
export function targetOf(configText) {
    let section = '';
    let value = null;
    for (const raw of (configText ?? '').split('\n')) {
        const line = raw.replace(/#.*$/, '').trim();
        const header = /^\[([^\]]+)\]$/.exec(line);
        if (header) {
            section = header[1].trim();
            continue;
        }
        const kv = /^(build\.)?target\s*=\s*(.+)$/.exec(line);
        if (kv && (section === 'build' ? !kv[1] : section === '' && kv[1])) value = kv[2].trim();
    }
    if (value === null) return { target: DEFAULT_TARGET };
    const quoted = /^"([^"]*)"$/.exec(value) ?? /^'([^']*)'$/.exec(value);
    if (!quoted) return { unsupported: value };
    const name = quoted[1] === 'wasm32-wasi' ? 'wasm32-wasip1' : quoted[1];
    const target = TARGETS.find((t) => t.triple === name || t.id === name);
    return target ? { target } : { unsupported: name };
}
