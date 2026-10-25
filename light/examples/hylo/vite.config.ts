// Builds the example as the Hylo site would: two pages (the docs page and
// the end-to-end test's fixture page), each runner bundled with `?worker`
// as an ES module worker, its nested compiler and program workers beside
// it, and the compiler's files copied from hylo-wasm's `new URL(…,
// import.meta.url)` references.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Cross-origin isolation, so a program can read what is typed (stdin is a
 * SharedArrayBuffer; protocol/stdin.ts). The Hylo runner does not need it;
 * the fixture page's reading stand-in does, and says so when it is absent.
 */
const isolated = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
	build: {
		rollupOptions: {
			input: {
				index: fileURLToPath(new URL('index.html', import.meta.url)),
				fixture: fileURLToPath(new URL('fixture.html', import.meta.url)),
			},
		},
	},
	worker: { format: 'es' },
	// hylo-wasm's README: dependency optimisation would move the loader away from the compiler's files.
	optimizeDeps: { exclude: ['@hylo-lang/hylo-wasm'] },
	server: {
		headers: isolated,
		// @yukibana/protocol and @yukibana/runtime are links to light/modules until MP1 publishes them.
		fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../../modules', import.meta.url))] },
	},
	preview: { headers: isolated },
});
