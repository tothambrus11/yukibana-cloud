import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
  user: locals.claims === null ? null : { id: locals.claims.sub, email: locals.claims.email },
});
