// Builds the example as the Hylo site would: two pages (the docs page and
// the end-to-end test's fixture page), each runner bundled with `?worker`
// as an ES module worker, its nested compiler and program workers beside
// it, and the compiler's files copied from hylo-wasm's `new URL(…,
// import.meta.url)` references.
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';

/**
 * Cross-origin isolation, so a program can read what is typed (stdin is a
 * SharedArrayBuffer; protocol/stdin.ts). The Hylo runner does not need it;
 * the fixture page's reading stand-in does, and says so when it is absent.
 */
const isolated = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

/**
 * Whether a request is for the docs page's document, which is served
 * without isolation in dev and preview, as GitHub Pages serves the Hylo
 * site and as the Hylo runner declares it needs: a developer then sees the
 * page the site's readers get. Its scripts and workers still carry the
 * headers, which a page that is not isolated ignores.
 */
const isDocsPage = (url: string | undefined): boolean => {
	const path = new URL(url ?? '/', 'http://localhost').pathname;
	return path === '/' || path === '/index.html';
};

/** Sends {@link isolated} with every response but the docs page's, in dev and preview alike. */
const isolateAllButTheDocsPage = (): Plugin => {
	const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
		if (!isDocsPage(request.url)) for (const [name, value] of Object.entries(isolated)) response.setHeader(name, value);
		next();
	};
	return {
		name: 'isolate-all-but-the-docs-page',
		configureServer: (server) => void server.middlewares.use(middleware),
		configurePreviewServer: (server) => void server.middlewares.use(middleware),
	};
};

export default defineConfig({
	build: {
		rollupOptions: {
			input: {
				index: fileURLToPath(new URL('index.html', import.meta.url)),
				fixture: fileURLToPath(new URL('fixture.html', import.meta.url)),
			},
		},
	},
	plugins: [isolateAllButTheDocsPage()],
	worker: { format: 'es' },
	// hylo-wasm's README: dependency optimisation would move the loader away from the compiler's files.
	optimizeDeps: { exclude: ['@hylo-lang/hylo-wasm'] },
	server: {
		// @yukibana/protocol and @yukibana/runtime are links to light/modules until MP1 publishes them.
		fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../../modules', import.meta.url))] },
	},
});
