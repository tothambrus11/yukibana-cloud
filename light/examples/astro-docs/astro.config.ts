// A static documentation site: MDX pages, Preact islands for the
// playgrounds, the @yukibana packages bundled from their sources, and the
// packs (compilers and runtimes) left unbundled, served from /packs/.
import mdx from '@astrojs/mdx';
import preact from '@astrojs/preact';
import { defineConfig } from 'astro/config';
import type { AstroIntegration } from 'astro';
import { fileURLToPath } from 'node:url';
import { ISOLATED, servePacks } from './packs.ts';

/** Serves /packs/ in `astro dev` (packs.ts); `astro preview` finds them through dist/packs. */
const packsInDev = (): AstroIntegration => ({
	name: 'yukibana-packs',
	hooks: {
		'astro:server:setup': ({ server }) => void server.middlewares.use(servePacks),
	},
});

export default defineConfig({
	output: 'static',
	integrations: [mdx(), preact(), packsInDev()],
	// The toolbar's scripts are not the site's, and nothing here needs it.
	devToolbar: { enabled: false },
	// Cross-origin isolation in dev and preview alike (packs.ts ISOLATED): a
	// production host sends the same headers (README.md).
	server: { headers: { ...ISOLATED } },
	markdown: {
		shikiConfig: { themes: { light: 'github-light', dark: 'github-dark-dimmed' }, defaultColor: false },
	},
	vite: {
		// The @yukibana packages are `file:` links to light/modules, so the
		// site bundles their sources, which this condition names (their
		// package.json); without it a link resolves to their dist/, which
		// only light/modules/build.mjs writes.
		resolve: { conditions: ['@yukibana/source', 'module', 'browser', 'development|production'] },
		ssr: { resolve: { conditions: ['@yukibana/source'] } },
		worker: { format: 'es' },
		server: {
			fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../../modules', import.meta.url))] },
		},
	},
});
