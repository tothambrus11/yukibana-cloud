import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import type { UserConfig } from 'vite';

/** One Worker serves the pages and the API. In development the adapter
 *  emulates the Worker's bindings (Hyperdrive, vars, secrets from .dev.vars)
 *  from wrangler.jsonc behind `cloudflare:workers`, so the env is the same
 *  shape on a laptop as in production. SvelteKit 3 takes its configuration
 *  here, in the plugin; there is no svelte.config.js. */
export default {
  plugins: [
    sveltekit({
      adapter: adapter({
        // The Worker's configuration lives at the repository root, so that
        // Cloudflare's build and a plain `wrangler deploy` both work from
        // there without a directory setting. Development reads the same file.
        platformProxy: { configPath: '../wrangler.jsonc', persist: true },
      }),
    }),
  ],
} satisfies UserConfig;
