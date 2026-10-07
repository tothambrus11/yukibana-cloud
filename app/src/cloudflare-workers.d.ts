/** The two members of the Workers runtime module the app uses (see
 *  #lib/server/worker.ts). Declared here rather than by loading
 *  @cloudflare/workers-types globally, whose Request, Response and friends
 *  would collide with the DOM types the pages are checked against. Its own
 *  file, with no imports, so that it declares the module rather than
 *  augmenting one. */
declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
  export function waitUntil(promise: Promise<unknown>): void;
}
