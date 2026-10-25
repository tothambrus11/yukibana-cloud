/**
 * Makes the app work offline and cross-origin isolated.
 *
 * Offline: when this worker installs, it precaches the app shell, the files
 * the app needs to start, as the build's file table lists them (written
 * into this script at build time, scripts/offline-manifest.mjs).
 * Everything else the table lists is cached the first time it is fetched:
 * the app's lazy files (Monaco's HTML, CSS and JSON services and their
 * workers, grammars, schemas) in this build's app cache, a language pack's
 * files in the pack cache. The page's Download everything fills the same
 * caches ahead of time (offline.svelte.ts). The cache names and
 * offline.json's shape are in src/lib/offline-cache.ts.
 *
 * Integrity: nothing comes out of a cache unless its bytes are the ones the
 * table lists, navigations included, because programs run on this origin
 * and can write its caches (src/lib/verified-cache.ts, D50). Until this
 * build the page was served from the app cache unchecked, and a program
 * could replace it for every later visit.
 *
 * Until this build, the install precached every file of `static/`, which
 * includes every pack and its .br and .gz copies: a first visit downloaded
 * some 400 MB in the background. A path relative to the root never starts
 * with `/packs/`, which is what the filter looked for.
 *
 * Updates: a new build's worker installs, then waits; the page offers a
 * reload (pwa.ts), which sends `skip-waiting`. Activating drops the old
 * app cache, and the pack files the new build changed. Pages come from
 * the worker's own cache, so a page never runs against another build's
 * packs; a page of another build than its worker (one served by a worker
 * from before this rule) switches at once (pwa.ts).
 *
 * Isolation: some language servers block on a `SharedArrayBuffer`, which a
 * page may only use when it is served with COOP and COEP headers. A static
 * host often cannot send headers, so every same-origin response this worker
 * hands out carries them. Everything the app loads is same-origin, so
 * `require-corp` costs nothing.
 */
import { version } from '$app/env';
import { self as sw } from '$app/service-worker';
import { appCacheName, DIRECT_HEADER, isPackPath, PACKS_CACHE } from '../lib/offline-cache';
import { parseFileTable, VerifiedCache } from '../lib/verified-cache';

const APP = appCacheName(version);
/** A path relative to the app's root (this worker's scope) as a URL. */
const url = (path: string) => new URL(path.replace(/^\//, ''), sw.registration.scope).href;
/** A same-origin URL as a path relative to the app's root, or null outside the scope. */
const pathOf = (href: string) => (href.startsWith(sw.registration.scope) ? href.slice(sw.registration.scope.length).split(/[?#]/)[0]! : null);

/**
 * The build's file table, the one thing this worker trusts about what it
 * may serve (verified-cache.ts says why). The build replaces the quoted
 * slot below with the table's JSON as a string literal
 * (scripts/offline-manifest.mjs, which fails unless it finds the slot
 * exactly once). This must stay the only place the slot's text appears in
 * the worker. Without a table (the dev server, or a build that skipped
 * that script) nothing is served from a cache and nothing is cached: the
 * app works online and says why it does not offline.
 */
const parsed = parseFileTable('__YUKIBANA_FILE_TABLE__', version);
if ('problem' in parsed && !import.meta.env.DEV) console.error(`service worker: ${parsed.problem}; nothing is served from the caches.`);
const verified =
	'table' in parsed
		? new VerifiedCache({
				table: parsed.table,
				cacheFor: (path) => caches.open(isPackPath(path) ? PACKS_CACHE : APP),
				isPack: isPackPath,
				url,
				report: (message) => console.warn(`service worker: ${message}`),
			})
		: null;

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			if (!verified || !('table' in parsed)) return;
			// Hashed files are the same bytes whenever fetched, so the copy the
			// page just downloaded (in the HTTP cache) will do. A shell file
			// whose bytes are not the table's fails the install by name: a host
			// mid-deploy serves another build's file, and this build installs
			// on a later visit instead of starting with a hole in its shell.
			const failed: string[] = [];
			await Promise.all(
				parsed.table.shell.map(async (p) => {
					const response = await fetch(new Request(url(p), { cache: p.startsWith('_app/immutable/') ? 'force-cache' : 'no-cache' }));
					if (!response.ok || !(await verified.store(p, response))) failed.push(`${p || 'index.html'} (HTTP ${response.status})`);
				}),
			);
			if (failed.length) throw new Error(`service worker: not installed, ${failed.length} shell file(s) are not this build's: ${failed.slice(0, 3).join(', ')}`);
		})(),
		// No skipWaiting here: a new build waits until the page asks (pwa.ts),
		// so an open tab never loses the cached files of the build it runs.
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			await Promise.all((await caches.keys()).filter((k) => k !== APP && k !== PACKS_CACHE).map((k) => caches.delete(k)));
			// Keep only the pack files this build lists with the same hash
			// (verified-cache.ts's prunePacks says why that is safe).
			if (verified) {
				const deleted = await verified.prunePacks(await caches.open(PACKS_CACHE), pathOf);
				if (deleted) console.info(`service worker: dropped ${deleted} cached pack file(s) this build does not list with the same sha256`);
			}
			await sw.clients.claim();
		})(),
	);
});

sw.addEventListener('message', (event) => {
	if (event.data === 'skip-waiting') void sw.skipWaiting();
	// Which build this worker is (pwa.ts compares it with the page's; goes with switchIfStale).
	else if (event.data === 'version') event.ports[0]?.postMessage(version);
});

/** A copy of a response with the isolation headers added. Opaque and error responses pass unchanged. */
function isolated(response: Response): Response {
	if (response.type === 'opaque' || response.type === 'opaqueredirect' || response.status === 0) return response;
	const headers = new Headers(response.headers);
	headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
	headers.set('Cross-Origin-Resource-Policy', 'same-origin');
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function respond(request: Request, event: FetchEvent): Promise<Response> {
	const path = pathOf(request.url);
	// Pages: this worker's own build, from its cache, so the page and the
	// pack files this worker serves are one build. It used to be the network
	// first: after a deploy, the page was the new build while the old worker,
	// still in control until the reload is accepted, served the packs it had
	// cached, and a new page's C++ Test found no doctest headers in the old
	// sysroot. A new build reaches the page through the update prompt. In
	// development the page is always fresh. A cached page that is not this
	// build's bytes is a miss (verified-cache.ts): the network's copy is
	// served, and cached again when it is the build's.
	if (request.mode === 'navigate') {
		const page = path !== null && verified?.listed(path) && !isPackPath(path) ? path : '';
		const own = import.meta.env.DEV ? null : await verified?.cached(page);
		if (own) return own;
		try {
			const response = await fetch(request);
			if (verified && path === page && response.status === 200) event.waitUntil(verified.store(page, response.clone()));
			return response;
		} catch {
			return Response.error();
		}
	}
	if (path === null || !verified) return fetch(request);
	// The page caches this one itself (Download everything).
	if (request.headers.has(DIRECT_HEADER)) return fetch(request);
	const cached = await verified.cached(path);
	if (cached) return cached;
	const response = await fetch(request);
	// Cache what the build lists (not, say, a preview's requests); hand the
	// response over at once, so a pack sees its download progress, and let
	// the checked copy go into the cache alongside.
	if (response.status === 200 && verified.listed(path)) event.waitUntil(verified.store(path, response.clone()));
	return response;
}

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET' || new URL(request.url).origin !== sw.location.origin) return;
	event.respondWith(respond(request, event).then(isolated));
});
