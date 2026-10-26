/**
 * What the service worker and the page agree on about the offline caches:
 * the names of the caches, the shape of `offline.json` (written at build
 * time by scripts/offline-manifest.mjs) and how a response is stored. Both
 * the worker (src/service-worker) and the page (offline.svelte.ts) import
 * this, so neither can drift from the other. No DOM: the worker has none.
 */

/** One file the app can fetch, by its path relative to the app's root (`''` is the page). */
export interface OfflineFile {
	path: string;
	/** Bytes on disk, uncompressed: what a cache stores. */
	size: number;
	/** Bytes over the network: the brotli sibling's size when there is one. */
	transfer: number;
	/**
	 * The sha256 of the bytes as stored, 64 lowercase hex digits, for every
	 * file. The page checks a download against it (offline.svelte.ts). The
	 * service worker does not read it from here: this file is fetched like
	 * any other and could be rewritten in a cache, so the worker checks
	 * against its own inlined table (verified-cache.ts). A build from before
	 * that had 20 digits, for pack files only.
	 */
	hash?: string;
}

/** `offline.json`, the build's list of every file it can serve. */
export interface OfflineManifest {
	/** The build's version, as `$app/env` has it; the service worker of another build ignores this file. */
	version: string;
	/** What the app needs to start: precached when the service worker installs. */
	shell: OfflineFile[];
	/** App files fetched only when a language needs them (Monaco's language services, grammars, schemas). */
	lazy: OfflineFile[];
	/** Each pack's files, by pack directory. */
	packs: Record<string, OfflineFile[]>;
}

/** Where the manifest is, relative to the app's root. */
export const MANIFEST_PATH = 'offline.json';

/**
 * The cache of one build's app files, shell and lazy. A new build gets a
 * new one and the old one is dropped when it activates: its file names are
 * content hashed, so nothing in it could be reused anyway.
 */
export const appCacheName = (version: string): string => `app-${version}`;

/**
 * The cache of pack files, kept across builds: a pack file is hundreds of
 * megabytes at worst, and most app updates change none of them. A new build
 * removes only the entries whose hash it does not list (see `HASH_HEADER`).
 * Before this, each build had its own `packs-<version>` cache, and every
 * update threw every downloaded language away. What is kept is still
 * checked byte for byte whenever it is served.
 */
export const PACKS_CACHE = 'packs';

/**
 * The header a cached pack file carries its manifest hash in. It is the
 * writer's word, never evidence: a new build uses it only to decide which
 * pack entries are worth keeping, and every byte served is checked against
 * the build's table regardless (verified-cache.ts). Until SW1 it was what
 * decided whether a cached pack file was served.
 */
export const HASH_HEADER = 'X-Yukibana-Hash';

/**
 * Sent by the page on a request it caches itself (Download everything), so
 * the service worker passes it to the network instead of caching a second
 * copy: the page needs the bytes as they arrive, for its progress bar.
 */
export const DIRECT_HEADER = 'X-Yukibana-Direct';

/** Whether a path (relative to the app's root) is a pack file. */
export const isPackPath = (path: string): boolean => path.startsWith('packs/');

/**
 * A response as it goes into a cache: the body as fetched, already decoded,
 * so without the Content-Encoding, Content-Length and Vary of the encoded
 * bytes. A pack file (`file`, its manifest entry) also gets its hash and,
 * as Content-Length, its decoded size, which a pack's download progress
 * reads as the total.
 */
export function storable(response: Response, file: OfflineFile | undefined): Response {
	const headers = new Headers(response.headers);
	headers.delete('Content-Encoding');
	headers.delete('Content-Length');
	headers.delete('Vary');
	if (file?.hash) {
		headers.set(HASH_HEADER, file.hash);
		headers.set('Content-Length', String(file.size));
	}
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * The largest file stored as one cache entry. Chromium refuses to put a
 * single Cache Storage entry of 256 MiB or more ("Failed to execute 'put'
 * on 'Cache': Unexpected internal error"), whatever the quota: haskell's
 * rootfs.tar, 257 MiB, could not be made available offline. A bigger file
 * is stored as consecutive parts of `PART_SIZE` bytes. Files up to this
 * size keep their one entry, so nothing already cached is downloaded again.
 */
export const WHOLE_LIMIT = 192 * 1024 * 1024;

/** The size of each part of a file stored in parts; the last part has the rest. */
export const PART_SIZE = 128 * 1024 * 1024;

/** The URLs a file of `size` bytes is stored under: `href` alone, or one per part (`href?part=0`, …). */
export function storedHrefs(href: string, size: number): string[] {
	if (size <= WHOLE_LIMIT) return [href];
	return Array.from({ length: Math.ceil(size / PART_SIZE) }, (_, i) => `${href}?part=${i}`);
}

/** The part of a `Cache` the stored-file helpers use. */
export interface PartCache {
	match(request: string): Promise<Response | undefined>;
	put(request: string, response: Response): Promise<void>;
	delete(request: string): Promise<boolean>;
}

/**
 * Stores `body`, a file of `size` bytes, under `href`, in parts if it is
 * bigger than `WHOLE_LIMIT`, each part with `headers` (a part's own
 * Content-Length replaces any given). Rejects if the body errors (a failed
 * integrity check does so at its end) or a put fails, after deleting
 * whatever parts were stored, so a file is either all there or not at all.
 */
export async function putStored(cache: PartCache, href: string, size: number, body: ReadableStream<Uint8Array>, headers: HeadersInit): Promise<void> {
	const hrefs = storedHrefs(href, size);
	if (hrefs.length === 1) {
		await cache.put(href, new Response(body, { headers }));
		return;
	}
	const reader = body.getReader();
	let rest: Uint8Array | null = null;
	try {
		for (const [i, part] of hrefs.entries()) {
			const length = Math.min(PART_SIZE, size - i * PART_SIZE);
			let left = length;
			const stream = new ReadableStream<Uint8Array>({
				async pull(controller) {
					if (left === 0) return controller.close();
					let chunk = rest;
					rest = null;
					if (!chunk) {
						const r = await reader.read();
						// A short body: the integrity check errors the stream before this.
						if (r.done) return controller.error(new Error(`${href}: ended ${left} bytes before part ${i} was complete`));
						chunk = r.value;
					}
					if (chunk.byteLength > left) {
						rest = chunk.subarray(left);
						chunk = chunk.subarray(0, left);
					}
					left -= chunk.byteLength;
					controller.enqueue(chunk);
				},
			});
			const own = new Headers(headers);
			own.set('Content-Length', String(length));
			await cache.put(part, new Response(stream, { headers: own }));
		}
		// The last part ends at `size`; reading on lets the integrity check see the end and verify.
		const end = await reader.read();
		if (!end.done || rest) throw new Error(`${href}: more than ${size} bytes`);
	} catch (e) {
		await reader.cancel().catch(() => undefined);
		await deleteStored(cache, href, size);
		throw e;
	}
}

/**
 * The stored copy of a file of `size` bytes under `href`, its parts read
 * one after another as one body, with the first part's headers; undefined
 * when any part is missing.
 */
export async function matchStored(cache: PartCache, href: string, size: number): Promise<Response | undefined> {
	const hrefs = storedHrefs(href, size);
	if (hrefs.length === 1) return cache.match(href);
	const first = await cache.match(hrefs[0]!);
	if (!first?.body) return undefined;
	for (const part of hrefs.slice(1)) if (!(await cache.match(part))) return undefined;
	let index = 0;
	let reader: ReadableStreamDefaultReader<Uint8Array> | null = first.body.getReader();
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			for (;;) {
				if (!reader) {
					index++;
					if (index >= hrefs.length) return controller.close();
					const next = (await cache.match(hrefs[index]!))?.body;
					if (!next) return controller.error(new Error(`${href}: part ${index} is gone from the cache`));
					reader = next.getReader();
				}
				const r = await reader.read();
				if (!r.done) return controller.enqueue(r.value);
				reader = null;
			}
		},
		cancel(reason) {
			return reader?.cancel(reason);
		},
	});
	return new Response(body, { headers: first.headers });
}

/** Deletes every entry a file of `size` bytes under `href` is stored as; true if any was there. */
export async function deleteStored(cache: PartCache, href: string, size: number): Promise<boolean> {
	const done = await Promise.all(storedHrefs(href, size).map((h) => cache.delete(h).catch(() => false)));
	return done.some(Boolean);
}

/** Narrows parsed `offline.json` to its shape; anything else is not a manifest. */
export function isOfflineManifest(value: unknown): value is OfflineManifest {
	const isFiles = (files: unknown): files is OfflineFile[] =>
		Array.isArray(files) && files.every((f: unknown) => typeof f === 'object' && f !== null && typeof (f as OfflineFile).path === 'string' && typeof (f as OfflineFile).size === 'number' && typeof (f as OfflineFile).transfer === 'number');
	if (typeof value !== 'object' || value === null) return false;
	const m = value as Partial<OfflineManifest>;
	return typeof m.version === 'string' && isFiles(m.shell) && isFiles(m.lazy) && typeof m.packs === 'object' && m.packs !== null && Object.values(m.packs).every(isFiles);
}
