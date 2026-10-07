/** The Worker's own environment: where the configuration and `waitUntil`
 *  come from.
 *
 *  Since adapter-cloudflare 8 (SvelteKit 3) the adapter no longer hands the
 *  Worker's bindings to SvelteKit as `event.platform`; they are read from
 *  `cloudflare:workers`, the runtime's own module, which the adapter also
 *  provides in development (from wrangler.jsonc and .dev.vars, as before).
 *  This is the only module that imports it, so everything else, the tests
 *  included, keeps working with a plain `Config`.
 */

import { env, waitUntil } from 'cloudflare:workers';
import { configOf, type Config } from './env.ts';

/** The checked configuration, or an error naming the first missing value. */
export function workerConfig(): Config {
  return configOf(env);
}

/** Lets `promise` finish after the response has gone, as the Worker allows. */
export function afterResponse(promise: Promise<unknown>): void {
  waitUntil(promise);
}
