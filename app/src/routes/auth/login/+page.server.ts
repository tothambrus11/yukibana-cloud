import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { report } from '$lib/report';

/** GitHub is the only way in. The provider redirects back to /auth/callback
 *  with a code, which becomes a session there. `next` survives the round
 *  trip so a link into a project lands on the project. */
export const actions: Actions = {
  default: async ({ locals, url }) => {
    const next = url.searchParams.get('next') ?? '/';
    const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    const { data, error } = await locals.supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${url.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`, scopes: 'read:user user:email' },
    });
    if (error !== null || data.url === null) {
      return fail(502, { error: report('login', error?.message ?? 'GitHub gave no URL to send you to') });
    }
    redirect(303, data.url);
  },
};
