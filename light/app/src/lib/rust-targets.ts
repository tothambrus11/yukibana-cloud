/**
 * Rust compilation targets: which one a project is on. The target is
 * `[build] target` in the project's `.cargo/config.toml`, the file Cargo
 * reads, so a downloaded project builds for the same target; the Rust
 * pack's runner reads the same file. No file or no key is the default,
 * WebAssembly (WASI).
 *
 * `RUST_TARGETS` and the parse rule are copies of the pack's
 * (packs/rust/src/targets.json and targets.js); tests/unit/rust-targets.test.mjs
 * checks that the table is equal to the JSON and that both read the same
 * cases alike.
 *
 * Imports nothing, so `node` can load this file directly.
 */

/** The file that holds a Rust project's target. */
export const CARGO_CONFIG = '.cargo/config.toml';

/** One row of the pack's targets.json. */
export interface RustTarget {
	readonly id: 'wasm32-wasi' | 'x86_64-linux' | 'aarch64-linux' | 'riscv64-linux';
	/** Its name, as the Build settings show it. */
	readonly label: string;
	/** rustc's and Cargo's name for it. */
	readonly triple: string;
	/** What runs a program built for it: the runner's WASI, or Linux under QEMU-Wasm. */
	readonly runtime: 'wasi' | 'linux';
	/** Which of the pack's two compilers builds for it. */
	readonly compiler: 'rustc' | 'rustc-cross';
	/** The target Miri interprets the program for. */
	readonly miri: string;
	/** A Linux target's architecture. */
	readonly arch?: 'x86_64' | 'aarch64' | 'riscv64';
	/** True on the default only. */
	readonly default?: true;
}

/** Every target, the default first: packs/rust/src/targets.json, field for field. */
export const RUST_TARGETS: readonly RustTarget[] = [
	{ id: 'wasm32-wasi', label: 'WebAssembly (WASI)', triple: 'wasm32-wasip1', runtime: 'wasi', compiler: 'rustc', miri: 'wasm32-wasip1', default: true },
	{ id: 'x86_64-linux', label: 'x86-64 Linux', triple: 'x86_64-unknown-linux-musl', runtime: 'linux', arch: 'x86_64', compiler: 'rustc-cross', miri: 'x86_64-unknown-linux-gnu' },
	{ id: 'aarch64-linux', label: 'AArch64 Linux', triple: 'aarch64-unknown-linux-musl', runtime: 'linux', arch: 'aarch64', compiler: 'rustc-cross', miri: 'aarch64-unknown-linux-gnu' },
	{ id: 'riscv64-linux', label: 'RISC-V 64 Linux', triple: 'riscv64gc-unknown-linux-musl', runtime: 'linux', arch: 'riscv64', compiler: 'rustc-cross', miri: 'riscv64gc-unknown-linux-gnu' },
];

/** What `.cargo/config.toml` puts a project on: a target of the table, or a triple the pack does not build for. */
export type RustTargetChoice = { kind: 'target'; target: RustTarget } | { kind: 'unsupported'; triple: string };

/**
 * The target `.cargo/config.toml` (its text, or null/undefined) names, as
 * the pack's targetOf reads it: `[build]`'s `target = "..."` (or
 * `build.target = "..."` at the top level), the last one winning; a
 * target's id or its triple, and `wasm32-wasi` for `wasm32-wasip1`.
 * Never throws.
 */
export function rustTargetOf(configText: string | null | undefined): RustTargetChoice {
	let section = '';
	let value: string | null = null;
	for (const raw of (configText ?? '').split('\n')) {
		const line = raw.replace(/#.*$/, '').trim();
		const header = /^\[([^\]]+)\]$/.exec(line);
		if (header) {
			section = header[1]!.trim();
			continue;
		}
		const kv = /^(build\.)?target\s*=\s*(.+)$/.exec(line);
		if (kv && (section === 'build' ? !kv[1] : section === '' && kv[1])) value = kv[2]!.trim();
	}
	const fallback = RUST_TARGETS[0]!;
	if (value === null) return { kind: 'target', target: fallback };
	const quoted = /^"([^"]*)"$/.exec(value) ?? /^'([^']*)'$/.exec(value);
	if (!quoted) return { kind: 'unsupported', triple: value };
	const name = quoted[1] === 'wasm32-wasi' ? 'wasm32-wasip1' : quoted[1]!;
	const target = RUST_TARGETS.find((t) => t.triple === name || t.id === name);
	return target ? { kind: 'target', target } : { kind: 'unsupported', triple: name };
}

/**
 * `.cargo/config.toml` with the project on target `id`: the `[build]`
 * table's `target` line replaced, or added (with the table when there is
 * none); for the default, the line removed, and the file left out (`''`)
 * when nothing else is in it. Every other line is kept.
 */
export function withRustTarget(configText: string | null | undefined, id: RustTarget['id']): string {
	const target = RUST_TARGETS.find((t) => t.id === id) ?? RUST_TARGETS[0]!;
	const text = configText ?? '';
	const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');
	let section = '';
	let build = -1;
	const kept: string[] = [];
	for (const raw of lines) {
		const line = raw.replace(/#.*$/, '').trim();
		const header = /^\[([^\]]+)\]$/.exec(line);
		if (header) section = header[1]!.trim();
		if (/^(build\.)?target\s*=/.test(line) && (section === 'build' ? !line.startsWith('build.') : section === '' && line.startsWith('build.'))) continue;
		kept.push(raw);
		if (header && section === 'build') build = kept.length - 1;
	}
	if (!target.default) {
		const entry = `target = "${target.triple}"`;
		if (build >= 0) kept.splice(build + 1, 0, entry);
		else kept.push(...(kept.length ? [''] : []), '[build]', entry);
	}
	const left = kept.filter((l) => l.trim() !== '' && l.trim() !== '[build]');
	return left.length === 0 ? '' : `${kept.join('\n')}\n`;
}
