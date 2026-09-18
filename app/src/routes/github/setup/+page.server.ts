import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { uuidOf, type ProjectId } from '$lib/ids';
import { asUser, statusOf } from '$lib/server/db';
import { text } from '$lib/server/form';
import { requireClaims, withContext } from '$lib/server/context';
import { installationRepos, installationToken } from '$lib/server/github';
import { startBuild } from '$lib/server/builds';
import { report } from '$lib/report';

/** Where GitHub sends the teacher after installing the App. The query
 *  carries the installation id and, as `state`, the project this was for.
 *  The installation is recorded as the caller's, and the repositories it
 *  covers are listed for them to pick one. */
export const load: PageServerLoad = async (event) => {
  const claims = requireClaims(event);
  const installationId = Number.parseInt(event.url.searchParams.get('installation_id') ?? '', 10);
  const project = uuidOf<ProjectId>(event.url.searchParams.get('state'));
  if (!Number.isInteger(installationId) || project === null) error(400, 'This link is missing the installation or the project it was for.');
  return withContext(event, async (ctx) => {
    const token = await installationToken(ctx.config.github, installationId).catch((e: unknown) => {
      report('github-setup', e instanceof Error ? e.message : String(e));
      error(502, 'GitHub did not accept the installation. Try installing the app again.');
    });
    const head = await asUser(ctx.sql, claims, async (tx) => {
      const [p] = await tx<{ slug: string; edition_id: string; owner: boolean }[]>`
        select slug, edition_id, app.role_in(edition_id) = 'owner' as owner from project where project_id = ${project}`;
      if (p === undefined || !p.owner) error(404, 'No such project, or you are not its owner.');
      const [i] = await tx<{ installation_id: number }[]>`
        insert into github_installation (installation_id, account_login, installed_by)
        values (${installationId}, ${event.url.searchParams.get('account') ?? ''}, ${claims.sub})
        on conflict (installation_id) do nothing
        returning installation_id`;
      return { ...p, recorded: i !== undefined };
    });
    const repos = await installationRepos(token);
    if (repos.length > 0 && head.recorded) {
      await asUser(ctx.sql, claims, (tx) => tx`
        update github_installation set account_login = ${repos[0]?.fullName.split('/')[0] ?? ''}
        where installation_id = ${installationId} and account_login = ''`);
    }
    return { project, slug: head.slug, edition: head.edition_id, installationId, repos };
  });
};

export const actions: Actions = {
  choose: async (event) => {
    const claims = requireClaims(event);
    const form = await event.request.formData();
    const project = uuidOf<ProjectId>(text(form, 'project'));
    const installationId = Number.parseInt(text(form, 'installation_id'), 10);
    const repoId = Number.parseInt(text(form, 'repo_id'), 10);
    const fullName = text(form, 'full_name');
    const ref = (text(form, 'ref') || 'main');
    if (project === null || !Number.isInteger(installationId) || !Number.isInteger(repoId) || !/^[^/\s]+\/[^/\s]+$/.test(fullName)) {
      return fail(400, { error: 'Pick a repository.' });
    }
    let edition = '';
    try {
      await withContext(event, async (ctx) => {
        edition = await asUser(ctx.sql, claims, async (tx) => {
          const [row] = await tx<{ edition_id: string }[]>`
            update project set github_installation_id = ${installationId}, github_repo_id = ${repoId},
                               github_repo_full_name = ${fullName}, github_ref = ${ref}
            where project_id = ${project} returning edition_id`;
          if (row === undefined) error(404, 'No such project, or you are not its owner.');
          return row.edition_id;
        });
        await startBuild(event, ctx.config, project, null);
      });
    } catch (e) {
      return fail(statusOf(e).status, { error: statusOf(e).message });
    }
    redirect(303, `/editions/${edition}/projects/${project}`);
  },
};
