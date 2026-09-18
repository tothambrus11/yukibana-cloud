import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseEvent, verifySignature } from '$lib/webhook';
import { trustId, type ProjectId } from '$lib/ids';
import { report } from '$lib/report';
import { asBuilder } from '$lib/server/db';
import { withContext } from '$lib/server/context';
import { startBuild } from '$lib/server/builds';

/** GitHub's deliveries. Nobody is logged in here: the signature is the
 *  authentication, checked over the raw bytes before anything is parsed.
 *  Each delivery id is remembered so a retry builds nothing twice. */
export const POST: RequestHandler = async (event) => {
  const body = new Uint8Array(await event.request.arrayBuffer());
  const delivery = event.request.headers.get('x-github-delivery');
  const name = event.request.headers.get('x-github-event');
  return withContext(event, async (ctx) => {
    if (!(await verifySignature(ctx.config.github.webhookSecret, body, event.request.headers.get('x-hub-signature-256')))) {
      report('webhook', `bad signature on delivery ${delivery ?? '?'}`);
      error(401, 'Bad signature.');
    }
    if (delivery === null) error(400, 'No delivery id.');
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(body));
    } catch {
      error(400, 'Not JSON.');
    }
    const ev = parseEvent(name, payload);
    if (ev === null) return json({ ignored: name });

    const fresh = await asBuilder(ctx.sql, async (tx) => {
      const rows = await tx`insert into github_delivery (delivery_id) values (${delivery}) on conflict do nothing returning delivery_id`;
      return rows.length === 1;
    });
    if (!fresh) return json({ duplicate: delivery });

    if (ev.kind === 'installation') {
      if (ev.action === 'deleted' || ev.action === 'suspend') {
        await asBuilder(ctx.sql, (tx) => tx`update github_installation set removed_at = now() where installation_id = ${ev.installationId}`);
      } else if (ev.action === 'unsuspend' || ev.action === 'created') {
        await asBuilder(ctx.sql, (tx) => tx`update github_installation set removed_at = null where installation_id = ${ev.installationId}`);
      }
      return json({ installation: ev.action });
    }

    if (ev.deleted) return json({ ignored: 'branch deleted' });
    const projects = await asBuilder(ctx.sql, (tx) => tx<{ project_id: string }[]>`
      update project set github_repo_full_name = ${ev.fullName}
      where github_repo_id = ${ev.repoId} and ('refs/heads/' || github_ref = ${ev.ref} or 'refs/tags/' || github_ref = ${ev.ref})
      returning project_id`);
    const builds = [];
    for (const p of projects) builds.push(await startBuild(event, ctx.config, trustId<ProjectId>(p.project_id), ev.after));
    return json({ builds });
  });
};
