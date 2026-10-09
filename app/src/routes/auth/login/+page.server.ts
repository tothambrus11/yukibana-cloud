import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { addressOf, codeOf, landing } from '#lib/login.ts';
import { report } from '#lib/report.ts';
import { text } from '#lib/server/form.ts';
import { sendCode, verifyCode } from '#lib/server/login.ts';
import { workerConfig } from '#lib/server/worker.ts';

/** `next` travels in the forms rather than the query string: a form's
 *  `action="?/send"` replaces the query, and a link into a project should
 *  still land on the project. */
export const load: PageServerLoad = ({ url }) => ({ next: landing(url.searchParams.get('next')) });

/** Two ways in, both ending in the same `auth.users` row for the same
 *  address. GitHub redirects back to /auth/callback with a code. An email
 *  code is asked for by `send` and turned into a session by `verify`, here,
 *  without leaving the page. */
export const actions: Actions = {
  github: async ({ locals, request, url }) => {
    const next = landing(text(await request.formData(), 'next'));
    const { data, error } = await locals.supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${url.origin}/auth/callback?next=${encodeURIComponent(next)}`, scopes: 'read:user user:email' },
    });
    if (error !== null || data.url === null) {
      return fail(502, { error: report('login', error?.message ?? 'GitHub gave no URL to send you to') });
    }
    // To the Auth server, and only to it: SvelteKit 3 refuses a redirect
    // to another origin unless it is named.
    redirect(303, data.url, { external: [new URL(workerConfig().supabaseUrl).origin] });
  },

  send: async ({ locals, request }) => {
    const form = await request.formData();
    const next = landing(text(form, 'next'));
    const email = addressOf(text(form, 'email'));
    if (email === null) return fail(400, { error: 'That is not an email address.', next });
    const sent = await sendCode(locals.supabase.auth, email);
    if (!sent.ok) return fail(sent.status, { error: sent.message, next });
    return { sent: email, next };
  },

  verify: async ({ locals, request }) => {
    const form = await request.formData();
    const next = landing(text(form, 'next'));
    const email = addressOf(text(form, 'email'));
    if (email === null) return fail(400, { error: 'That is not an email address.', next });
    const code = codeOf(text(form, 'code'));
    if (code === null) return fail(400, { error: 'A code is the digits from the mail.', sent: email, next });
    const verified = await verifyCode(locals.supabase.auth, email, code);
    if (!verified.ok) return fail(verified.status, { error: verified.message, sent: email, next });
    redirect(303, next);
  },
};
