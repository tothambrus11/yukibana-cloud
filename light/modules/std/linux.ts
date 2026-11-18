/**
 * What the languages that build for a Linux target share: how QEMU runs a
 * program built for one (packs/CONTRACT.md, "Running a program"), as a
 * property saved with the project (`Project.runOptions`, unchanged on disk
 * and in links) and sent to the runner with every Run and Test, and the
 * targets' short names. C, C++ and Rust share them, as they shared the
 * field; they live here so that neither language's package imports the
 * other's (DESIGN.md, section 4: `std/linux`).
 */
import { metaKey, type Availability, type JsonValue, type Property, type ProjectSnapshot } from '../core/index.ts';

/**
 * Identifies a target the Linux pack's languages build for, as the packs'
 * targets.json files do: WebAssembly (WASI), the default, or a Linux
 * architecture run under QEMU.
 */
export type TargetId = 'wasm32-wasi' | 'x86_64-linux' | 'aarch64-linux' | 'riscv64-linux';

/**
 * Each target's short name, for places with room for a word: a build
 * summary (`x86-64 · -O2`) and a compiler output view's header. The same
 * for every language that builds for the target.
 */
export const TARGET_SHORT: Readonly<Record<TargetId, string>> = {
	'wasm32-wasi': 'WASI',
	'x86_64-linux': 'x86-64',
	'aarch64-linux': 'AArch64',
	'riscv64-linux': 'RISC-V',
};

/** The emulation choices of a Linux target's Run (packs/CONTRACT.md, "Running a program"). */
export interface RunOptions {
	/** `system`: the program runs in Linux under QEMU (the default); `user`: QEMU's user mode, experimental. */
	emulation: 'system' | 'user';
	/** The guest's CPUs, system mode only. */
	cpus: 1 | 2 | 4;
	/** `true` iff the system calls are traced (strace), shown dimmed in the terminal. */
	strace: boolean;
}

/** What a project that never chose runs with. */
export const DEFAULT_RUN_OPTIONS: Readonly<RunOptions> = { emulation: 'system', cpus: 1, strace: false };

/**
 * Returns `value` as run options: each field that is valid is kept, any
 * other is the default's; anything that is not an object is the defaults.
 * Never throws, so a saved project with a bad value still loads.
 */
export function runOptionsOf(value: unknown): RunOptions {
	const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
	const emulation = v['emulation'];
	const cpus = v['cpus'];
	const strace = v['strace'];
	return {
		emulation: emulation === 'system' || emulation === 'user' ? emulation : DEFAULT_RUN_OPTIONS.emulation,
		cpus: cpus === 1 || cpus === 2 || cpus === 4 ? cpus : DEFAULT_RUN_OPTIONS.cpus,
		strace: typeof strace === 'boolean' ? strace : DEFAULT_RUN_OPTIONS.strace,
	};
}

/** Returns `options` as the saved project holds them: every field, so that a project that chose keeps what it chose. */
function stored(options: Readonly<RunOptions>): JsonValue {
	return { emulation: options.emulation, cpus: options.cpus, strace: options.strace };
}

/**
 * Returns the run options property of a language, which applies where
 * `relevant` says (a C or C++ project on a Linux target; a Rust one too,
 * unless Miri interprets it instead).
 *
 * Its value is saved whole once chosen, even when it equals the default,
 * as the field always was: a project that never chose reads as unset and
 * runs with `DEFAULT_RUN_OPTIONS`. A stored value is read field by field
 * (`runOptionsOf`): a field that is not valid is the default's.
 */
export function runOptionsProperty(relevant: (snapshot: ProjectSnapshot) => Availability): Property<Readonly<RunOptions>> {
	return {
		id: '@yukibana/std#linux-run-options',
		label: 'Run options',
		storage: {
			kind: 'meta',
			binding: { key: metaKey('runOptions'), parse: (value) => (typeof value === 'object' && value !== null ? runOptionsOf(value) : null), write: stored },
		},
		choices: () => null,
		relevant,
		default: DEFAULT_RUN_OPTIONS,
	};
}

/** Returns the run options in a few words for a build summary: what is not the default (`2 CPUs`, `user mode`, `strace`), nothing when all are. */
export function describeRunOptions(options: Readonly<RunOptions>): string[] {
	const parts: string[] = [];
	if (options.emulation === 'user') parts.push('user mode');
	else if (options.cpus > 1) parts.push(`${options.cpus} CPUs`);
	if (options.strace) parts.push('strace');
	return parts;
}
