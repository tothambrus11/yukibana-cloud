import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';

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
 * The shared modules (light/modules), each imported by its package name
 * from its index.ts, the only file a module promises. kit.alias, which
 * SvelteKit 3 deprecates (and says so on every run) in favour of
 * package.json `imports`: those may only point inside this package and must
 * be `#` names, and the modules live beside the app and are called
 * `@yukibana/<name>` by every host. kit.alias also writes the TypeScript
 * paths, so svelte-check resolves the same names Vite does.
 */
const modules = fileURLToPath(new URL('../modules', import.meta.url));
const moduleAliases = Object.fromEntries(
	['protocol', 'runtime', 'monaco'].map((name) => [`@yukibana/${name}`, `${modules}/${name}/index.ts`]),
);

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
			alias: moduleAliases,
		}),
	],
	// The dev server serves files only from the directories it allows; the
	// modules live beside the app, not in it.
	server: { headers: isolation, fs: { allow: [modules] } },
	preview: { headers: isolation },
	worker: { format: 'es' },
});
