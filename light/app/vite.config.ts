import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defaultClientConditions, defaultServerConditions, defineConfig, type Plugin } from 'vite';
import { MODULES_DIR } from '../modules/list.mjs';

// Language servers that block on stdin need SharedArrayBuffer, which needs a
// cross-origin isolated page. The dev and preview servers send the headers;
// a static host that cannot is covered by the service worker.
const isolation = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
};

/**
 * Monaco's JSON service creates its worker with `internal/common/workers.js`,
 * which (in monaco-editor 0.57.0, the version checked) imports every editor
 * contribution as a side effect, `diffEditor.contribution` among them: that
 * bundles what monaco.ts leaves out and registers their services after the
 * editor's have started. It is replaced by src/lib/monaco-workers.ts, the
 * same function without them; that file says why in full.
 */
const monacoWorkers: Plugin = {
	name: 'yukibana:monaco-workers',
	enforce: 'pre',
	resolveId(source, importer) {
		if (importer?.includes('/monaco-editor/') && source.endsWith('/internal/common/workers.js')) {
			return fileURLToPath(new URL('./src/lib/monaco-workers.ts', import.meta.url));
		}
		return null;
	},
};

/**
 * The shared modules (light/modules) are this package's dependencies, as
 * `link:` links (package.json), and are read from their sources: the
 * `@yukibana/source` condition of each module's `exports` names its .ts
 * files, where the default condition names the dist/ that only
 * light/modules/build.mjs writes. So the app imports them as any host
 * does (the examples are built the same way), and a subpath is exactly
 * one the module exports. The server conditions are prerendering's.
 *
 * This replaced kit.alias, which SvelteKit 3 deprecates and warned about
 * on every run, and kit.typescript.config, which wrote Monaco's path into
 * the generated tsconfig: tsconfig.json says both now.
 */
const SOURCE = '@yukibana/source';

export default defineConfig({
	plugins: [
		monacoWorkers,
		sveltekit({
			// Every page is prerendered and the app runs entirely in the browser,
			// so the output is a folder of static files any web server can serve.
			adapter: adapter({ pages: 'build', assets: 'build', precompress: false }),
			// Registered by hand (src/lib/pwa.ts), so the page can reload once
			// to become cross-origin isolated.
			serviceWorker: { register: false },
		}),
	],
	resolve: { conditions: [SOURCE, ...defaultClientConditions] },
	ssr: { resolve: { conditions: [SOURCE, ...defaultServerConditions] } },
	// The dev server serves files only from the directories it allows; the
	// modules live beside the app, not in it.
	server: { headers: isolation, fs: { allow: [MODULES_DIR] } },
	preview: { headers: isolation },
	worker: { format: 'es' },
});
