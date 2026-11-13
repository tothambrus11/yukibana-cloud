// Builds the article as another site would: one page in React, whose
// editors (Monaco), compiler output views' and debugger's code are chunks of
// their own loaded on use, and the packs' workers left unbundled, served
// from the packs' own URLs. In dev and preview the packs are the ones
// Light's app has installed (light/app/static/packs), or $PACKS, under
// /packs/; a real site serves them as static files (README.md, "Hosting
// the packs").
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig, type Plugin } from 'vite';

/** Where the packs are on disk: $PACKS, or Light's installed packs; dev and preview serve them under /packs/. */
const PACKS = resolve(process.env['PACKS'] ?? fileURLToPath(new URL('../../app/static/packs/', import.meta.url)));

/**
 * Cross-origin isolation: the debugger's channel and a program's standard
 * input are SharedArrayBuffers, which a page has only when it is isolated.
 * Every response of the page carries both headers (README.md, "Cross-origin
 * isolation").
 */
const ISOLATED: Readonly<Record<string, string>> = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

/** The content types of the packs' files a browser checks: a module worker must be JavaScript, a streamed module wasm. */
const TYPES: Readonly<Record<string, string>> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.tar': 'application/x-tar', '.gz': 'application/gzip' };

/**
 * Sends {@link ISOLATED} with every response, and serves /packs/ from
 * {@link PACKS}, streamed (the Rust pack's compilers are hundreds of
 * megabytes), in dev and preview alike.
 */
const isolatedWithPacks = (): Plugin => {
	const root = PACKS.endsWith(sep) ? PACKS : PACKS + sep;
	const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
		for (const [name, value] of Object.entries(ISOLATED)) response.setHeader(name, value);
		const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
		if (!path.startsWith('/packs/')) return next();
		const file = normalize(join(PACKS, path.slice('/packs/'.length)));
		if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
			response.statusCode = 404;
			response.end();
			return;
		}
		response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
		response.setHeader('Content-Length', String(statSync(file).size));
		if (request.method === 'HEAD') {
			response.end();
			return;
		}
		createReadStream(file).pipe(response);
	};
	return {
		name: 'isolated-with-packs',
		configureServer: (server) => void server.middlewares.use(middleware),
		configurePreviewServer: (server) => void server.middlewares.use(middleware),
	};
};

/**
 * Writes `.vite/chunks.json` beside the build: every script chunk of the
 * page, with the modules it holds (paths relative to this directory) and
 * the chunks it imports statically and by `import()`, so that
 * tests/bundle.test.mjs can say what a first load runs and what waits for
 * use. The page's workers are builds of their own and not listed.
 */
const chunkList = (): Plugin => ({
	name: 'chunk-list',
	apply: 'build',
	generateBundle(_options, bundle) {
		const here = fileURLToPath(new URL('.', import.meta.url));
		const chunks = Object.values(bundle).flatMap((output) =>
			output.type === 'chunk'
				? [{ file: output.fileName, entry: output.isEntry, imports: output.imports, dynamicImports: output.dynamicImports, modules: output.moduleIds.map((id) => relative(here, id.split('?')[0] ?? id).split(sep).join('/')) }]
				: [],
		);
		this.emitFile({ type: 'asset', fileName: '.vite/chunks.json', source: `${JSON.stringify(chunks, null, '\t')}\n` });
	},
});

export default defineConfig({
	plugins: [react(), isolatedWithPacks(), chunkList()],
	// The @yukibana packages are `file:` links to light/modules, so the page
	// bundles their sources, which this condition names (their package.json);
	// without it a link resolves to their dist/, which only
	// light/modules/build.mjs writes.
	resolve: { conditions: ['@yukibana/source', ...defaultClientConditions] },
	worker: { format: 'es' },
	build: { target: 'es2024' },
	server: {
		// The packages are links to light/modules.
		fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../../modules', import.meta.url))] },
	},
});
