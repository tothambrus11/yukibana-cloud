/**
 * Properties: a project's settings (a C++ target, a standard, run options)
 * as typed lenses onto where they are stored, a line of a file or a field of
 * the saved project. How a property is shown is never here.
 *
 * A file is the single source of truth for what it holds: a `file` lens
 * reads its value from the text and writes it back keeping every other byte,
 * and a text it cannot read is `unrecognised`, shown as it is rather than
 * replaced by a default.
 */

import type { JsonValue, MetaKey, Path } from './brand.ts';
import type { MetaBinding, ProjectSnapshot } from './project.ts';
import type { Availability } from './provider.ts';

/** What a property holds in a project. */
export type Read<V> =
	| {
			/** A value it recognises. */
			readonly kind: 'value';
			/** The value. */
			readonly value: V;
	  }
	| {
			/** Nothing: the file or field is absent, or says nothing of it, so the default applies. */
			readonly kind: 'default';
	  }
	| {
			/** Something it does not recognise, which a write replaces and nothing else does. */
			readonly kind: 'unrecognised';
			/** What is there, as the person wrote it. */
			readonly raw: string;
	  };

/** Where a property of type `V` is stored. */
export type Storage<V> =
	| {
			/** In a file of the project (`compile_flags.txt`, `.clang-tidy`). */
			readonly kind: 'file';
			/** The file. */
			readonly path: Path;
			/** Returns what `text` (null when the file is absent) holds. */
			readonly read: (text: string | null) => Read<V>;
			/**
			 * Returns `text` (null when the file is absent) with `value` in it,
			 * every other byte as it was. A function property, not a method, so
			 * that a `Property<V>` is never a `Property<W>` of another type: a
			 * method's parameter would be compared both ways and let one through.
			 */
			readonly write: (text: string | null, value: V) => string;
	  }
	| {
			/** In a field of the saved project (`runOptions`). */
			readonly kind: 'meta';
			/** The field, and how it is parsed and written. */
			readonly binding: MetaBinding<V>;
	  };

/**
 * One setting of a project, of type `V`.
 *
 * Invariant: `default` is among `choices` of any snapshot where those are not null.
 */
export interface Property<V> {
	/** Its name, `<package>#<name>` (`'@yukibana/lang-cpp#target'`). */
	readonly id: `${string}#${string}`;
	/** Its name as a person reads it (`'Target'`). */
	readonly label: string;
	/** Where it is stored. */
	readonly storage: Storage<V>;
	/** Returns the values it may take in `snapshot`, or null when it takes any value of its type. */
	readonly choices: (snapshot: ProjectSnapshot) => readonly V[] | null;
	/** Returns whether it means anything in `snapshot` (CPUs only for a Linux target's system emulation). */
	readonly relevant: (snapshot: ProjectSnapshot) => Availability;
	/** What it is when nothing is stored. */
	readonly default: V;
}

/**
 * A `Property` of a value type only it knows: what a list of properties of
 * different types holds. Opening it hands the property to a function generic
 * in its type, so the only values that can be written to it are its own
 * (its `default`, its `choices`, what `readProperty` read of it).
 */
export interface SomeProperty {
	/** Its name, as the property's `id`. */
	readonly id: `${string}#${string}`;
	/** Returns what `use` returns for the property. */
	readonly open: <T>(use: <V>(property: Property<V>) => T) => T;
}

/** Returns `property` as a `SomeProperty`, for a `PropertyModel`'s list. */
export function someProperty<V>(property: Property<V>): SomeProperty {
	return { id: property.id, open: (use) => use(property) };
}

/**
 * A language's settings, in the order a host shows them, and the summary of
 * them a host puts on the button that opens them.
 */
export interface PropertyModel {
	/** The settings, each of its own value type. */
	readonly properties: readonly SomeProperty[];
	/** Returns the settings of `snapshot` in a few words (`'x86-64 Linux · C++20 · -O2'`). */
	summary(snapshot: ProjectSnapshot): string;
}

/** A change to a project that a host applies (in Light, as one step of Undo). */
export type ProjectEdit =
	| {
			/** Replace a file's text, creating the file if it is absent. */
			readonly kind: 'file';
			/** The file. */
			readonly path: Path;
			/** Its new text. */
			readonly text: string;
	  }
	| {
			/** Set a field of the saved project. */
			readonly kind: 'meta';
			/** The field. */
			readonly key: MetaKey;
			/** Its new value, as stored. */
			readonly value: JsonValue;
	  };

/** Returns what `property` holds in `snapshot`. */
export function readProperty<V>(snapshot: ProjectSnapshot, property: Property<V>): Read<V> {
	const storage = property.storage;
	if (storage.kind === 'file') return storage.read(snapshot.file(storage.path));
	const value = snapshot.meta(storage.binding);
	return value === null ? { kind: 'default' } : { kind: 'value', value };
}

/**
 * Returns the edit that makes `property` hold `value` in `snapshot`, for the
 * host to apply; nothing is changed until it does.
 *
 * - Requires: `value` is among `property.choices(snapshot)`, when that is not null.
 */
export function writeProperty<V>(snapshot: ProjectSnapshot, property: Property<V>, value: V): ProjectEdit {
	const choices = property.choices(snapshot);
	if (choices !== null && !choices.includes(value)) throw new RangeError(`${property.id} cannot be ${JSON.stringify(value)} in this project.`);
	const storage = property.storage;
	if (storage.kind === 'file') return { kind: 'file', path: storage.path, text: storage.write(snapshot.file(storage.path), value) };
	return { kind: 'meta', key: storage.binding.key, value: storage.binding.write(value) };
}
