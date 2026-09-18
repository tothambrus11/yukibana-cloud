// @ts-check
import adapter from '@sveltejs/adapter-cloudflare';

/** One Worker serves the pages and the API. In development the adapter
 *  emulates the Worker's bindings (Hyperdrive, vars, secrets from .dev.vars)
 *  from wrangler.jsonc, so `platform.env` is the same shape on a laptop as in
 *  production. */
export default {
  kit: {
    adapter: adapter({
      // The Worker's configuration lives at the repository root, so that
      // Cloudflare's build and a plain `wrangler deploy` both work from
      // there without a directory setting. Development reads the same file.
      platformProxy: { configPath: '../wrangler.jsonc', persist: true },
    }),
  },
};
