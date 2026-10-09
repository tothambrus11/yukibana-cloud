import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { landing } from '#lib/login.ts';
import { report } from '#lib/report.ts';

export const GET: RequestHandler = async ({ url, locals }) => {
  const code = url.searchParams.get('code');
  const next = landing(url.searchParams.get('next'));
  if (code === null) redirect(303, '/auth/login');
  const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
  if (error !== null) {
    report('callback', error.message);
    redirect(303, '/auth/login');
  }
  redirect(303, next);
};
