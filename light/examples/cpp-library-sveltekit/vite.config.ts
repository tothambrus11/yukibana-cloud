// SvelteKit, built to static files (every page prerendered), and serving,
// which is the host's part: the page cross-origin isolated (a program
// reading input needs it) and the packs at /packs/, from $PACKS or the ones
// Light's app has installed (light/app/static/packs). Nothing here is about
// C++ or the library.
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defaultClientConditions, defaultServerConditions, defineConfig, type Plugin } from 'vite';

const PACKS = resolve(process.env['PACKS'] ?? fileURLToPath(new URL('../../app/static/packs/', import.meta.url))) + sep;
const ISOLATED = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
const TYPES: Readonly<Record<string, string>> = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };

const servePacks = (): Plugin => {
	const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
		for (const [name, value] of Object.entries(ISOLATED)) response.setHeader(name, value);
		const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
		if (!path.startsWith('/packs/')) return next();
		const file = normalize(join(PACKS, path.slice('/packs/'.length)));
		if (!file.startsWith(PACKS) || !existsSync(file) || !statSync(file).isFile()) {
			response.statusCode = 404;
			response.end();
			return;
		}
		response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
		createReadStream(file).pipe(response);
	};
	return { name: 'serve-packs', configureServer: (s) => void s.middlewares.use(middleware), configurePreviewServer: (s) => void s.middlewares.use(middleware) };
};

/** The @yukibana packages are `link:` links to light/modules, read from their sources, in the browser and in the prerender alike. */
const SOURCE = '@yukibana/source';

export default defineConfig({
	plugins: [servePacks(), sveltekit({ adapter: adapter({ pages: 'build', assets: 'build' }) })],
	resolve: { conditions: [SOURCE, ...defaultClientConditions] },
	ssr: { resolve: { conditions: [SOURCE, ...defaultServerConditions] } },
	worker: { format: 'es' },
	server: { fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../../modules', import.meta.url))] } },
});
