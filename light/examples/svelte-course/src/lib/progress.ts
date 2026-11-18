/**
 * What a student's progress through a lesson is, as the browser keeps it:
 * per exercise, whether its last Check passed, how many of its checks
 * passed, and the draft of its file. Read back through `parseProgress`,
 * which keeps what it understands and drops the rest, since the stored
 * text is whatever a browser kept, possibly from an older page.
 *
 * Pure but for `loadProgress` and `saveProgress`, which take the storage
 * as an argument and never throw (a private window's storage may).
 */

/** One exercise's progress. */
export interface ExerciseProgress {
	/** Whether the latest Check passed every check with exit code 0 (`verdictOf`). Once true it stays true until the lesson is reset. */
	readonly passed: boolean;
	/** How many checks the latest Check passed. */
	readonly score: number;
	/** How many checks it had. */
	readonly total: number;
	/** The student's file as last edited, or null when it is still the starter. */
	readonly draft: string | null;
}

/** Every exercise's progress, by exercise id. */
export type Progress = Readonly<Record<string, ExerciseProgress>>;

/** The storage key a lesson's progress is kept under; the version moves when the shape does. */
export function storageKey(lesson: string): string {
	return `yukibana-course/${lesson}/v1`;
}

/** Whether `value` is a non-negative whole number. */
function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Returns the progress `text` holds, leaving out every entry that is not one; empty for text that is not JSON. */
export function parseProgress(text: string | null): Progress {
	if (text === null) return {};
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return {};
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
	const progress: Record<string, ExerciseProgress> = {};
	for (const [id, entry] of Object.entries(value)) {
		if (typeof entry !== 'object' || entry === null) continue;
		const { passed, score, total, draft } = entry as Record<string, unknown>;
		if (typeof passed !== 'boolean' || !isCount(score) || !isCount(total) || score > total) continue;
		if (draft !== null && typeof draft !== 'string') continue;
		progress[id] = { passed, score, total, draft };
	}
	return progress;
}

/** What `loadProgress` and `saveProgress` need of a storage: `localStorage`'s two calls. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

/** Returns the lesson's progress kept in `storage`, or none when there is none or the storage refuses to be read. */
export function loadProgress(storage: KeyValueStore | null, lesson: string): Progress {
	if (storage === null) return {};
	try {
		return parseProgress(storage.getItem(storageKey(lesson)));
	} catch {
		return {};
	}
}

/** Keeps `progress` in `storage`; returns false when the storage refused it (full, or blocked), which the page says. */
export function saveProgress(storage: KeyValueStore | null, lesson: string, progress: Progress): boolean {
	if (storage === null) return false;
	try {
		storage.setItem(storageKey(lesson), JSON.stringify(progress));
		return true;
	} catch {
		return false;
	}
}

/** How far through the lesson `progress` is: exercises passed, of `ids`. */
export function summaryOf(progress: Progress, ids: readonly string[]): { readonly passed: number; readonly total: number } {
	return { passed: ids.filter((id) => progress[id]?.passed === true).length, total: ids.length };
}
