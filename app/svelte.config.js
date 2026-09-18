// @ts-check
import adapter from '@sveltejs/adapter-cloudflare';

/** One Worker serves the pages and the API. In development the adapter
 *  emulates the Worker's bindings (Hyperdrive, vars, secrets from .dev.vars)
 *  from wrangler.jsonc, so `platform.env` is the same shape on a laptop as in
 *  production. */
export default {
  kit: {
    adapter: adapter({
      platformProxy: { configPath: 'wrangler.jsonc', persist: true },
    }),
  },
};
