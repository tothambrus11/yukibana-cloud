// Builds the example as another site would: three pages (an index and one
// page per editor), the packs' language servers left unbundled and served
// from the packs' own URLs. In dev and preview the packs are $PACKS, or the
// ones Light's app has installed (light/app/static/packs), under /packs/.
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig, type Plugin } from 'vite';

/** Where the packs are on disk, ending in the separator: $PACKS, or Light's installed packs. */
const PACKS = ((dir: string): string => (dir.endsWith(sep) ? dir : dir + sep))(resolve(process.env['PACKS'] ?? fileURLToPath(new URL('../../app/static/packs/', import.meta.url))));

/**
 * Cross-origin isolation: some language servers block on a
 * SharedArrayBuffer while they read their input, which only an isolated
 * page has.
 */
const isolated = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

/** The content types of the packs' files a browser checks. */
const TYPES: Readonly<Record<string, string>> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };

/** Sends {@link isolated} with every response, and serves /packs/ from {@link PACKS}, in dev and preview alike. */
const isolatedWithPacks = (): Plugin => {
	const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
		for (const [name, value] of Object.entries(isolated)) response.setHeader(name, value);
		const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
		if (!path.startsWith('/packs/')) return next();
		const file = normalize(join(PACKS, path.slice('/packs/'.length)));
		if (!file.startsWith(PACKS) || !existsSync(file) || !statSync(file).isFile()) {
			response.statusCode = 404;
			response.end();
			return;
		}
		response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
		response.end(readFileSync(file));
	};
	return {
		name: 'isolated-with-packs',
		configureServer: (server) => void server.middlewares.use(middleware),
		configurePreviewServer: (server) => void server.middlewares.use(middleware),
	};
};

const page = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
	plugins: [isolatedWithPacks()],
	// The @yukibana packages are `file:` links to light/modules, so the
	// pages bundle their sources, which this condition names (their
	// package.json); without it a link resolves to their dist/, which only
	// light/modules/build.mjs writes.
	resolve: { conditions: ['@yukibana/source', ...defaultClientConditions] },
	worker: { format: 'es' },
	build: { rolldownOptions: { input: { index: page('index.html'), monaco: page('monaco.html'), textarea: page('textarea.html') } } },
	server: {
		// The packages are links to light/modules.
		fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../../modules', import.meta.url))] },
	},
});
