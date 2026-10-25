// The Worker in front of Yukibana Light's static assets (wrangler.jsonc).
// A static host would do, but for three things serve.py does too:
//
// * Cross-origin isolation (COOP, COEP, CORP) on every response, so language
//   servers that need SharedArrayBuffer start on the first load rather than
//   after the service worker's reload.
// * The brotli copy of a file. The packs' build scripts and the app's
//   compress.mjs write a .br beside each big file, compressed harder than
//   the edge would; the response is that copy with Content-Encoding: br, and
//   the edge decompresses or recompresses it for the rare client that does
//   not accept br. It is also what makes the packs fit: an asset is at most
//   25 MiB, and several raw pack files are larger, so prepare.mjs leaves
//   such a file out when its .br is within the limit, and this is the only
//   way it is served.
// * The few files whose .br is still too big for an asset (the Haskell
//   pack's GHC root file system, 35 MiB as brotli) come from the R2 bucket
//   BLOBS, under the key blobs.json names for their path (prepare.mjs).
// * No caching of the pages that decide what everything else is
//   (index.html, the service worker, the offline manifest), as pack paths are
//   not content-hashed.

const TYPES = {
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

/** The Content-Type of a path by its extension; octet-stream for the rest. */
const typeOf = (path) => TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

/** Whether a path's response must be revalidated every time. */
const uncached = (path) => path.endsWith('/') || path.endsWith('.html') || path.endsWith('/service-worker.js') || path.endsWith('/offline.json');

/** Adds the headers every response gets. */
function finish(response, path) {
	const headers = new Headers(response.headers);
	headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
	headers.set('Cross-Origin-Resource-Policy', 'same-origin');
	headers.set('X-Content-Type-Options', 'nosniff');
	if (uncached(path)) headers.set('Cache-Control', 'no-cache');
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers, encodeBody: 'manual' });
}

/** @type {Promise<Record<string, { key: string, encoding: string | null }>> | null} blobs.json, read once per isolate. */
let blobs = null;

/** The response for a path blobs.json maps to an R2 object, or null. */
async function blob(request, env, path) {
	blobs ??= env.ASSETS.fetch(new URL('/blobs.json', request.url)).then((r) => (r.ok ? r.json() : {}));
	const entry = (await blobs)[path];
	if (!entry) return null;
	const object = await env.BLOBS.get(entry.key, { onlyIf: request.headers });
	if (!object) return new Response(`${path}: its blob ${entry.key} is missing from the bucket`, { status: 500 });
	const headers = new Headers({ 'Content-Type': typeOf(path), ETag: object.httpEtag });
	if (entry.encoding) headers.set('Content-Encoding', entry.encoding);
	// Without a body the precondition held: the client's copy is current.
	if (!('body' in object)) return new Response(null, { status: 304, headers });
	headers.set('Content-Length', String(object.size));
	return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

export default {
	/** @param {Request} request @param {{ ASSETS: Fetcher, BLOBS: R2Bucket }} env */
	async fetch(request, env) {
		const url = new URL(request.url);
		const path = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
		if (request.method === 'GET' || request.method === 'HEAD') {
			const fromBucket = await blob(request, env, path);
			if (fromBucket) return finish(fromBucket, url.pathname);
		}
		if ((request.method === 'GET' || request.method === 'HEAD') && !path.endsWith('.br') && !path.endsWith('.gz')) {
			const compressed = await env.ASSETS.fetch(new Request(new URL(`${path}.br`, url), { method: request.method, headers: request.headers }));
			if (compressed.status === 200 || compressed.status === 304) {
				const headers = new Headers(compressed.headers);
				headers.set('Content-Type', typeOf(path));
				headers.set('Content-Encoding', 'br');
				headers.append('Vary', 'Accept-Encoding');
				return finish(new Response(compressed.body, { status: compressed.status, headers }), url.pathname);
			}
		}
		return finish(await env.ASSETS.fetch(request), url.pathname);
	},
};
