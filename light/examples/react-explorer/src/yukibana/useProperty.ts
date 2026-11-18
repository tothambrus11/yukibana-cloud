/**
 * `useProperty`: one of a language's build settings (a core `Property`),
 * read from a widget's project and written back through it, so the
 * runner, the compiler output views and the debugger all see the same
 * setting: C++'s optimisation level and sanitizers are lines of
 * compile_flags.txt, Rust's and Swift's level a setting saved with the
 * project and sent as `options.optimization`.
 */
import { readProperty, writeProperty, type ProjectSnapshot, type Property, type Read } from '@yukibana/core';
import { valueOf } from '@yukibana/std';
import type { MemoryProject } from './project.ts';
import { useSnapshot } from './useProject.ts';

/** A setting as a control shows it. */
export interface PropertyState<V> {
	/** The value a build uses: what the project says, or the property's default. */
	readonly value: V;
	/** What the project says, as the core read it: a value, the default, or text it does not recognise. */
	readonly read: Read<V>;
	/** The values a picker offers, or null for a free value. */
	readonly choices: readonly V[] | null;
	/** Writes `value` into the project (the core's `writeProperty`, applied in place). */
	readonly set: (value: V) => void;
}

/** Returns `property` of `project` now, re-rendering at every change of the project. */
export function useProperty<V>(project: MemoryProject, property: Property<V>): PropertyState<V> {
	const snapshot = useSnapshot(project);
	return {
		value: valueOf(snapshot, property),
		read: readProperty(snapshot, property),
		choices: property.choices(snapshot),
		set: (value) => project.apply(writeProperty(project.snapshot(), property, value)),
	};
}

/**
 * Returns the runner options `levels` say for `snapshot`: for each
 * property saved with the project (`meta` storage: Rust's and Swift's
 * level), `{ optimization: value }`, which the runner and the explorer
 * read; nothing for one held in a project file (C++'s `-O` line, which
 * they read from compile_flags.txt themselves). Null when there is
 * nothing to send, so a run's message carries no `options`.
 */
export function levelOptions(snapshot: ProjectSnapshot, level: Property<string> | null): { readonly optimization: string } | null {
	if (level === null || level.storage.kind !== 'meta') return null;
	return { optimization: valueOf(snapshot, level) };
}
