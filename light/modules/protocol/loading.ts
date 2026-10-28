/**
 * Download progress, as a pack reports it: a language server with the
 * `yukibana/loading` notification, a runner or explorer with a `loading`
 * message (packs/CONTRACT.md, "Transport" and "Running a program"). The
 * shape is the same everywhere, so a host shows one progress bar for all.
 */

/** The JSON-RPC method of a language server's progress notification. */
export const LOADING_METHOD = 'yukibana/loading';

/** One report of a download in progress. */
export interface LoadingProgress {
	/** What is downloading, as the pack names it (a file name, usually); shown to the user. */
	label: string;
	/** Bytes so far, 0 or more. */
	loaded: number;
	/** Bytes expected, or 0 when the pack does not know. */
	total: number;
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * Whether `value` is a {@link LoadingProgress}: a string label and two
 * finite counts that are not negative. Extra fields are allowed (a newer
 * pack's), and ignored.
 */
export function isLoadingProgress(value: unknown): value is LoadingProgress {
	if (typeof value !== 'object' || value === null) return false;
	const p = value as Record<string, unknown>;
	return typeof p.label === 'string' && isCount(p.loaded) && isCount(p.total);
}

/**
 * Whether the download `progress` reports is over: its total is known and
 * reached. A pack may download again later in the session (packs/CONTRACT.md),
 * and nothing else says a download ended, so a host clears its bar on this.
 */
export function loadingDone(progress: LoadingProgress): boolean {
	return progress.total > 0 && progress.loaded >= progress.total;
}
