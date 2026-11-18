// What a registry answers for a path: which kind of file it is, and the
// headers that kind is served with (REGISTRY-DESIGN.md 4.1 and 4.3).
//
// Pure, with no platform: the Worker that serves yukibana.run (worker.js)
// asks it for every request, and a checker of someone else's registry can
// ask it what a response should have carried, so the official registry and
// the checker cannot disagree. Tested as a table (rules.test.mjs).
//
// The paths of a registry:
//
//   /frame/v<N>/frame.html        the runner frame: embedded by other sites,
//                                 never cached, so a fix reaches every browser
//   /frame/v<N>/<anything else>   the frame's own scripts
//   /packs/sha256-<hex>/pack.json, files.json
//                                 what a page reads to ask "do you have this
//                                 build": readable from any site
//   /packs/sha256-<hex>/<file>    a build's files: named by content, so
//                                 immutable
//   /packs/<name>/<file>          a pack by name, the layout before builds
//                                 were named by content (PLAN.md, stage 1):
//                                 the same file may change, so revalidated
//   /index.json                   what the registry holds
//
// Everything else is not a file of a registry.

/** A build's directory name: `sha256-` and the 64 hex digits of its pack.json's hash. */
export const DIGEST = /^sha256-[0-9a-f]{64}$/;
/** A pack's name as a directory: lowercase letters, digits, `.`, `_` and `-`, starting with a letter or digit. */
export const NAME = /^[a-z0-9][a-z0-9._-]*$/;
/** A frame protocol's directory: `v` and a number without a leading zero. */
const FRAME_VERSION = /^v[1-9][0-9]*$/;
/** The small files a page on another site reads to learn what a build is. */
const PROBES = new Set(['pack.json', 'files.json']);

/**
 * What the registry's own pages and every worker started from it may do.
 *
 * - Scripts: the origin's own, `blob:` and `data:` (a runner loads the
 *   program it was given as one), and evaluation, which WebAssembly and the
 *   interpreters among the packs need. No script from another origin.
 * - Network: the origin itself, and `blob:` and `data:` URLs. A program can
 *   therefore reach nothing else: not another site with the visitor's
 *   cookies for it, not the visitor's intranet, and nowhere to post what it
 *   read in its run (REGISTRY-DESIGN.md 4.5). An operator who wants programs
 *   on the network loosens `connect-src` in their own registry, knowingly.
 *
 * A worker started from a URL takes the policy of its own response, which is
 * why every pack file carries this and not the frame page alone.
 */
export const CONTENT_SECURITY_POLICY = "default-src 'self' blob: data:; script-src 'self' blob: data: 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self' blob: data:";

/**
 * The types a file is served with, by its extension; every other extension
 * is bytes, so the frame page is the one document a registry serves and no
 * pack can put another on its origin. It has no prototype: the extension
 * comes from a request, and `x.constructor` must find nothing here.
 */
const TYPES = { __proto__: null, js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', wasm: 'application/wasm', json: 'application/json' };

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

/** The extension of a path's last segment, lowercase, or '' when it has none. */
function extensionOf(path) {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * A path's segments when every one of them is a plain name, else null: no
 * empty segment, no `.` or `..`, no backslash, no `%`, no control character,
 * nothing that is not printable ASCII, and no more than 1024 characters in
 * all (a build's file has at most 512, and a bucket takes no longer key). A
 * registry's files have none of these, so a request with one is not for a
 * file, and is never turned into a key.
 *
 * This is a URL's path, which is `/`-separated on every platform, and the
 * one place it is taken apart; nothing here is a path of a file system.
 */
function segmentsOf(pathname) {
	if (!pathname.startsWith('/') || pathname.length > 1024) return null;
	const segments = pathname.slice(1).split('/');
	for (const segment of segments) {
		if (segment === '' || segment === '.' || segment === '..' || !/^[\x21-\x7e]+$/.test(segment) || segment.includes('\\') || segment.includes('%')) return null;
	}
	return segments;
}

/**
 * @typedef {'frame-page' | 'frame-asset' | 'probe' | 'build-file' | 'named-file' | 'index'} Kind
 * @typedef {object} Rule
 * @property {Kind} kind what the path is
 * @property {string} key the file's name in the registry's store: the path without its leading slash
 * @property {Record<string, string>} headers the headers a response with the file carries, besides those of the body (length, ETag, encoding). An answer that the file is missing carries {@link plainHeaders} and, of these, what makes it readable from another site.
 */

/** The headers every response of a registry carries. */
const always = () => ({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });

/** The headers of a pack's file and of the frame's own scripts: a worker script takes its isolation and its policy from these. */
const fileHeaders = (path, cache) => ({
	...always(),
	'Content-Type': TYPES[extensionOf(path)] ?? 'application/octet-stream',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Resource-Policy': 'same-origin',
	'Content-Security-Policy': CONTENT_SECURITY_POLICY,
	'Cache-Control': cache,
});

/** What makes a response readable by a page on another site. */
const READABLE = { 'Access-Control-Allow-Origin': '*' };

/**
 * Returns what `pathname` (a URL's path, percent-decoded or not: a file of a
 * registry has nothing to decode) is in a registry, with its key and its
 * headers, or null when it is not a file of a registry.
 *
 * The frame page may be embedded by any site (`frame-ancestors *`), which
 * is what a public registry is for. A registry meant for one institution
 * names its origins there, in its own server's configuration.
 *
 * Invariant: the headers never include `Set-Cookie`, for any input. A
 * registry holds no credential (REGISTRY-DESIGN.md 4.3).
 *
 * @param {string} pathname
 * @returns {Rule | null}
 */
export function ruleFor(pathname) {
	const segments = segmentsOf(pathname);
	if (segments === null) return null;
	const key = segments.join('/');
	const [top, second, ...rest] = segments;

	if (top === 'index.json' && segments.length === 1) {
		return { kind: 'index', key, headers: { ...always(), ...READABLE, 'Content-Type': 'application/json', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': REVALIDATE } };
	}

	if (top === 'frame' && second !== undefined && FRAME_VERSION.test(second) && rest.length > 0) {
		if (rest.length === 1 && rest[0] === 'frame.html') {
			return {
				kind: 'frame-page',
				key,
				headers: {
					...always(),
					'Content-Type': 'text/html; charset=utf-8',
					'Cross-Origin-Embedder-Policy': 'require-corp',
					// Embedded by pages of other sites, which is what a registry is for.
					'Cross-Origin-Resource-Policy': 'cross-origin',
					'Content-Security-Policy': `${CONTENT_SECURITY_POLICY}; frame-ancestors *`,
					// Never cached: a fix to the frame must reach every browser at once.
					'Cache-Control': REVALIDATE,
				},
			};
		}
		// The page that names them is never cached, and names them by content once they are built with hashed names; until then, revalidated.
		return { kind: 'frame-asset', key, headers: fileHeaders(key, REVALIDATE) };
	}

	if (top === 'packs' && second !== undefined && rest.length > 0) {
		if (DIGEST.test(second)) {
			if (rest.length === 1 && PROBES.has(rest[0])) {
				return { kind: 'probe', key, headers: { ...fileHeaders(key, IMMUTABLE), ...READABLE, 'Cross-Origin-Resource-Policy': 'cross-origin' } };
			}
			return { kind: 'build-file', key, headers: fileHeaders(key, IMMUTABLE) };
		}
		if (NAME.test(second)) return { kind: 'named-file', key, headers: fileHeaders(key, REVALIDATE) };
	}
	return null;
}

/**
 * The headers of an answer that is not a file: a refusal, or a path that is
 * no file of a registry. Never cached, never a document.
 */
export const plainHeaders = () => ({ ...always(), 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });

/**
 * Why a request is refused before any file is looked for, as a status and a
 * sentence, or null when it may be answered.
 *
 * - Only `GET` and `HEAD`: a registry is read, never written, through HTTP.
 * - Not a service worker's script: nothing may install one on the origin
 *   where programs run, where it would serve every later visitor
 *   (REGISTRY-DESIGN.md 4.3). A browser marks the fetch of a script it is
 *   registering with `Service-Worker: script`.
 *
 * @param {string} method
 * @param {(name: string) => string | null} header returns a request header's value, by lowercase name
 * @returns {{ status: number, reason: string, allow?: string } | null}
 */
export function refusal(method, header) {
	if (method !== 'GET' && method !== 'HEAD') return { status: 405, reason: 'A registry answers GET and HEAD only.', allow: 'GET, HEAD' };
	if (header('service-worker') !== null) return { status: 403, reason: 'A registry serves no service worker.' };
	return null;
}
