/**
 * A project as the core sees it: a set of documents with versions, plus the
 * metadata a project saves beside them (run options, an optimization level),
 * behind a port the host implements over its own editor models.
 *
 * Light's workspace implements it over its Monaco models; a documentation
 * snippet is a one-file project with hidden files. Nothing here reads a disk
 * or a model: the host answers.
 */

import { pathOf, type Disposable, type JsonValue, type MetaKey, type Path } from './brand.ts';

/**
 * The files of a project, each path mapped to its text.
 *
 * Keyed by `string`, not `Path`: a record cannot check its keys when it is
 * made, so a `Path` key would guard nothing and only make every reader cast
 * to look a file up. The one-file APIs (`file`, `ProjectChange`) take a
 * `Path`.
 *
 * Invariant: every key is a path `pathOf` accepts (whoever makes the record
 * checks it); the record is not changed after it is handed out.
 */
export type Files = Readonly<Record<string, string>>;

/**
 * How a project field of type `V` is read from a saved project: its key and
 * the one boundary where an untyped value becomes a `V`.
 */
export interface MetaBinding<V> {
	/** The field's name in the saved project. */
	readonly key: MetaKey;
	/**
	 * Returns the stored value as a `V`, or null when it is not one (a link
	 * from an older Light, a hand-edited file), which then reads as unset.
	 */
	readonly parse: (stored: unknown) => V | null;
	/**
	 * Returns `value` as it is stored; `parse` of the result is `value` again,
	 * except that null means the field is unset (a host leaves it out of the
	 * saved project), which a property reads as its default: a binding
	 * writes null for the value a project that never chose has, so that
	 * choosing it again saves what was saved before. A function property,
	 * not a method, so that a binding of one type is never taken for a
	 * binding of another.
	 */
	readonly write: (value: V) => JsonValue;
}

/**
 * A project at one revision. Reading it is lazy: `file` reads through to the
 * host's model, so a snapshot costs nothing until it is read.
 *
 * Invariant: a snapshot answers as the project was at `revision`; a host
 * whose project has changed since makes a new one.
 */
export interface ProjectSnapshot {
	/** A number that changes on every change to a file or the metadata. */
	readonly revision: number;
	/** Returns the path of every file, folders excepted, in the host's order. */
	paths(): readonly Path[];
	/** Returns the text of the file at `path`, or null when there is none. */
	file(path: Path): string | null;
	/**
	 * Returns every file with its text. It is O(project): a provider calls it
	 * once when it dispatches, never per keystroke.
	 */
	files(): Files;
	/** Returns the field `binding` names, or null when it is unset, which is not the same as its default. */
	meta<V>(binding: MetaBinding<V>): V | null;
}

/** What changed in a project, as one event of `Project.onChange`. */
export type ProjectChange =
	| {
			/** A file's text changed. */
			readonly kind: 'edited';
			/** The file. */
			readonly path: Path;
			/** The file's version after the change; a host batches a model's versions into one event each. */
			readonly version: number;
	  }
	| {
			/** A file was created or deleted. */
			readonly kind: 'created' | 'deleted';
			/** The file. */
			readonly path: Path;
	  }
	| {
			/** A file was renamed. */
			readonly kind: 'renamed';
			/** The path it had. */
			readonly from: Path;
			/** The path it has. */
			readonly to: Path;
	  }
	| {
			/** A field of the metadata changed. */
			readonly kind: 'meta';
			/** The field. */
			readonly key: MetaKey;
	  };

/** A project a host keeps: its snapshot now, and word of every change. */
export interface Project {
	/** Returns the project as it is now. */
	snapshot(): ProjectSnapshot;
	/** Calls `listener` after each change, until the result is disposed. */
	onChange(listener: (change: ProjectChange) => void): Disposable;
}

/**
 * Returns a snapshot at `revision` of a project that is `files` and no
 * saved settings: what a host whose project is a few files and no
 * metadata (a docs snippet and its hidden files, a textarea) performs on.
 * The files are copied, so the snapshot never goes stale and is the same
 * whatever the caller does with `files` afterwards; every `meta` read is
 * null (unset).
 *
 * - Requires: every key of `files` is a project path (`pathOf`); one that
 *   is not throws its `RangeError` here, not at a later read.
 */
export function snapshotOf(files: Files, revision = 0): ProjectSnapshot {
	const copy: Files = { ...files };
	const paths = Object.keys(copy).map(pathOf);
	return {
		revision,
		paths: () => paths,
		file: (path) => (Object.hasOwn(copy, path) ? (copy[path] ?? null) : null),
		files: () => copy,
		meta: () => null,
	};
}
