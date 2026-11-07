/**
 * The page's explorer workers (explore.ts): one `explorer.js` per pack,
 * started at the first request for the pack and shared by whoever asks, and
 * the body of every explore provider. Loaded on a first request, not with
 * the views' data and the token: a page that never opens a view downloads
 * none of it (explore.ts `pageExplorers`, the provider's lazy body).
 */

import type { Perform } from '../core/index.ts';
import type { PackId } from '../runtime/index.ts';
import type {
	EmitInput,
	EmitMessage,
	EmitResult,
	ExploreHolder,
	ExploreHost,
	ExplorerEvents,
	ExplorerPlatform,
	ExplorerWorker,
	ExploreProgress,
	LineCode,
	MappedLine,
	SourceLine,
} from './explore.ts';
import type { PackLanguage } from './language.ts';

/** Returns the platform of a page: a module `Worker`, whose error events are handled, and a HEAD `fetch`. */
export function pagePlatform(): ExplorerPlatform {
	return {
		start(url, events) {
			const worker = new Worker(url, { type: 'module' });
			worker.onmessage = (e: MessageEvent<unknown>) => events.message(e.data);
			worker.onerror = (e) => {
				e.preventDefault();
				events.error(e.message);
			};
			return { post: (message) => worker.postMessage(message), terminate: () => worker.terminate() };
		},
		served: async (url) => (await fetch(url, { method: 'HEAD' })).ok,
	};
}

/**
 * A request waiting for its answer.
 *
 * Invariant: it is in `on.waiting` under `message.id`, and nowhere else,
 * until it is settled.
 */
interface Waiting {
	/** Who it was made for. */
	readonly holder: ExploreHolder;
	/** What was posted, under the id it was last posted with. */
	message: EmitMessage;
	/** The worker it was last posted to. */
	on: Started | null;
	readonly settle: (result: EmitResult) => void;
	readonly onProgress: (progress: ExploreProgress) => void;
}

/**
 * A started worker of one pack, the requests it has not answered, and who
 * holds it.
 *
 * Invariant: every holder of a waiting request is in `holders`.
 */
interface Started {
	readonly url: string;
	readonly worker: ExplorerWorker;
	readonly waiting: Map<number, Waiting>;
	/** Who has made a request of it and not let it go (`ExplorerWorkers.release`). */
	readonly holders: Set<ExploreHolder>;
}

/** Thrown by the readers below for a field of an answer that is not what the contract says. */
class Malformed extends Error {}

/** Returns `value` as a record when it is a non-null object, else null. */
function recordOf(value: unknown): Readonly<Record<string, unknown>> | null {
	return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : null;
}

/** Returns field `name` of `m` when it is a number, `fallback` when it is absent. Throws `Malformed` otherwise. */
function numberAt(m: Readonly<Record<string, unknown>>, name: string, fallback: number): number {
	const value = m[name];
	if (value === undefined) return fallback;
	if (typeof value !== 'number') throw new Malformed(`${name} is not a number`);
	return value;
}

/** Returns field `name` of `m` when it is a string, `fallback` when it is absent. Throws `Malformed` otherwise. */
function stringAt(m: Readonly<Record<string, unknown>>, name: string, fallback: string): string {
	const value = m[name];
	if (value === undefined) return fallback;
	if (typeof value !== 'string') throw new Malformed(`${name} is not a string`);
	return value;
}

/** Returns field `name` of `m`, an array, each entry read by `entry` (given the entry's own name), empty when it is absent. Throws `Malformed` otherwise. */
function arrayAt<T>(m: Readonly<Record<string, unknown>>, name: string, entry: (value: unknown, name: string) => T): readonly T[] {
	const value: unknown = m[name];
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Malformed(`${name} is not an array`);
	return value.map((v: unknown, i) => entry(v, `${name}[${i}]`));
}

/** Returns `value`, named `name`, as a record. Throws `Malformed` when it is not one. */
function recordAt(value: unknown, name: string): Readonly<Record<string, unknown>> {
	const m = recordOf(value);
	if (m === null) throw new Malformed(`${name} is not an object`);
	return m;
}

/** Returns `value`, named `name`, as a source line: a `file` and a `line`. Throws `Malformed` when it is not one. */
function sourceLineAt(value: unknown, name: string): SourceLine {
	const m = recordAt(value, name);
	const file = m['file'];
	const line = m['line'];
	if (typeof file !== 'string') throw new Malformed(`${name}.file is not a string`);
	if (typeof line !== 'number') throw new Malformed(`${name}.line is not a number`);
	return { file, line };
}

/** Returns `value`, named `name`, as an output line's source line, or null. Throws `Malformed` when it is neither. */
function mappedLineAt(value: unknown, name: string): MappedLine | null {
	if (value === null) return null;
	const m = recordAt(value, name);
	const at = sourceLineAt(m, name);
	const column = m['column'] === undefined ? null : numberAt(m, 'column', 0);
	const via = m['via'] === undefined ? null : sourceLineAt(m['via'], `${name}.via`);
	return { ...at, ...(column === null ? {} : { column }), ...(via === null ? {} : { via }) };
}

/** Returns `value`, named `name`, as a line with code at -O0. Throws `Malformed` when it is not one. */
function lineCodeAt(value: unknown, name: string): LineCode {
	const m = recordAt(value, name);
	const count = m['count'];
	if (typeof count !== 'number') throw new Malformed(`${name}.count is not a number`);
	return { ...sourceLineAt(m, name), count };
}

/** Returns `value`, named `name`, as a string. Throws `Malformed` when it is not one. */
function stringEntry(value: unknown, name: string): string {
	if (typeof value !== 'string') throw new Malformed(`${name} is not a string`);
	return value;
}

/**
 * Returns the answer explorer.js gave in `m`, a `result` message, read as
 * the contract states it (packs/CONTRACT.md): a field it leaves out reads
 * as empty; a field, or an entry of the line maps, that is not what the
 * contract says makes the answer `broken`, naming it, so that a pack's
 * mistake is told where it is made and not where a view reads it.
 */
export function resultOf(m: Readonly<Record<string, unknown>>): EmitResult {
	try {
		if (m['ok'] === true) {
			return {
				kind: 'output',
				text: stringAt(m, 'text', ''),
				lines: arrayAt(m, 'lines', mappedLineAt),
				unoptimized: arrayAt(m, 'unoptimized', lineCodeAt),
				target: stringAt(m, 'target', ''),
				triple: stringAt(m, 'triple', ''),
				flags: arrayAt(m, 'flags', stringEntry),
				ms: numberAt(m, 'ms', 0),
			};
		}
		const target = m['target'] ?? null;
		if (target !== null && typeof target !== 'string') throw new Malformed('target is neither a string nor null');
		return { kind: 'failed', error: stringAt(m, 'error', ''), target, ms: numberAt(m, 'ms', 0) };
	} catch (e) {
		if (!(e instanceof Malformed)) throw e;
		return { kind: 'broken', error: `The compiler output worker sent an answer the app cannot read: ${e.message}.` };
	}
}

/**
 * The page's explorer workers, one per pack, each started the first time a
 * request for its pack is made: what a host lends every explore provider,
 * so C's and C++'s views, and two instances' views of one pack, share one
 * worker, which holds a compiler or two and their unpacked headers.
 *
 * A worker is held by whoever made a request of it (`EmitInput.holder`)
 * until they let it go (`release`), and stopped once nobody holds it.
 * explorer.js answers only the newest request of each view kind it has,
 * so a holder's request that another holder's of the same kind replaced is
 * posted again once the newer is answered: each holder gets an answer to
 * its own.
 *
 * Invariant: at most one worker per pack is started; every request is
 * settled exactly once, by its answer, its signal, its holder's `release`
 * or the worker's failure.
 */
export class ExplorerWorkers {
	readonly #platform: ExplorerPlatform;
	readonly #started = new Map<PackId, Started>();
	/** The id of the last request posted, on any worker: ids only increase. */
	#lastId = 0;

	/** Makes the page's workers, started (when a request needs one) by `platform`; starts nothing. */
	constructor(platform: ExplorerPlatform) {
		this.#platform = platform;
	}

	/**
	 * Returns what `pack`'s worker, started from `url` if it is not running,
	 * answers to `input`, as soon as it answers; or `dropped` as soon as
	 * `signal` is aborted (at once if it already is), or `input.holder` lets
	 * the worker go, when the answer is no longer waited for and is ignored
	 * if it comes; or `broken` when the worker fails first, or answers what
	 * the app cannot read. Every download the worker reports meanwhile goes
	 * to `input.onProgress`. `input.holder` holds the worker from now on.
	 * Never rejects.
	 */
	emit(pack: PackId, url: URL, input: EmitInput, signal: AbortSignal): Promise<EmitResult> {
		if (signal.aborted) return Promise.resolve({ kind: 'dropped' });
		const started = this.#startedFor(pack, url);
		started.holders.add(input.holder);
		const { promise, resolve } = Promise.withResolvers<EmitResult>();
		const onAbort = (): void => waiting.settle({ kind: 'dropped' });
		const waiting: Waiting = {
			holder: input.holder,
			message: { type: 'emit', id: 0, emit: input.view, files: { ...input.files }, path: input.path, options: { ...input.options } },
			on: null,
			settle: (result) => {
				if (waiting.on?.waiting.get(waiting.message.id) !== waiting) return;
				waiting.on.waiting.delete(waiting.message.id);
				signal.removeEventListener('abort', onAbort);
				resolve(result);
			},
			onProgress: input.onProgress,
		};
		signal.addEventListener('abort', onAbort, { once: true });
		this.#post(started, waiting);
		return promise;
	}

	/**
	 * Lets `pack`'s worker go for `holder`, settling every request `holder`
	 * has waiting as `dropped`: no view of the holder's is open, or its
	 * language or its project changed. The worker is stopped once nobody
	 * holds it, and the next request starts a new one, whose downloads come
	 * from the HTTP cache. Does nothing when `holder` does not hold it.
	 */
	release(pack: PackId, holder: ExploreHolder): void {
		const started = this.#started.get(pack);
		if (started === undefined || !started.holders.delete(holder)) return;
		for (const waiting of [...started.waiting.values()]) if (waiting.holder === holder) waiting.settle({ kind: 'dropped' });
		if (started.holders.size > 0) return;
		this.#started.delete(pack);
		started.worker.terminate();
	}

	/** Posts `waiting`'s message to `started`'s worker under a new id, filing it there. */
	#post(started: Started, waiting: Waiting): void {
		waiting.message = { ...waiting.message, id: ++this.#lastId };
		waiting.on = started;
		started.waiting.set(waiting.message.id, waiting);
		started.worker.post(waiting.message);
	}

	/**
	 * Returns `pack`'s running worker, starting one from `url` if there is
	 * none, or if the running one was started from another URL: then what the
	 * old one had waiting is posted to the new one, its holders hold the new
	 * one, and the old one is stopped.
	 */
	#startedFor(pack: PackId, url: URL): Started {
		const running = this.#started.get(pack);
		if (running !== undefined && running.url === url.href) return running;
		const events: ExplorerEvents = {
			message: (data) => {
				if (this.#started.get(pack) === started) this.#receive(started, data);
			},
			error: (message) => {
				if (this.#started.get(pack) !== started) return;
				this.#started.delete(pack);
				started.worker.terminate();
				const failed = `The compiler output worker failed: ${message || 'unknown error'}`;
				// A worker that fails to load at all is most likely not built.
				void this.#platform.served(url).then(
					(served) => this.#fail(started, served ? failed : `The compiler output views are not installed (${url.pathname}).`),
					() => this.#fail(started, failed),
				);
			},
		};
		const started: Started = { url: url.href, worker: this.#platform.start(url, events), waiting: new Map(), holders: new Set(running?.holders) };
		this.#started.set(pack, started);
		if (running !== undefined) {
			running.worker.terminate();
			for (const waiting of [...running.waiting.values()]) {
				running.waiting.delete(waiting.message.id);
				this.#post(started, waiting);
			}
		}
		return started;
	}

	/**
	 * Takes a message of `started`'s worker: a download goes to every
	 * request waiting, an answer to its own; the older requests of the same
	 * kind still waiting then get none from the worker, which replaced them
	 * with this one, and are posted again.
	 */
	#receive(started: Started, data: unknown): void {
		const m = recordOf(data);
		if (m === null) return;
		if (m['type'] === 'loading') {
			const progress: ExploreProgress = { label: stringOr(m['label'], ''), loaded: numberOr(m['loaded'], 0), total: numberOr(m['total'], 0) };
			for (const waiting of started.waiting.values()) waiting.onProgress(progress);
			return;
		}
		const id = m['id'];
		if (m['type'] !== 'result' || typeof id !== 'number') return;
		const answered = started.waiting.get(id);
		if (answered === undefined) return;
		answered.settle(resultOf(m));
		for (const waiting of [...started.waiting.values()]) {
			if (waiting.message.id > id || waiting.message.emit !== answered.message.emit) continue;
			started.waiting.delete(waiting.message.id);
			this.#post(started, waiting);
		}
	}

	/** Settles every request `started`'s failed worker had as `broken`, saying `error`. */
	#fail(started: Started, error: string): void {
		for (const waiting of [...started.waiting.values()]) waiting.settle({ kind: 'broken', error });
	}
}

const numberOr = (value: unknown, fallback: number): number => (typeof value === 'number' ? value : fallback);
const stringOr = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);

/**
 * Returns the body of `language`'s explore provider: it finds the pack's
 * `explorer.js` through the host's packs and asks the host's workers
 * (`ExploreHost.explorers`), settling as `ExplorerWorkers.emit` does. A
 * pack whose `explorer.js` the locator cannot name, or workers that cannot
 * be made, give `broken`.
 */
export function explorePerform(language: PackLanguage): Perform<EmitInput, Promise<EmitResult>, ExploreHost> {
	return async (input, { host, signal }) => {
		let url: URL;
		let workers: ExplorerWorkers;
		try {
			url = await host.packs.file(language.pack, 'explorer.js');
			workers = await host.explorers();
		} catch (e) {
			return { kind: 'broken', error: `The compiler output views could not be found: ${e instanceof Error ? e.message : String(e)}` };
		}
		return workers.emit(language.pack, url, input, signal);
	};
}
