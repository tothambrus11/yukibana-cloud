/**
 * Where a pack's files are, what the pack says about itself, and how its
 * workers are started: the values a session is given instead of the
 * constant `packs/<pack>/` every part of the app used to build for itself.
 *
 * - {@link PackLocator}: the URL of a pack's file. `PackLocator.unpinned`
 *   is Light's own layout (`<base><pack>/<file>`), which Light's service
 *   worker keeps on one build; `PackLocator.pinned` is how another site
 *   uses Light's packs, every file of a pack from the one build the page
 *   chose (`<base><pack>/@<build>/<file>`), read lazily from the packs'
 *   `index.json`.
 * - {@link PackInfo}: a pack's pack.json, read ({@link readPackInfo}).
 * - {@link WorkerFactory}: how a worker is created from a pack's URL, as
 *   it is ({@link moduleWorkerFactory}) or through a same-origin blob that
 *   imports it ({@link blobTrampolineFactory}). A served pack's workers are
 *   never re-bundled: they find their files from their own
 *   `import.meta.url`.
 * - {@link SessionSource}: what a session starts its worker from, a served
 *   pack or a worker the host bundled itself (Hylo's compiler), and what
 *   each says about its needs.
 *
 * Nothing here fetches on import or on construction: a locator reads the
 * index the first time it is asked for a file, and a session asks only
 * when it is first used.
 */
import {
	needFor,
	parseRequires,
	protocolProblem,
	PROTOCOL_MAJOR,
	requirementProblem,
	type RequirementProblem,
	type Requires,
	type RunnerCall,
	type StartingContext,
	type WorkerKind,
} from '../protocol/requirements.ts';
import { pathProblem } from './paths.ts';

/**
 * A pack's id: the name of its directory under a packs base (`cpp`,
 * `javascript`, `hylo`), and nothing else. It is a plain string a third
 * party may choose, never a list of the packs Light ships, so a pack
 * nobody here has heard of is located like ours. A string becomes one only
 * through {@link packIdOf}, which checks it is one path segment.
 */
export type PackId = string & { readonly brand: 'PackId' };

/** Lowercase letters, digits, `.`, `_` and `-`, not starting with a dot: one path segment on every host, and never `.` or `..`. */
const PACK_ID = /^[a-z0-9][a-z0-9._-]*$/;

/** `value` as a {@link PackId}, or null when it is not one path segment a pack directory can have. */
export function packIdOf(value: string): PackId | null {
	return PACK_ID.test(value) ? (value as PackId) : null;
}

/**
 * Why a pack's file could not be located or read, as a reason a host
 * shows as it is, and its kind, for a host that acts on one:
 *
 * - `invalid`: the file's name is not a relative path within the pack.
 * - `unreachable`: the request failed without an answer (offline, a
 *   blocked or misconfigured cross-origin host).
 * - `status`: the server answered with an error status (`status` says
 *   which; 404 for a pack that is not installed, 410 for a build that has
 *   been replaced).
 * - `unreadable`: the answer is not a pack.json or index.json this copy
 *   can read; the reason names every problem.
 * - `protocol`: the packs serve no build for this page's protocol major,
 *   or the pack was built for another major.
 * - `absent`: the packs' index has no such pack for this page's major.
 */
export type PackErrorKind = 'invalid' | 'unreachable' | 'status' | 'unreadable' | 'protocol' | 'absent';

/** The one error a {@link PackLocator} rejects with: `message` is the reason. */
export class PackError extends Error {
	/** Which of the failures in {@link PackErrorKind} this is. */
	readonly kind: PackErrorKind;
	/** The HTTP status for kind `status`, null for every other kind. */
	readonly status: number | null;

	constructor(kind: PackErrorKind, reason: string, status: number | null = null) {
		super(reason);
		this.name = 'PackError';
		this.kind = kind;
		this.status = status;
	}
}

/**
 * A pack's pack.json (format 1) as this copy reads it: the fields a page
 * needs before it starts anything. Fields it does not use (the sizes of
 * what each worker loads, the test layout) are left for the host to read
 * from the same document; they never stop a pack from being used.
 */
export interface PackInfo {
	/** The pack's directory, which must be the one it was fetched from. */
	id: PackId;
	/** Its name as a reader knows it ("C++", "Hylo"), which every reason about the pack uses. */
	name: string;
	/** The protocol major it was built for; a pack of another major than {@link PROTOCOL_MAJOR} is never read further. */
	protocol: number;
	/**
	 * The digest of every file of this build and of what pack.json says,
	 * which pinned URLs name (`@<build>`); null in a pack.json written by
	 * hand, which is served only unpinned.
	 */
	build: string | null;
	/** What each of its workers needs from the page. */
	requires: Requires;
}

/**
 * What {@link readPackInfo} read: the pack's info, or why it cannot be
 * used. `protocol` is the refusal when the pack was built for another
 * major (and then `problems` holds only its reason, since nothing else a
 * pack of another major says is read).
 */
export type ReadPackInfo =
	| { ok: true; info: PackInfo }
	| { ok: false; problems: string[]; protocol: RequirementProblem | null };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The characters a pinned build may have: one URL path segment, never `.` or `..`. */
const BUILD = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Reads a pack.json (already parsed from JSON) for the pack in directory
 * `id`, in the order requirements.ts asks: the protocol major first, then
 * the format and the needs, so a pack of another major is refused by
 * {@link protocolProblem}'s reason (with its name, when it has a readable
 * one) and not by a complaint about a format or field this copy has never
 * heard of. Every other problem is named, all at once.
 */
export function readPackInfo(value: unknown, id: PackId): ReadPackInfo {
	if (!isRecord(value)) return { ok: false, problems: [`the pack.json of ${id} is not an object`], protocol: null };
	const name = value['name'];
	const shown = typeof name === 'string' && name.trim() !== '' ? name : id;
	const protocol = value['protocol'];
	if (typeof protocol !== 'number' || !Number.isSafeInteger(protocol) || protocol < 1) {
		return { ok: false, problems: [`the pack.json of ${id} has protocol ${JSON.stringify(protocol)}, not a major version (a whole number from 1)`], protocol: null };
	}
	const refused = protocolProblem({ pack: shown, protocol });
	if (refused !== null) return { ok: false, problems: [refused.reason], protocol: refused };
	if (value['format'] !== 1) {
		return { ok: false, problems: [`the pack.json of ${id} has format ${JSON.stringify(value['format'])}, and this page reads format 1`], protocol: null };
	}
	const problems: string[] = [];
	if (shown === id && name !== id) problems.push(`the pack.json of ${id} has no name`);
	if (value['id'] !== id) problems.push(`the pack.json in ${id}/ says it is ${JSON.stringify(value['id'])}`);
	const build = value['build'];
	if (build !== undefined && (typeof build !== 'string' || !BUILD.test(build))) {
		problems.push(`the pack.json of ${id} has build ${JSON.stringify(build)}, not a digest of letters, digits, "_" and "-"`);
	}
	const requires = parseRequires(value['requires']);
	if (!requires.ok) problems.push(...requires.problems.map((problem) => `the pack.json of ${id}: ${problem}`));
	if (problems.length > 0 || !requires.ok) return { ok: false, problems, protocol: null };
	return { ok: true, info: { id, name: shown, protocol, build: typeof build === 'string' ? build : null, requires: requires.requires } };
}

/**
 * The packs' `index.json` (format 1): for each protocol major the packs
 * serve, the current build of each pack. A page uses the builds of its
 * own major ({@link PROTOCOL_MAJOR}) and no other.
 *
 * ```json
 * { "format": 1, "protocols": { "1": { "cpp": "<build>", "python": "<build>" } } }
 * ```
 */
export interface PackIndex {
	/** Major, as a number, to pack id to build. */
	protocols: Map<number, Map<PackId, string>>;
}

/** What {@link readPackIndex} read: the index, or every problem with it. */
export type ReadPackIndex = { ok: true; index: PackIndex } | { ok: false; problems: string[] };

/**
 * Reads a packs index (already parsed from JSON). A major this copy will
 * never use is read all the same, so a page can say which majors the
 * packs do serve when its own is missing.
 */
export function readPackIndex(value: unknown): ReadPackIndex {
	if (!isRecord(value)) return { ok: false, problems: ['the packs index is not an object'] };
	if (value['format'] !== 1) return { ok: false, problems: [`the packs index has format ${JSON.stringify(value['format'])}, and this page reads format 1`] };
	const protocols = value['protocols'];
	if (!isRecord(protocols)) return { ok: false, problems: ['the packs index has no protocols'] };
	const problems: string[] = [];
	const index: PackIndex = { protocols: new Map() };
	for (const [major, builds] of Object.entries(protocols)) {
		if (!/^[1-9][0-9]*$/.test(major)) {
			problems.push(`the packs index has protocol '${major}', not a major version`);
			continue;
		}
		if (!isRecord(builds)) {
			problems.push(`the packs index's protocol ${major} is not an object of builds`);
			continue;
		}
		const packs = new Map<PackId, string>();
		for (const [pack, build] of Object.entries(builds)) {
			const id = packIdOf(pack);
			if (id === null) problems.push(`the packs index's protocol ${major} has '${pack}', not a pack id`);
			else if (typeof build !== 'string' || !BUILD.test(build)) problems.push(`the packs index's protocol ${major} has build ${JSON.stringify(build)} for ${pack}`);
			else packs.set(id, build);
		}
		index.protocols.set(Number(major), packs);
	}
	return problems.length === 0 ? { ok: true, index } : { ok: false, problems };
}

/**
 * Whether what a page pinned for a pack is still what its host serves,
 * as {@link PackLocator.stillCurrent} found out: `replaced` when the host
 * now serves another build (or none) for the page's major, `current` when
 * not, `unknown` when it could not tell (the index did not answer). Only
 * `replaced` turns a load failure into "the packs were updated; reload the
 * page"; the others leave the failure's own reason.
 */
export type Currency = 'current' | 'replaced' | 'unknown';

/**
 * Where one host's packs are. Sessions take one and ask it, never build a
 * pack URL of their own, so the same session code serves Light's app (its
 * packs beside it, unpinned) and a docs site using Light's packs from
 * another origin (pinned).
 */
export interface PackLocator {
	/** The packs' base, ending in `/`: its origin decides whether a worker started from it is same-origin with the page. */
	readonly base: URL;
	/**
	 * The URL of file `name` (a relative path within the pack, as {@link
	 * pathProblem} accepts) of pack `pack`. Asynchronous because a pinned
	 * locator reads the packs' index the first time it is asked; rejects
	 * with a {@link PackError}, never with anything else.
	 */
	file(pack: PackId, name: string): Promise<URL>;
	/** The pack's pack.json, read and checked ({@link readPackInfo}), once per page; rejects with a {@link PackError}. */
	packInfo(pack: PackId): Promise<PackInfo>;
	/**
	 * Whether the build this page uses for `pack` is still the one served
	 * ({@link Currency}). A session asks when its worker failed to load,
	 * since a Worker's error event carries no status: a load that failed
	 * because the build was replaced (a 410) and one that failed because
	 * the network did look the same. Never rejects.
	 */
	stillCurrent(pack: PackId): Promise<Currency>;
}

/** How a locator fetches: `fetch` itself by default, a stand-in in tests. */
export type Fetch = (url: URL, init?: RequestInit) => Promise<Response>;

/** The global `fetch`, looked up at each call so a host that installs its own later is used. */
const globalFetch: Fetch = (url, init) => fetch(url, init);

/** `base` as a packs base: an absolute URL whose path ends in `/`; a RangeError naming it otherwise. */
function baseOf(base: URL): URL {
	if (!base.pathname.endsWith('/') || base.search !== '' || base.hash !== '') {
		throw new RangeError(`${base.href} is not a packs base: it must end in "/" and have no query or fragment`);
	}
	return new URL(base.href);
}

/** `name` with each segment percent-encoded, after checking it is a relative path within a pack. */
function encodedName(pack: PackId, name: string): string {
	const problem = pathProblem(name);
	if (problem !== null) throw new PackError('invalid', `"${name}" is not a file of the pack ${pack}: ${problem}`);
	return name.split('/').map(encodeURIComponent).join('/');
}

/** The JSON at `url`, or a {@link PackError} that names the URL and what went wrong. */
async function fetchJson(fetcher: Fetch, url: URL, what: string, init?: RequestInit): Promise<unknown> {
	let response: Response;
	try {
		response = await fetcher(url, init);
	} catch (e) {
		throw new PackError('unreachable', `Could not load ${what} (${url.href}): ${e instanceof Error ? e.message : String(e)}`);
	}
	if (!response.ok) {
		const why = response.status === 404 ? 'it is not there' : response.status === 410 ? 'it has been replaced by a newer build' : `the server answered ${response.status}`;
		throw new PackError('status', `Could not load ${what} (${url.href}): ${why}.`, response.status);
	}
	try {
		return (await response.json()) as unknown;
	} catch (e) {
		throw new PackError('unreadable', `${what} (${url.href}) is not JSON: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/** A pack.json fetched from `url` and read for `pack`, or the {@link PackError} that says why not. */
async function packInfoAt(fetcher: Fetch, url: URL, pack: PackId): Promise<PackInfo> {
	const read = readPackInfo(await fetchJson(fetcher, url, `the pack.json of ${pack}`), pack);
	if (read.ok) return read.info;
	throw new PackError(read.protocol !== null ? 'protocol' : 'unreadable', read.problems.join('; '));
}

/**
 * A promise kept once it fulfils, forgotten once it rejects: a page reads
 * a thing once, but one failed read (a moment offline) must not fail every
 * later session on the page.
 */
function once<T>(load: () => Promise<T>): () => Promise<T> {
	let kept: Promise<T> | null = null;
	return () => {
		if (kept === null) {
			const loading = load();
			kept = loading;
			loading.catch(() => {
				if (kept === loading) kept = null;
			});
		}
		return kept;
	};
}

/** Memoises {@link once} per pack. */
function oncePerPack<T>(load: (pack: PackId) => Promise<T>): (pack: PackId) => Promise<T> {
	const loads = new Map<PackId, () => Promise<T>>();
	return (pack) => {
		let get = loads.get(pack);
		if (get === undefined) {
			get = once(() => load(pack));
			loads.set(pack, get);
		}
		return get();
	};
}

/**
 * Light's own layout, which its service worker keeps on one build: file
 * `name` of `pack` is `<base><pack>/<name>`. Because nothing has to be read
 * first, it also answers synchronously ({@link UnpinnedPackLocator.url}).
 */
export interface UnpinnedPackLocator extends PackLocator {
	/**
	 * The URL {@link PackLocator.file} resolves to, at once. Only an
	 * unpinned locator can answer without reading anything, so only code
	 * that is given one (Light's app) may call it; code that takes any
	 * locator awaits `file`. Throws a {@link PackError} of kind `invalid`
	 * for a name that is not a file of the pack.
	 */
	url(pack: PackId, name: string): URL;
}

/**
 * Where a page finds a host's packs: the two layouts a host serves.
 *
 * Both are created at page setup at no cost, since neither fetches
 * anything until a session first asks it for a file.
 */
export const PackLocator = {
	/**
	 * Packs at `base` (ending in `/`), unpinned: every file at
	 * `<base><pack>/<name>`, whatever build the host serves at the time.
	 * That is right only where something else keeps a page on one build,
	 * as Light's service worker does for Light's app. {@link
	 * PackLocator.stillCurrent} is always `current`, since the locator
	 * names no build that could be replaced.
	 */
	unpinned(base: URL, options: { fetch?: Fetch } = {}): UnpinnedPackLocator {
		const root = baseOf(base);
		const fetcher = options.fetch ?? globalFetch;
		const url = (pack: PackId, name: string): URL => new URL(`${pack}/${encodedName(pack, name)}`, root);
		const info = oncePerPack((pack) => packInfoAt(fetcher, url(pack, 'pack.json'), pack));
		return {
			base: root,
			url,
			file: async (pack, name) => url(pack, name),
			packInfo: info,
			stillCurrent: async () => 'current',
		};
	},

	/**
	 * Packs at `base` (ending in `/`), pinned: the first time it is asked
	 * for anything it reads `<base>index.json` (once per page, a failed read
	 * is tried again on the next ask), takes the build of each pack for
	 * this page's {@link PROTOCOL_MAJOR}, and from then on names every file
	 * of a pack at `<base><pack>/@<build>/<name>`. So all of a page's
	 * sessions use one build of each pack, and a deploy during a visit is
	 * a named 410 for a file not yet loaded, never a file of another build
	 * mixed in.
	 *
	 * The index is read when first used, not here, so that creating the
	 * locator at page setup costs a page that runs nothing no request
	 * (RT9 in the architecture plan: an eager read cost one per page view).
	 */
	pinned(base: URL, options: { fetch?: Fetch } = {}): PackLocator {
		const root = baseOf(base);
		const fetcher = options.fetch ?? globalFetch;
		const indexUrl = new URL('index.json', root);
		const readIndex = async (init?: RequestInit): Promise<PackIndex> => {
			const read = readPackIndex(await fetchJson(fetcher, indexUrl, "the packs' index", init));
			if (!read.ok) throw new PackError('unreadable', read.problems.join('; '));
			return read.index;
		};
		const index = once(() => readIndex());
		const buildOf = async (pack: PackId): Promise<string> => {
			const { protocols } = await index();
			const builds = protocols.get(PROTOCOL_MAJOR);
			if (builds === undefined) {
				const served = [...protocols.keys()].sort((a, b) => a - b);
				const newer = served.length > 0 && served.every((major) => major > PROTOCOL_MAJOR);
				const which = served.length === 0 ? 'no protocol at all' : `protocol ${served.join(', ')}`;
				throw new PackError(
					'protocol',
					`The packs at ${root.href} serve ${which}, and this page speaks protocol ${PROTOCOL_MAJOR}. ` +
						(newer ? "The page's owner needs to update the page's Yukibana modules." : `Whoever hosts the packs needs to serve builds for protocol ${PROTOCOL_MAJOR}.`),
				);
			}
			const build = builds.get(pack);
			if (build === undefined) throw new PackError('absent', `The packs at ${root.href} have no pack ${pack} for protocol ${PROTOCOL_MAJOR}.`);
			return build;
		};
		const file = async (pack: PackId, name: string): Promise<URL> => {
			const path = encodedName(pack, name);
			return new URL(`${pack}/@${await buildOf(pack)}/${path}`, root);
		};
		const info = oncePerPack(async (pack) => {
			const read = await packInfoAt(fetcher, await file(pack, 'pack.json'), pack);
			const build = await buildOf(pack);
			if (read.build !== build) {
				throw new PackError('unreadable', `The pack.json of ${pack} at build ${build} says it is build ${String(read.build)}: the packs at ${root.href} are inconsistent.`);
			}
			return read;
		});
		return {
			base: root,
			file,
			packInfo: info,
			stillCurrent: async (pack) => {
				let pinned: string | undefined;
				try {
					pinned = (await index()).protocols.get(PROTOCOL_MAJOR)?.get(pack);
				} catch {
					return 'unknown';
				}
				let served: string | undefined;
				try {
					served = (await readIndex({ cache: 'no-cache' })).protocols.get(PROTOCOL_MAJOR)?.get(pack);
				} catch {
					return 'unknown';
				}
				return served === pinned ? 'current' : 'replaced';
			},
		};
	},
};

/**
 * How a host creates a worker from a pack's URL. `name` names it in the
 * browser's tools. Every worker of a pack is a module worker started from
 * the pack's own URL, so its `import.meta.url` is the pack's and it finds
 * its files beside it; a factory that re-bundled it would break that.
 */
export type WorkerFactory = (url: URL, options: { name: string }) => Worker;

/** The worker as it is, from its URL: for packs on the page's own origin. */
export const moduleWorkerFactory: WorkerFactory = (url, { name }) => new Worker(url, { type: 'module', name });

/**
 * The source of a same-origin module worker that runs the module at
 * `url` (absolute, usually on another origin): one static import.
 *
 * Static, not `import(url)`. A module worker starts dispatching messages
 * as soon as its own module has evaluated, and a dynamic import would let
 * that happen before the pack's module had set its handler, so what the
 * host posts right after creating the worker (`initialize`, a run) would
 * reach no handler and be dropped. With a static import the whole graph,
 * the pack's module included, is fetched and evaluated first, and a module
 * that fails to load fires `error` on the Worker as a direct one does
 * (RT5 and RT6 in the architecture plan).
 */
export function trampolineSource(url: URL): string {
	return `import ${JSON.stringify(url.href)};\n`;
}

/**
 * Creates each worker from a same-origin `blob:` module that imports the
 * pack's URL ({@link trampolineSource}), for packs on another origin, from
 * which a page may not start a worker directly. The pack's module keeps its
 * own `import.meta.url`, so it still finds its files beside it; what it
 * cannot do is start workers of its own from its URL, which is why such a
 * pack declares `sameOriginPacks` and is refused on another origin before
 * this is reached.
 *
 * The blob's URL is revoked once the worker has said anything or failed,
 * by which time it has been fetched.
 */
export const blobTrampolineFactory: WorkerFactory = (url, { name }) => {
	const source = URL.createObjectURL(new Blob([trampolineSource(url)], { type: 'text/javascript' }));
	const worker = new Worker(source, { type: 'module', name });
	const revoke = (): void => {
		URL.revokeObjectURL(source);
		worker.removeEventListener('message', revoke);
		worker.removeEventListener('error', revoke);
	};
	worker.addEventListener('message', revoke);
	worker.addEventListener('error', revoke);
	return worker;
};

/** The factory for a locator's packs on a page of origin `origin`: direct when same-origin, through a trampoline otherwise. */
export function factoryFor(locator: PackLocator, origin: string): WorkerFactory {
	return locator.base.origin === origin ? moduleWorkerFactory : blobTrampolineFactory;
}

/**
 * Why a worker created from `url` did not load, from its `error` event,
 * which names neither the URL nor a status: what a session shows in its
 * failed state. A trampoline's event is about its blob, so the pack's URL
 * is named here, by the caller that knows it.
 */
export function loadFailure(url: URL, event: { message?: string }): string {
	const why = event.message !== undefined && event.message !== '' ? event.message : 'the script, or a module it imports, failed to load or to run';
	return `Could not load ${url.href}: ${why}.`;
}

/** The file of each kind of worker in a pack (packs/CONTRACT.md). */
export const WORKER_FILES: Readonly<Record<WorkerKind, string>> = {
	lsp: 'server.js',
	runner: 'runner.js',
	explorer: 'explorer.js',
};

/**
 * What a session starts its worker from.
 *
 * - A served pack: its {@link PackInfo} (whose needs and protocol major
 *   come from its pack.json) and the {@link PackLocator} it was found
 *   through. Its worker is the pack's file for the kind ({@link
 *   WORKER_FILES}), created by the host's {@link WorkerFactory}.
 * - A worker the host bundled itself (Hylo's compiler through Vite's
 *   `?worker`): a function that creates it, its `name` as a reader knows
 *   it, and its needs inline, since it has no pack.json. It speaks the
 *   page's own protocol major, having been built with the page.
 *
 * Needs, the silence timeout and the failed states apply to both alike.
 */
export type SessionSource =
	| { pack: PackInfo; locator: PackLocator }
	| { name: string; worker: () => Worker; requires: Requires };

/** What the page a worker would start on has: its origin and whether it is cross-origin isolated. */
export interface PageContext {
	origin: string;
	crossOriginIsolated: boolean;
}

/**
 * Why `source`'s `worker` (for a runner, as `call` will ask it) must not
 * start on `page`, or null when it may: a pack of another protocol major,
 * a worker the source does not have, or a need the page cannot meet, each
 * with a reason a host shows as it is. Pure, so a session asks it before
 * it creates a worker or fetches a byte. A host-built worker counts as
 * same-origin, since it came with the page.
 */
export function sourceProblem(source: SessionSource, worker: WorkerKind, page: PageContext, call: RunnerCall = {}): RequirementProblem | null {
	const served = 'pack' in source;
	const requires = served ? source.pack.requires : source.requires;
	const need = worker === 'runner' ? needFor(requires, 'runner', call) : needFor(requires, worker);
	const context: StartingContext = {
		crossOriginIsolated: page.crossOriginIsolated,
		packsSameOrigin: served ? source.locator.base.origin === page.origin : true,
	};
	return requirementProblem(
		need,
		{
			pack: served ? source.pack.name : source.name,
			worker,
			...(worker === 'runner' ? { call } : {}),
			protocol: served ? source.pack.protocol : PROTOCOL_MAJOR,
		},
		context,
	);
}

/**
 * A started worker and the URL it was started from (null for a host-built
 * one), which a session names when the worker fails to load ({@link
 * loadFailure}) and asks the locator about ({@link PackLocator.stillCurrent}).
 */
export interface StartedWorker {
	worker: Worker;
	url: URL | null;
}

/**
 * Creates `source`'s worker of kind `worker`: a served pack's from its
 * file for that kind through `factory`, a host-built one by its own
 * function. Rejects with a {@link PackError} when the pack's file cannot
 * be located. It checks nothing: a session asks {@link sourceProblem}
 * first.
 */
export async function startWorker(source: SessionSource, worker: WorkerKind, factory: WorkerFactory): Promise<StartedWorker> {
	if (!('pack' in source)) return { worker: source.worker(), url: null };
	const url = await source.locator.file(source.pack.id, WORKER_FILES[worker]);
	return { worker: factory(url, { name: `${source.pack.id} ${worker}` }), url };
}
