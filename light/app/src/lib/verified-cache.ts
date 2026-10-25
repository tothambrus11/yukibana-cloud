/**
 * What the service worker may hand out from its caches: only the bytes its
 * own build lists, checked every time against a table that cannot be
 * written from the page's origin.
 *
 * Why: programs run on Light's origin (workerTransport's dedicated workers,
 * a web project's preview), and Cache Storage is open to them. A cached
 * entry served unchecked is therefore a page a program can plant for every
 * later visit, and while Light is same-site with the cloud that page can
 * toss cookies onto yukibana.dev (RR2-7). Until this module the worker
 * served every navigation from its app cache unchecked and checked pack
 * entries only against a hash header, which the writer chooses.
 *
 * The trust root is the file table (`FileTable`): the sha256 and size of
 * every file the build can serve, written into service-worker.js itself at
 * build time (scripts/offline-manifest.mjs), because the browser fetches
 * that script from the network and nothing on the origin can change it. A
 * table read from Cache Storage, as offline.json once was, can be rewritten
 * together with the index.html it vouches for (RR3-8, D50).
 *
 * How an entry is checked depends on its size:
 *
 * * An app file (the shell and the lazy files, at most a few MB each) is
 *   read whole and hashed with `crypto.subtle` before any byte is served.
 *   Its verified bytes are then kept in memory for as long as this worker
 *   runs, so the next request neither re-reads nor re-hashes it, and a
 *   rewrite of the entry after the check cannot reach a page through the
 *   memo. A mismatch is a miss: the entry is deleted and the caller fetches
 *   from the network.
 * * A pack file (up to hundreds of MB) is handed over at once, so the pack
 *   sees its download progress, and hashed as it streams (`verifying`). A
 *   mismatch deletes the entry and errors the stream before its end, which
 *   every reader (a module import, `arrayBuffer()`, a progress reader) sees
 *   as a failed load (RT6, RT11) and never as a complete file.
 *
 * Headers are never taken from the cache either: a served entry is a fresh
 * 200 whose Content-Type comes from the path (as deploy/worker.js gives
 * it) and whose Content-Length is the table's size, so a program cannot
 * add a `Refresh`, a redirect or another type to bytes that are right.
 * A pack entry the worker stores does carry `HASH_HEADER`, but only for
 * `prunePacks` to decide what is worth keeping across an update; it is
 * never read to decide what is served.
 *
 * No DOM: the worker has none. Caches, `fetch` and reporting are passed in,
 * so tests/unit/verified-cache.test.mjs drives it with fakes.
 */
import { HASH_HEADER } from './offline-cache.ts';
import { Sha256 } from './sha256.ts';

/** One file of the build, as the table lists it. */
export interface ListedFile {
	/** The sha256 of the file's bytes as stored (decoded), 64 lowercase hex digits. */
	sha256: string;
	/** Its size in bytes, decoded. */
	size: number;
}

/**
 * The build's file table, as inlined into service-worker.js. Paths are
 * relative to the app's root, `''` being the page (index.html).
 */
export interface FileTable {
	/** The build's version (`$app/env`); a table of another build is refused. */
	version: string;
	/** What the worker precaches when it installs: offline.json's shell, and offline.json. */
	shell: readonly string[];
	/** Every file the worker may serve from a cache: shell, lazy and pack files. */
	files: ReadonlyMap<string, ListedFile>;
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Reads the inlined table (JSON: `{version, shell: [path], files: {path:
 * [sha256, size]}}`). Returns the table, or why there is none, in words
 * for the worker's console: the build's slot left as it was (a dev server,
 * or a build that skipped offline-manifest.mjs), JSON of another shape, or
 * another build's table.
 *
 * The slot's text is deliberately not known here: the build requires it to
 * appear exactly once in service-worker.js, and a copy in this module
 * would be a second one.
 */
export function parseFileTable(raw: string, version: string): { table: FileTable } | { problem: string } {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return { problem: 'this build has no file table (scripts/offline-manifest.mjs did not write one into service-worker.js)' };
	}
	if (typeof value !== 'object' || value === null) return { problem: 'the file table is not an object' };
	const t = value as { version?: unknown; shell?: unknown; files?: unknown };
	if (t.version !== version) return { problem: `the file table is build ${String(t.version)}'s, and this worker is build ${version}'s` };
	if (!Array.isArray(t.shell) || !t.shell.every((p) => typeof p === 'string')) return { problem: 'the file table has no shell list' };
	if (typeof t.files !== 'object' || t.files === null) return { problem: 'the file table has no files' };
	const files = new Map<string, ListedFile>();
	for (const [path, entry] of Object.entries(t.files)) {
		if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !HEX64.test(entry[0]) || typeof entry[1] !== 'number' || !Number.isSafeInteger(entry[1]) || entry[1] < 0) {
			return { problem: `the file table's entry for ${JSON.stringify(path)} is not [sha256, size]` };
		}
		files.set(path, { sha256: entry[0], size: entry[1] });
	}
	const unlisted = (t.shell as string[]).find((p) => !files.has(p));
	if (unlisted !== undefined) return { problem: `the file table's shell names ${JSON.stringify(unlisted)}, which it does not list` };
	return { table: { version, shell: t.shell as string[], files } };
}

/** A stream's bytes are not the ones the build lists. Its message names the path. */
export class IntegrityError extends Error {
	override name = 'IntegrityError';
}

/**
 * A pass-through stream that hashes what goes through it and, unless it
 * comes to exactly `file` (its size and sha256), runs `mismatch` and then
 * errors instead of ending. Too many bytes error at once, without waiting
 * for the end. Chunks are passed on unchanged and as they come, so a reader
 * sees progress; only the end, or the error, waits for the check.
 */
export function verifying(file: ListedFile, what: string, mismatch: () => Promise<void> | void): TransformStream<Uint8Array, Uint8Array> {
	const hash = new Sha256();
	let length = 0;
	const fail = async (controller: TransformStreamDefaultController<Uint8Array>, why: string) => {
		await mismatch();
		controller.error(new IntegrityError(`${what}: ${why}, not the bytes this build lists`));
	};
	return new TransformStream<Uint8Array, Uint8Array>({
		async transform(chunk, controller) {
			length += chunk.byteLength;
			if (length > file.size) return fail(controller, `more than ${file.size} bytes`);
			hash.update(chunk);
			controller.enqueue(chunk);
		},
		async flush(controller) {
			if (length !== file.size) return fail(controller, `${length} bytes instead of ${file.size}`);
			const sha256 = hash.hex();
			if (sha256 !== file.sha256) return fail(controller, `sha256 ${sha256.slice(0, 12)}…`);
		},
	});
}

/** The sha256 of some bytes, as lowercase hex, with the platform's digest. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	let out = '';
	for (const byte of digest) out += byte.toString(16).padStart(2, '0');
	return out;
}

/**
 * Content-Type by extension, the same table as deploy/worker.js's, which
 * is what the production host sends (a unit test keeps the two the same).
 * The page is HTML whatever its path.
 */
const TYPES: Readonly<Record<string, string>> = {
	html: 'text/html; charset=utf-8',
	js: 'text/javascript; charset=utf-8',
	mjs: 'text/javascript; charset=utf-8',
	css: 'text/css; charset=utf-8',
	json: 'application/json',
	webmanifest: 'application/manifest+json',
	wasm: 'application/wasm',
	svg: 'image/svg+xml',
	txt: 'text/plain; charset=utf-8',
	xml: 'application/xml',
	ttf: 'font/ttf',
	woff2: 'font/woff2',
	png: 'image/png',
	tar: 'application/x-tar',
	zip: 'application/zip',
};

/** The Content-Type a listed path is served with; octet-stream for an extension the table lacks. */
export function contentTypeOf(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	if (name === '') return TYPES['html']!;
	const dot = name.lastIndexOf('.');
	return (dot >= 0 ? TYPES[name.slice(dot + 1).toLowerCase()] : undefined) ?? 'application/octet-stream';
}

/** The part of a `Cache` this module uses. */
export interface CacheLike {
	match(request: string): Promise<Response | undefined>;
	put(request: string, response: Response): Promise<void>;
	delete(request: string): Promise<boolean>;
}

/** The pack cache as `prunePacks` walks it: a `CacheLike` that also lists what it holds. */
export interface PackCacheLike extends CacheLike {
	keys(): Promise<readonly { url: string }[]>;
}

export interface VerifiedCacheOptions {
	table: FileTable;
	/** Which cache holds a path: the packs cache for a pack file, this build's app cache for the rest. */
	cacheFor(path: string): Promise<CacheLike>;
	/** Whether a path is a pack file: streamed and checked as it goes, rather than read whole first. */
	isPack(path: string): boolean;
	/** A path as the URL its entry is stored under. */
	url(path: string): string;
	/** Says something went wrong (the worker's console). Called once per bad entry found. */
	report(message: string): void;
}

/**
 * The caches as the worker serves from and fills them, through the table.
 * Unlisted paths are neither served from a cache nor stored.
 */
export class VerifiedCache {
	/** Verified app files by path, for this worker's lifetime (see the module comment). */
	private readonly memo = new Map<string, Uint8Array<ArrayBuffer>>();
	private readonly options: VerifiedCacheOptions;

	constructor(options: VerifiedCacheOptions) {
		this.options = options;
	}

	/** The table's entry for a path, or undefined when the build does not list it. */
	listed(path: string): ListedFile | undefined {
		return this.options.table.files.get(path);
	}

	/**
	 * A response with this build's bytes for `path` from its cache, or null:
	 * the path is unlisted, not cached, or (for an app file) its entry is not
	 * what the build lists, in which case the entry has been deleted and
	 * reported. A pack file's response errors before its end if its entry
	 * turns out wrong, and the entry is deleted.
	 */
	async cached(path: string): Promise<Response | null> {
		const file = this.listed(path);
		if (!file) return null;
		const memo = this.memo.get(path);
		if (memo) return this.served(path, file, memo);
		const { cacheFor, isPack, url, report } = this.options;
		const cache = await cacheFor(path);
		const href = url(path);
		const entry = await cache.match(href);
		if (!entry) return null;
		if (isPack(path)) {
			if (!entry.body) {
				await this.drop(cache, href, `${path || 'index.html'}: the cached copy has no body`);
				return null;
			}
			const body = entry.body.pipeThrough(
				verifying(file, path, async () => {
					report(`${path}: the cached copy is not the bytes this build lists; deleted, so the next load fetches it again`);
					await cache.delete(href).catch(() => false);
				}),
			);
			return this.served(path, file, body);
		}
		const bytes = await entry
			.arrayBuffer()
			.then((b) => new Uint8Array(b))
			.catch(() => null);
		if (bytes && bytes.byteLength === file.size && (await sha256Hex(bytes)) === file.sha256) {
			this.memo.set(path, bytes);
			return this.served(path, file, bytes);
		}
		await this.drop(cache, href, `${path || 'index.html'}: the cached copy is not the bytes this build lists; deleted, and fetched from the network instead`);
		return null;
	}

	/**
	 * Stores a network response for a listed path, if its bytes are the
	 * build's. Resolves true when stored; false, after reporting, when the
	 * path is unlisted or the bytes differ (a host mid-deploy serving another
	 * build's file): then nothing is stored. Consumes `response`'s body, so
	 * pass a clone of what the page gets.
	 */
	async store(path: string, response: Response): Promise<boolean> {
		const file = this.listed(path);
		if (!file || !response.body) return false;
		const { cacheFor, isPack, url, report } = this.options;
		const cache = await cacheFor(path);
		const href = url(path);
		if (isPack(path)) {
			try {
				// The hash header is what `prunePacks` keeps an entry by when the
				// next build activates. Without it (as this branch first was),
				// every pack file cached on demand was dropped and downloaded
				// again by the next app update, whether or not it had changed.
				const headers = { 'Content-Type': contentTypeOf(path), 'Content-Length': String(file.size), [HASH_HEADER]: file.sha256 };
				await cache.put(href, new Response(response.body.pipeThrough(verifying(file, path, () => undefined)), { headers }));
				return true;
			} catch (e) {
				report(`${path}: not cached (${e instanceof Error ? e.message : String(e)})`);
				await cache.delete(href).catch(() => false);
				return false;
			}
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength !== file.size || (await sha256Hex(bytes)) !== file.sha256) {
			report(`${path || 'index.html'}: not cached, the network's copy is not the bytes this build lists (is the host mid-deploy?)`);
			return false;
		}
		await cache.put(href, this.served(path, file, bytes));
		this.memo.set(path, bytes);
		return true;
	}

	/**
	 * Empties the pack cache of what this build would not serve, when the
	 * build activates: every entry whose path the table does not list, or
	 * whose `HASH_HEADER` is not the sha256 the table lists for it. The
	 * header is the writer's word, so this only saves downloads (an entry
	 * kept is still checked byte for byte whenever it is served); an entry
	 * without one is dropped, since nothing says which build's it is. A
	 * 20-digit header is a build's from before full sha256s, kept while its
	 * prefix matches, so that update did not re-download every pack.
	 * `pathOf` gives a stored URL's path relative to the app's root, or null
	 * outside it. Resolves to the number of entries deleted.
	 */
	async prunePacks(cache: PackCacheLike, pathOf: (href: string) => string | null): Promise<number> {
		let deleted = 0;
		for (const request of await cache.keys()) {
			const path = pathOf(request.url);
			const sha256 = path === null ? undefined : this.listed(path)?.sha256;
			const header = (await cache.match(request.url))?.headers.get(HASH_HEADER) ?? '';
			const same = sha256 !== undefined && header !== '' && (header === sha256 || (header.length === 20 && sha256.startsWith(header)));
			if (!same && (await cache.delete(request.url))) deleted++;
		}
		return deleted;
	}

	private async drop(cache: CacheLike, href: string, message: string): Promise<void> {
		this.options.report(message);
		await cache.delete(href).catch(() => false);
	}

	/** A fresh 200 with the bytes and the headers the path gets; nothing comes from the cached entry's headers. */
	private served(path: string, file: ListedFile, body: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>): Response {
		return new Response(body, {
			status: 200,
			headers: { 'Content-Type': contentTypeOf(path), 'Content-Length': String(file.size), 'X-Content-Type-Options': 'nosniff' },
		});
	}
}
