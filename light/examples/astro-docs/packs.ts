/**
 * Where this example's packs come from, in Node: the dev server serves
 * them under /packs/ (astro.config.ts), and `astro preview`, which serves
 * dist/ as it is and takes no plugin of the site's, finds them through a
 * link dist/packs that `npm run preview` and test.mjs make (`node
 * packs.ts link`). A site in production copies or uploads the packs it
 * uses to /packs/ beside its pages instead (README.md, "Hosting the
 * packs"): they are static files, never bundled.
 *
 * The packs are Light's installed ones (light/app/static/packs), or the
 * directory $PACKS names.
 */
import { existsSync, lstatSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The directory holding one directory per pack (`cpp/`, `python/`, …), absolute, ending in the separator. */
export const PACKS: string = (() => {
	const dir = resolve(process.env['PACKS'] ?? fileURLToPath(new URL('../../app/static/packs/', import.meta.url)));
	return dir.endsWith(sep) ? dir : dir + sep;
})();

/** Whether the pack `id` is installed: its runner.js is there. */
export function installed(id: string): boolean {
	return existsSync(join(PACKS, id, 'runner.js'));
}

/**
 * Headers every response of the site carries, in dev and in preview: a
 * cross-origin isolated page, so a program can read the input a
 * playground gives it (stdin is a SharedArrayBuffer, src/lib/host.ts), and
 * no other site may embed the site's files.
 */
export const ISOLATED: Readonly<Record<string, string>> = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Resource-Policy': 'same-origin',
};

/** The content types of the packs' files a browser checks. */
const TYPES: Readonly<Record<string, string>> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };

/**
 * A connect middleware serving `/packs/<file>` from {@link PACKS} and
 * passing every other request on; a path outside the packs, or no such
 * file, is a 404. For the dev server only.
 */
export function servePacks(request: IncomingMessage, response: ServerResponse, next: () => void): void {
	const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
	if (!path.startsWith('/packs/')) return next();
	const file = normalize(join(PACKS, path.slice('/packs/'.length)));
	if (!file.startsWith(PACKS) || !existsSync(file) || !statSync(file).isFile()) {
		response.statusCode = 404;
		response.end();
		return;
	}
	for (const [name, value] of Object.entries(ISOLATED)) response.setHeader(name, value);
	response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
	response.end(readFileSync(file));
}

/**
 * Makes `<dist>/packs` a symbolic link to {@link PACKS}, replacing a link
 * there, so that `astro preview` serves the packs at /packs/. Throws when
 * `dist` has no build, or when `<dist>/packs` is a real directory (which
 * this never makes, and does not delete).
 */
export function linkPacks(dist: string): void {
	if (!existsSync(join(dist, 'index.html'))) throw new Error(`No build in ${dist}: run npm run build first.`);
	const link = join(dist, 'packs');
	if (existsSync(link) || lstatExists(link)) {
		if (!lstatSync(link).isSymbolicLink()) throw new Error(`${link} is not a link this script made; leaving it.`);
		rmSync(link);
	}
	symlinkSync(PACKS, link, 'dir');
}

/** Whether `path` exists as a link, even a dangling one. */
function lstatExists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === 'link') {
	linkPacks(fileURLToPath(new URL('dist/', import.meta.url)));
	console.log(`dist/packs -> ${PACKS}`);
}
