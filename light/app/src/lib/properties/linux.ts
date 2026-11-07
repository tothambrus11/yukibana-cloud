/**
 * A Linux target's run options (packs/CONTRACT.md, "Running a program") as
 * a property: how QEMU runs a program built for Linux, saved with the
 * project (`Project.runOptions`, unchanged on disk and in links) and sent
 * to the runner with every Run and Test. C, C++ and Rust share it, as they
 * shared the field; DESIGN.md puts it in `std/linux` when the languages
 * become packages, so that neither language's package imports the other's.
 *
 * Temporary and app-side: step 6 of light/modules/DESIGN.md.
 */
import { metaKey, type Availability, type JsonValue, type Property, type ProjectSnapshot } from '@yukibana/core';
import { DEFAULT_RUN_OPTIONS, runOptionsOf, type RunOptions } from '../cpp-targets.ts';

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
