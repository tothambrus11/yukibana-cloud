import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { workerConfig } from '#lib/server/worker.ts';
import { toolJwks } from '#lib/server/lti.ts';

/** The tool's public key set (PROTOTYPE, docs/moodle-sync.md), the
 *  "Public keyset" URL of the Moodle tool, with which Moodle checks the
 *  assertion the Worker signs to ask for a service token. */
export const GET: RequestHandler = async () => {
  const lti = workerConfig().lti ?? error(404, 'This registry is not set up as an LTI tool.');
  return json(await toolJwks(lti), { headers: { 'cache-control': 'public, max-age=300' } });
};
