/** The registry as an LTI 1.3 tool of a Moodle site: launches, course
 *  links, and roster syncs over NRPS.
 *
 *  PROTOTYPE (2026-10), see docs/moodle-sync.md. This module does the I/O
 *  around what `#lib/lti.ts` decides: it verifies a launch's signature
 *  against the platform's keys, asks the platform for a service token with
 *  an assertion signed by the tool's key, and fetches every page of a
 *  member list. What may be linked and what a sync may change is decided by
 *  the database (the lti_roster migration), as the LTI role or as the
 *  person asking.
 */

import { error } from '@sveltejs/kit';
import { calculateJwkThumbprint, createRemoteJWKSet, decodeJwt, exportJWK, importPKCS8, jwtVerify, SignJWT, type JWK, type JWTPayload } from 'jose';
import type { Claims } from '#lib/claims.ts';
import { hex, sha256 } from '#lib/bytes.ts';
import { trustId, type EditionId, type LtiLinkId, type PlatformId } from '#lib/ids.ts';
import { launchOf, nextPage, NRPS_SCOPE, pageOf, type Launch, type Member } from '#lib/lti.ts';
import { report } from '#lib/report.ts';
import { asLti, asUser, type Tx } from './db';
import type { Context } from './context';
import type { LtiConfig } from './env';

/** The tool's configuration, or a 404: a registry that is not an LTI tool
 *  has no LTI routes. */
export function ltiConfig(ctx: Context): LtiConfig {
  return ctx.config.lti ?? error(404, 'This registry is not set up as an LTI tool.');
}

/** The tool's signing key and its public half as a JWK, with a key id that
 *  is the public key's thumbprint, so rotating the key rotates the id. */
async function toolKey(lti: LtiConfig): Promise<{ key: CryptoKey; jwk: JWK }> {
  const key = await importPKCS8(lti.privateKey, 'RS256', { extractable: true });
  const { n, e } = await exportJWK(key);
  if (n === undefined || e === undefined) throw new Error('LTI_PRIVATE_KEY is not an RSA key');
  const pub: JWK = { kty: 'RSA', n, e };
  return { key, jwk: { ...pub, kid: await calculateJwkThumbprint(pub), alg: 'RS256', use: 'sig' } };
}

/** The key set Moodle verifies the tool's assertions with, for /lti/jwks. */
export async function toolJwks(lti: LtiConfig): Promise<{ keys: JWK[] }> {
  return { keys: [(await toolKey(lti)).jwk] };
}

/** A registered platform, as `app.lti_platform_for` gives it. */
export interface Platform {
  readonly platformId: PlatformId;
  readonly issuer: string;
  readonly clientId: string;
  readonly deploymentId: string;
  readonly authUrl: string;
  readonly tokenUrl: string;
  readonly jwksUrl: string;
}

async function platformFor(ctx: Context, issuer: string, clientId: string): Promise<Platform | null> {
  const [row] = await asLti(ctx.sql, (tx) => tx<{ platform_id: string; deployment_id: string; auth_url: string; token_url: string; jwks_url: string }[]>`
    select * from app.lti_platform_for(${issuer}, ${clientId})`);
  if (row === undefined) return null;
  return { platformId: trustId<PlatformId>(row.platform_id), issuer, clientId, deploymentId: row.deployment_id, authUrl: row.auth_url, tokenUrl: row.token_url, jwksUrl: row.jwks_url };
}

/** What the tool remembers between the OIDC login and the launch, in a
 *  cookie: the state it sent, which must come back beside the token, and the
 *  nonce, which must come back inside it. */
export interface LoginState {
  readonly state: string;
  readonly nonce: string;
}

const random = (): string => hex(crypto.getRandomValues(new Uint8Array(32)));

/** Step one of a launch, the third-party initiated login: the platform
 *  sends `iss`, `login_hint`, `target_link_uri`, `client_id` and (Moodle)
 *  `lti_message_hint`; the tool answers by sending the browser to the
 *  platform's authorisation endpoint with a fresh state and nonce. */
export async function loginRedirect(ctx: Context, params: (name: string) => string | null, redirectUri: string): Promise<{ location: string; remember: LoginState }> {
  ltiConfig(ctx);
  const issuer = params('iss');
  const loginHint = params('login_hint');
  // `client_id` is optional in the specification; Moodle always sends it,
  // and without it an issuer with two registrations would be ambiguous.
  const clientId = params('client_id');
  if (issuer === null || loginHint === null || clientId === null) error(400, 'An LTI login needs iss, login_hint and client_id.');
  const platform = await platformFor(ctx, issuer, clientId);
  if (platform === null) error(403, `No LTI platform is registered as ${issuer} with client id ${clientId}.`);
  const remember = { state: random(), nonce: random() };
  const url = new URL(platform.authUrl);
  const query: Record<string, string> = {
    scope: 'openid', response_type: 'id_token', response_mode: 'form_post', prompt: 'none',
    client_id: clientId, redirect_uri: redirectUri, login_hint: loginHint,
    state: remember.state, nonce: remember.nonce,
  };
  const hint = params('lti_message_hint');
  if (hint !== null) query['lti_message_hint'] = hint;
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { location: url.toString(), remember };
}

/** Step two: the platform posts a signed `id_token` and the `state`. The
 *  launch, from the platform it claims to be from, or a 4xx saying why not.
 *  The token's own `iss` and `aud` pick the platform, and then its keys,
 *  issuer, audience, expiry, nonce and deployment are all checked before
 *  anything else in it is read. */
export async function verifyLaunch(ctx: Context, idToken: string, state: string, remembered: LoginState | null): Promise<{ platform: Platform; launch: Launch }> {
  ltiConfig(ctx);
  if (remembered === null || state !== remembered.state) error(400, 'This launch did not start here, or its login has expired. Launch it again from Moodle.');
  let unverified: JWTPayload;
  try {
    unverified = decodeJwt(idToken);
  } catch {
    error(400, 'The launch token is not a JWT.');
  }
  const clientId = Array.isArray(unverified.aud) ? unverified.aud[0] : unverified.aud;
  if (typeof unverified.iss !== 'string' || typeof clientId !== 'string') error(400, 'The launch token names no issuer or audience.');
  const platform = await platformFor(ctx, unverified.iss, clientId);
  if (platform === null) error(403, `No LTI platform is registered as ${unverified.iss}.`);
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, createRemoteJWKSet(new URL(platform.jwksUrl)), { issuer: platform.issuer, audience: platform.clientId, maxTokenAge: '5m' }));
  } catch (e) {
    error(401, report('lti', `a launch from ${platform.issuer} failed verification: ${e instanceof Error ? e.message : String(e)}`));
  }
  if (payload['nonce'] !== remembered.nonce) error(401, 'The launch token was not made for this login.');
  const launch = launchOf(payload);
  if (typeof launch === 'string') error(400, launch);
  if (launch.deploymentId !== platform.deploymentId) error(403, `Deployment ${launch.deploymentId} of ${platform.issuer} is not registered here.`);
  return { platform, launch };
}

/** Records a verified Instructor launch as a link grant and returns its
 *  secret, which only the teacher's browser keeps (in a cookie) and
 *  `linkEdition` spends. */
export async function grantLink(ctx: Context, platform: Platform, launch: Launch): Promise<string> {
  if (launch.role !== 'assistant') error(403, 'Only a teacher of the Moodle course can link it to Yukibana.');
  if (launch.membershipsUrl === null) error(409, 'Moodle did not offer this course\'s member list. In the tool\'s settings, set "IMS LTI Names and Role Provisioning" to "Use this service to retrieve members\' information as per privacy settings".');
  const secret = random();
  const hash = await sha256(new TextEncoder().encode(secret));
  await asLti(ctx.sql, (tx) => tx`select app.grant_lti_link(${hash as Uint8Array<ArrayBuffer>}, ${platform.platformId}, ${launch.context.id}, ${launch.context.title}, ${launch.membershipsUrl})`);
  return secret;
}

/** Spends a grant on `edition`, as the person asking, who must own it. */
export async function linkEdition(ctx: Context, claims: Claims, edition: EditionId, secret: string): Promise<LtiLinkId> {
  const hash = await sha256(new TextEncoder().encode(secret));
  const [row] = await asUser(ctx.sql, claims, (tx) => tx<{ id: string }[]>`select app.link_edition_to_lti(${edition}, ${hash as Uint8Array<ArrayBuffer>}) as id`);
  if (row === undefined) throw new Error('link_edition_to_lti returned nothing');
  return trustId<LtiLinkId>(row.id);
}

/** A link, with what a sync needs and when it last ran. */
export interface Target {
  readonly linkId: LtiLinkId;
  readonly editionId: EditionId;
  readonly issuer: string;
  readonly clientId: string;
  readonly tokenUrl: string;
  readonly membershipsUrl: string;
  /** Null: never synced. */
  readonly lastRun: Date | null;
}

interface TargetRow { link_id: string; edition_id: string; issuer: string; client_id: string; token_url: string; memberships_url: string; last_run: Date | null }

const targetOf = (r: TargetRow): Target => ({
  linkId: trustId<LtiLinkId>(r.link_id), editionId: trustId<EditionId>(r.edition_id), issuer: r.issuer, clientId: r.client_id,
  tokenUrl: r.token_url, membershipsUrl: r.memberships_url, lastRun: r.last_run,
});

/** The edition linked to a Moodle course, if any. A launch passes the
 *  course's current title and member list address to keep them fresh. */
export async function targetFor(ctx: Context, platform: PlatformId, context: string, fresh?: { title: string; membershipsUrl: string | null }): Promise<Target | null> {
  const [row] = await asLti(ctx.sql, (tx) => tx<TargetRow[]>`
    select * from app.lti_target_for(${platform}, ${context}, ${fresh?.title ?? null}, ${fresh?.membershipsUrl ?? null})`);
  return row === undefined ? null : targetOf(row);
}

/** The link of `edition`, if the person asking is its staff: their own
 *  policies must show them the link before the LTI role is asked for the
 *  rest. For the edition page's "sync now" and the first sync after
 *  linking. */
export async function targetForEdition(ctx: Context, claims: Claims, edition: EditionId): Promise<Target | null> {
  const [seen] = await asUser(ctx.sql, claims, (tx) => tx<{ link_id: string }[]>`select link_id from lti_link where edition_id = ${edition}`);
  if (seen === undefined) return null;
  const [row] = await asLti(ctx.sql, (tx) => tx<TargetRow[]>`select * from app.lti_target_by_link(${seen.link_id})`);
  return row === undefined ? null : targetOf(row);
}

/** The link of a change hint: the platform and course a Moodle event named.
 *  Null for anything not linked, which a hint answers the same as success:
 *  a hint carries no data and its sender learns nothing from the answer. */
export async function targetForHint(ctx: Context, issuer: string, clientId: string, context: string): Promise<Target | null> {
  const platform = await platformFor(ctx, issuer, clientId);
  return platform === null ? null : targetFor(ctx, platform.platformId, context);
}

/** Every link not synced for `maxAgeSeconds`, for the scheduled sync. */
export async function targetsDue(ctx: Context, maxAgeSeconds: number): Promise<Target[]> {
  const rows = await asLti(ctx.sql, (tx) => tx<TargetRow[]>`select * from app.lti_targets_due(make_interval(secs => ${maxAgeSeconds}))`);
  return rows.map(targetOf);
}

/** The edition's link as its staff see it, or null; through the caller's
 *  policies, so a student and a stranger get null. */
export async function linkOf(tx: Tx, edition: EditionId): Promise<{ title: string; contextId: string; lastRun: Date | null; lastChange: string | null } | null> {
  const [row] = await tx<{ context_title: string; context_id: string; last_run: Date | null; last_change: string | null }[]>`
    select l.context_title, l.context_id,
           (select max(r.at) from lti_sync_run r where r.link_id = l.link_id) as last_run,
           (select format('%s members: %s added, %s changed, %s removed (%s)', r.members, r.added, r.updated, r.removed, r.trigger)
              from lti_sync_run r where r.link_id = l.link_id order by r.at desc limit 1) as last_change
    from lti_link l
    where l.edition_id = ${edition}`;
  if (row === undefined) return null;
  return { title: row.context_title, contextId: row.context_id, lastRun: row.last_run, lastChange: row.last_change };
}

/** What a sync did. */
export interface Synced {
  readonly members: number;
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  /** Members the roster could not use: no address, a role that maps to
   *  nothing, or not Active. */
  readonly skipped: number;
}

export type Trigger = 'launch' | 'hint' | 'schedule' | 'manual';

/** A service token for `target`'s platform: the OAuth 2 client credentials
 *  grant with a JWT client assertion (RFC 7523), which is how LTI 1.3
 *  services authenticate a tool. */
async function serviceToken(lti: LtiConfig, target: Target): Promise<string> {
  const { key, jwk } = await toolKey(lti);
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid ?? '' })
    .setIssuer(target.clientId).setSubject(target.clientId).setAudience(target.tokenUrl)
    .setIssuedAt().setExpirationTime('5m').setJti(crypto.randomUUID())
    .sign(key);
  const res = await fetch(target.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
      scope: NRPS_SCOPE,
    }),
  });
  const body: unknown = await res.json().catch(() => null);
  const token = typeof body === 'object' && body !== null && 'access_token' in body && typeof body.access_token === 'string' ? body.access_token : null;
  if (!res.ok || token === null) throw new Error(`the token endpoint answered ${res.status}: ${JSON.stringify(body)}`);
  return token;
}

/** The whole member list, every page, or a throw. Never a partial list: a
 *  sync removes whoever is not on it. */
async function members(token: string, url: string): Promise<{ members: Member[]; skipped: number }> {
  const all: Member[] = [];
  let skipped = 0;
  let next: string | null = url;
  for (let pages = 0; next !== null; pages++) {
    if (pages === 200) throw new Error('the member list has more than 200 pages; refusing to follow it further');
    const res = await fetch(next, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.ims.lti-nrps.v2.membershipcontainer+json' } });
    if (!res.ok) throw new Error(`the member list answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const page = pageOf(await res.json());
    if (typeof page === 'string') throw new Error(page);
    all.push(...page.members);
    skipped += page.withoutEmail + page.withoutRole + page.inactive;
    next = nextPage(res.headers.get('link'));
  }
  return { members: all, skipped };
}

/** Fetches `target`'s member list from Moodle and makes the edition's
 *  synced enrolments match it. A failure anywhere before the database
 *  leaves the roster as it was and throws, with a report. */
export async function sync(ctx: Context, target: Target, trigger: Trigger): Promise<Synced> {
  const lti = ltiConfig(ctx);
  let list;
  try {
    list = await members(await serviceToken(lti, target), target.membershipsUrl);
  } catch (e) {
    throw new Error(report('lti', `syncing ${target.membershipsUrl} failed, roster unchanged: ${e instanceof Error ? e.message : String(e)}`), { cause: e });
  }
  // Sent as text and cast twice: postgres.js, seeing a parameter cast to
  // jsonb, encodes a string as a JSON string, and the function would get
  // one scalar instead of an array (it refuses that, as it should).
  const [row] = await asLti(ctx.sql, (tx) => tx<{ added: number; updated: number; removed: number }[]>`
    select * from app.apply_lti_roster(${target.linkId}, ${JSON.stringify(list.members)}::text::jsonb, ${trigger})`);
  if (row === undefined) throw new Error('apply_lti_roster returned nothing');
  return { members: list.members.length, ...row, skipped: list.skipped };
}
