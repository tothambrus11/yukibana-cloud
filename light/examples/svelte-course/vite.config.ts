// Builds the course as another site would: one Svelte page, whose editors'
// Monaco is a chunk of its own loaded after the page, and the packs'
// workers left unbundled, served from the packs' own URLs. In dev and
// preview the packs are $PACKS, or the ones Light's app has installed
// (light/app/static/packs), under /packs/. A real site copies (or
// proxies) the packs it uses to /packs/ beside the page, with the same
// two headers on every response (README.md, "Hosting the packs").
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defaultClientConditions, defineConfig, type Plugin } from 'vite';

/** The packs dev and preview serve under /packs/: $PACKS, else Light's installed ones. */
const PACKS = ((dir: string): string => (dir.endsWith(sep) ? dir : dir + sep))(process.env['PACKS'] ?? fileURLToPath(new URL('../../app/static/packs/', import.meta.url)));

/**
 * Cross-origin isolation, so a program can read standard input (stdin is
 * a SharedArrayBuffer), as the runners' needs say (src/lib/host.ts).
 * Without them every program still runs, and reads end of file.
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

/**
 * Writes `.vite/chunks.json` beside the build's manifest: every script
 * chunk of the page, with the modules it holds (paths relative to this
 * directory) and the chunks it imports statically and by `import()`, so
 * that tests/bundle.test.mjs can say what the page loads first and that no
 * module is bundled twice. A Svelte component is one module, though Vite
 * names its script and its style apart (`?svelte&type=style`). The page's
 * workers are builds of their own and not listed.
 */
const chunkList = (): Plugin => ({
	name: 'chunk-list',
	apply: 'build',
	generateBundle(_options, bundle) {
		const root = fileURLToPath(new URL('.', import.meta.url));
		const chunks = Object.values(bundle).flatMap((output) =>
			output.type === 'chunk'
				? [{ file: output.fileName, entry: output.isEntry, imports: output.imports, dynamicImports: output.dynamicImports, modules: [...new Set(output.moduleIds.map((id) => relative(root, id.split('?')[0] ?? id).split(sep).join('/')))] }]
				: [],
		);
		this.emitFile({ type: 'asset', fileName: '.vite/chunks.json', source: `${JSON.stringify(chunks, null, '\t')}\n` });
	},
});

export default defineConfig({
	plugins: [svelte(), isolatedWithPacks(), chunkList()],
	// The @yukibana packages are `file:` links to light/modules, so the
	// page bundles their sources, which this condition names (their
	// package.json); without it a link resolves to their dist/, which only
	// light/modules/build.mjs writes.
	resolve: { conditions: ['@yukibana/source', ...defaultClientConditions] },
	worker: { format: 'es' },
	server: {
		// The packages are links to light/modules.
		fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../../modules', import.meta.url))] },
	},
});
