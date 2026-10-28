/**
 * A language server's optional parts and the app's settings for them: the
 * `yukibana/status` notification a pack sends about a part it loads or
 * runs beside the server itself (the C++ pack's clang-tidy), and the
 * `yukibana/configure` notification the app sends when the project's
 * settings change after `initialize` (packs/CONTRACT.md, "Optional parts").
 */

/** The JSON-RPC method of a server's notification about one of its parts. */
export const STATUS_METHOD = 'yukibana/status';

/** The JSON-RPC method of the app's notification of new settings; the params are the pack's own. */
export const CONFIGURE_METHOD = 'yukibana/configure';

/**
 * Where a part is: `off` (the project turned it off), `pending` (on, and
 * waiting for something to load first), `loading`, `ready`, or `failed`
 * (`detail` says why; the server goes on without it).
 */
export type PartState = 'off' | 'pending' | 'loading' | 'ready' | 'failed';

const STATES: readonly string[] = ['off', 'pending', 'loading', 'ready', 'failed'] satisfies readonly PartState[];

/** One report about a part: the latest for an `id` replaces the one before. */
export interface PartStatus {
	/** Which part, as the pack names it (`clang-tidy`); stable for the pack's life. */
	id: string;
	/** Its name, shown to the user. */
	label: string;
	state: PartState;
	/** A sentence for the user, with `failed` the reason. */
	detail?: string;
}

/** Whether `value` is a {@link PartStatus}. Extra fields are allowed (a newer pack's), and ignored. */
export function isPartStatus(value: unknown): value is PartStatus {
	if (typeof value !== 'object' || value === null) return false;
	const p = value as Record<string, unknown>;
	return typeof p.id === 'string' && typeof p.label === 'string' && typeof p.state === 'string' && STATES.includes(p.state) && (p.detail === undefined || typeof p.detail === 'string');
}
