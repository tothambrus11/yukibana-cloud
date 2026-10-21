import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
  // This browser only: the IDE's and the CLI's sessions are their own, and
  // so are the person's other browsers.
  await locals.supabase.auth.signOut({ scope: 'local' });
  redirect(303, '/');
};
