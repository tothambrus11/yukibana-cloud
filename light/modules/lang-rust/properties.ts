/**
 * Rust's build settings as @yukibana/core properties: the target, a lens
 * onto `[build] target` of .cargo/config.toml (targets.ts); the
 * optimisation level and Miri, saved with the project; and a Linux
 * target's run options, shared with C and C++ (std's linux.ts).
 *
 * Rust's body carries the model (body.ts); a host that reads or writes one
 * setting by its role imports the property from here.
 */
import { AVAILABLE, metaKey, pathOf, readProperty, someProperty, type Availability, type Property, type PropertyModel, type ProjectSnapshot } from '../core/index.ts';
import { always, describeRunOptions, levelProperty, runOptionsProperty, TARGET_SHORT, valueOf, type OptimizationLevel } from '../std/index.ts';
import { CARGO_CONFIG, isMiriTarget, MIRI_TARGETS, RUST_TARGETS, rustTargetOf, withRustTarget, type MiriTarget, type RustTarget } from './targets.ts';

/**
 * rustc's levels, as Cargo's `opt-level` spells them. `0` is the default:
 * Cargo's dev profile (`cargo build`, `cargo run`), compiled with full
 * debug info (`-Cdebuginfo=2`) for the debugger; the others are compiled
 * without, as the release profile is (packs/rust README, "Optimization").
 */
export const RUST_LEVELS: readonly OptimizationLevel[] = [
	{ flag: '0', label: 'opt-level 0 (debug)', default: true },
	{ flag: '1', label: 'opt-level 1' },
	{ flag: '2', label: 'opt-level 2' },
	{ flag: '3', label: 'opt-level 3 (release)' },
	{ flag: 's', label: 'opt-level s (size)' },
	{ flag: 'z', label: 'opt-level z (smallest)' },
];

/**
 * The target, `[build] target` of .cargo/config.toml: a target's id. The
 * parse (`rustTargetOf`) does not tell a file without the key from one that
 * names the default, so both read as the default's id, a value; a triple
 * the pack does not build for reads `unrecognised`.
 */
export const RUST_TARGET: Property<RustTarget['id']> = {
	id: '@yukibana/lang-rust#target',
	label: 'Target',
	storage: {
		kind: 'file',
		path: pathOf(CARGO_CONFIG),
		read: (text) => {
			const choice = rustTargetOf(text);
			return choice.kind === 'unsupported' ? { kind: 'unrecognised', raw: choice.triple } : { kind: 'value', value: choice.target.id };
		},
		write: withRustTarget,
	},
	choices: () => RUST_TARGETS.map((t) => t.id),
	relevant: always,
	default: RUST_TARGETS[0]!.id,
};

/** Miri as the property holds it: the Miri target a Run interprets the program for, or `'off'` to compile it. */
export type MiriSetting = MiriTarget['id'] | 'off';

/** Miri, saved with the project (`Project.miri`) when on, and off unless turned on. */
export const MIRI: Property<MiriSetting> = {
	id: '@yukibana/lang-rust#miri',
	label: 'Miri',
	storage: { kind: 'meta', binding: { key: metaKey('miri'), parse: (value) => (isMiriTarget(value) ? value : null), write: (setting) => (setting === 'off' ? null : setting) } },
	choices: () => ['off', ...MIRI_TARGETS.map((t) => t.id)],
	relevant: always,
	default: 'off',
};

/** Rust's optimisation level, Cargo's `opt-level`. */
export const RUST_LEVEL: Property<string> = levelProperty('@yukibana/lang-rust#optimization', RUST_LEVELS);

/** Returns whether `snapshot` compiles for a Linux target and runs the program, where Run options apply (Miri interprets it instead). */
function compiledForLinux(snapshot: ProjectSnapshot): Availability {
	const target = readProperty(snapshot, RUST_TARGET);
	const linux = target.kind === 'value' && RUST_TARGETS.find((t) => t.id === target.value)?.runtime === 'linux';
	if (!linux) return { kind: 'unavailable', reason: 'Run options apply to a program built for a Linux target.' };
	return valueOf(snapshot, MIRI) === 'off' ? AVAILABLE : { kind: 'unavailable', reason: 'Miri interprets the program instead of running it under Linux.' };
}

/** A Rust project's run options: compiled for a Linux target only. */
export const RUST_RUN_OPTIONS = runOptionsProperty(compiledForLinux);

/**
 * Returns the build of `snapshot` in a few words: the target's short name
 * (the same ids and names as C++'s), the level, Miri's target when it is
 * on, and the run options that apply and are not the defaults.
 */
function summary(snapshot: ProjectSnapshot): string {
	const target = readProperty(snapshot, RUST_TARGET);
	const miri = valueOf(snapshot, MIRI);
	return [
		target.kind === 'unrecognised' ? target.raw : TARGET_SHORT[target.kind === 'value' ? target.value : RUST_TARGET.default],
		valueOf(snapshot, RUST_LEVEL),
		...(miri === 'off' ? [] : [`Miri on ${MIRI_TARGETS.find((t) => t.id === miri)?.label ?? miri}`]),
		...(RUST_RUN_OPTIONS.relevant(snapshot).kind === 'available' ? describeRunOptions(valueOf(snapshot, RUST_RUN_OPTIONS)) : []),
	].join(' · ');
}

/** Rust's property model. */
export const RUST_MODEL: PropertyModel = {
	properties: [someProperty(RUST_TARGET), someProperty(RUST_LEVEL), someProperty(MIRI), someProperty(RUST_RUN_OPTIONS)],
	summary,
};
