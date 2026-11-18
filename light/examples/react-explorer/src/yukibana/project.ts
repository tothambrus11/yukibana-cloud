/**
 * A widget's project: a few files and the settings saved beside them,
 * held in memory, as the core's `Project`. The article's widgets are
 * snippets, not workspaces: what is edited lives as long as the page.
 *
 * It is framework-free on purpose; the React side (`useProject`,
 * `useSnapshot`) only subscribes to it.
 */
import { pathOf, type Disposable, type Files, type JsonValue, type MetaBinding, type MetaKey, type Path, type Project, type ProjectChange, type ProjectEdit, type ProjectSnapshot } from '@yukibana/core';

/** Settings saved with a project, by key, as stored (each property's `MetaBinding` parses its own). */
export type MetaValues = Readonly<Record<string, JsonValue>>;

/**
 * A project of files and saved settings, edited in place.
 *
 * Invariants: `snapshot()` returns the same object until the next change,
 * and its `revision` grows by one at every change; a snapshot never
 * changes once made (it holds copies), so an availability or a run read
 * from it sees the project as it was when it was taken.
 */
export class MemoryProject implements Project {
	#files: Record<string, string>;
	#meta: Record<string, JsonValue>;
	#revision = 0;
	#current: ProjectSnapshot | null = null;
	readonly #listeners = new Set<(change: ProjectChange) => void>();

	/** Makes a project of `files` and the saved settings `meta` (none by default). */
	constructor(files: Files, meta: MetaValues = {}) {
		this.#files = { ...files };
		this.#meta = { ...meta };
	}

	/** The project as it is now: the same object until the next change. */
	snapshot(): ProjectSnapshot {
		if (this.#current !== null) return this.#current;
		const files: Files = { ...this.#files };
		const meta: Readonly<Record<string, JsonValue>> = { ...this.#meta };
		const paths = Object.keys(files).map(pathOf);
		const made: ProjectSnapshot = {
			revision: this.#revision,
			paths: () => paths,
			file: (path) => (Object.hasOwn(files, path) ? (files[path] ?? null) : null),
			files: () => files,
			meta: <V>(binding: MetaBinding<V>): V | null => (Object.hasOwn(meta, binding.key) ? binding.parse(meta[binding.key]) : null),
		};
		this.#current = made;
		return made;
	}

	/** Calls `listener` after every change, until disposed. */
	onChange(listener: (change: ProjectChange) => void): Disposable {
		this.#listeners.add(listener);
		return { dispose: () => void this.#listeners.delete(listener) };
	}

	/** The text of `path` now, or null when the project has no such file. */
	file(path: Path): string | null {
		return this.#files[path] ?? null;
	}

	/**
	 * Sets file `path` to `text`, creating it if absent; does nothing when
	 * the text is already that. `version` is the editor's own version of
	 * the document when an editor made the edit, else the new revision.
	 */
	setFile(path: Path, text: string, version?: number): void {
		if (this.#files[path] === text) return;
		const created = !Object.hasOwn(this.#files, path);
		this.#files[path] = text;
		this.#changed(created ? { kind: 'created', path } : { kind: 'edited', path, version: version ?? this.#revision + 1 });
	}

	/**
	 * Applies `edit`, what the core's `writeProperty` returned: a file's new
	 * text, or a saved setting's new value (null removes it, which is how a
	 * property says "the default").
	 */
	apply(edit: ProjectEdit): void {
		if (edit.kind === 'file') {
			this.setFile(edit.path, edit.text);
			return;
		}
		this.#setMeta(edit.key, edit.value);
	}

	#setMeta(key: MetaKey, value: JsonValue): void {
		if (value === null) {
			if (!Object.hasOwn(this.#meta, key)) return;
			delete this.#meta[key];
		} else {
			if (JSON.stringify(this.#meta[key]) === JSON.stringify(value)) return;
			this.#meta[key] = value;
		}
		this.#changed({ kind: 'meta', key });
	}

	#changed(change: ProjectChange): void {
		this.#revision += 1;
		this.#current = null;
		for (const listener of [...this.#listeners]) listener(change);
	}
}
