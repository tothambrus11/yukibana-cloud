/** What an LTI 1.3 launch and an NRPS member list mean for an edition.
 *
 *  PROTOTYPE (2026-10), see docs/moodle-sync.md. Pure: a launch's verified
 *  claims and a member list's JSON go in, the facts the registry acts on
 *  come out. Verifying signatures and fetching pages is
 *  `#lib/server/lti.ts`; deciding who may link and what a sync may change
 *  is the database's.
 */

/** The claim names of LTI 1.3 Core and NRPS 2.0, which are URLs. */
const CLAIM = {
  messageType: 'https://purl.imsglobal.org/spec/lti/claim/message_type',
  version: 'https://purl.imsglobal.org/spec/lti/claim/version',
  deployment: 'https://purl.imsglobal.org/spec/lti/claim/deployment_id',
  roles: 'https://purl.imsglobal.org/spec/lti/claim/roles',
  context: 'https://purl.imsglobal.org/spec/lti/claim/context',
  nrps: 'https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice',
} as const;

/** The scope a tool asks for to read a course's member list. */
export const NRPS_SCOPE = 'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly';

/** The roles a roster can give. Never 'owner': see `app.apply_lti_roster`. */
export type RosterRole = 'student' | 'assistant';

/** A resource link launch, reduced to what the registry uses. Every field
 *  comes from a token whose signature, issuer, audience, expiry and nonce
 *  were already checked; this only says the token is a launch at all. */
export interface Launch {
  readonly deploymentId: string;
  /** The LTI user id: the platform's own id for the person, stable, and
   *  not an address. Moodle sends its numeric user id. */
  readonly subject: string;
  /** Null when the platform is not configured to share addresses. */
  readonly email: string | null;
  readonly name: string | null;
  /** The person's role in the course, as this registry would map it, or
   *  null for a role that maps to nothing (an observer, a guest). */
  readonly role: RosterRole | null;
  readonly context: { readonly id: string; readonly title: string };
  /** Null when the platform did not offer the member list for this
   *  launch: Moodle offers it only when the tool type allows it. */
  readonly membershipsUrl: string | null;
}

/** A member list's member, mapped. */
export interface Member {
  readonly email: string;
  readonly role: RosterRole;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The edition role for a person's LTI roles, the highest that applies.
 *
 *  LTI writes a context role as a URI
 *  (`http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor`), a
 *  sub-role as `…/membership/Instructor#TeachingAssistant`, and NRPS 2.0
 *  allows the bare word (`Instructor`), which is what Moodle's member list
 *  sends. Institution and system roles (`…/institution/person#…`,
 *  `urn:lti:sysrole:…`) say nothing about the course and are ignored: a
 *  Moodle site admin is not a teacher of every course.
 *
 *  Moodle sends Instructor for whoever has `moodle/course:manageactivities`
 *  in the course, so its editing teachers, and Learner for everyone else,
 *  non-editing teachers included. A non-editing teacher therefore arrives
 *  as a student; telling them apart needs Moodle's web services, not LTI
 *  (docs/moodle-sync.md). */
export function rosterRole(roles: readonly string[]): RosterRole | null {
  let best: RosterRole | null = null;
  for (const raw of roles) {
    if (raw.startsWith('urn:') || raw.includes('/institution/') || raw.includes('/system/')) continue;
    // A sub-role counts as its principal role: Instructor#TeachingAssistant is an Instructor.
    const role = raw.includes('/membership/') ? (raw.split('/membership/')[1] ?? '').split('#')[0] : raw.split('#').pop();
    if (role === 'Instructor' || role === 'ContentDeveloper' || role === 'Administrator') return 'assistant';
    if (role === 'Learner' || role === 'Mentor') best = 'student';
  }
  return best;
}

/** The launch in `claims`, or a sentence saying why they are not one this
 *  registry can use. */
export function launchOf(claims: Record<string, unknown>): Launch | string {
  if (claims[CLAIM.messageType] !== 'LtiResourceLinkRequest') return 'This is not a resource link launch.';
  if (claims[CLAIM.version] !== '1.3.0') return 'Only LTI 1.3 launches are understood.';
  const deploymentId = str(claims[CLAIM.deployment]);
  const subject = str(claims['sub']);
  const context = claims[CLAIM.context];
  const roles = claims[CLAIM.roles];
  if (deploymentId === null || subject === null) return 'The launch names no deployment or no person.';
  if (!isRecord(context) || str(context['id']) === null) return 'The launch was not made from a course.';
  if (!Array.isArray(roles)) return 'The launch carries no roles.';
  const nrps = claims[CLAIM.nrps];
  const email = str(claims['email']);
  return {
    deploymentId,
    subject,
    email: email === null ? null : email.toLowerCase(),
    name: str(claims['name']),
    role: rosterRole(roles.filter((r): r is string => typeof r === 'string')),
    context: {
      id: str(context['id']) ?? '',
      title: str(context['title']) ?? str(context['label']) ?? `Course ${String(context['id'])}`,
    },
    membershipsUrl: isRecord(nrps) ? str(nrps['context_memberships_url']) : null,
  };
}

/** The members of one NRPS page, mapped, with how many were left out and
 *  why. A member without an address cannot be enrolled (an enrolment is an
 *  address); a member whose roles map to nothing is not in the class; a
 *  member whose status is not Active has left it. */
export interface Page {
  readonly members: readonly Member[];
  readonly withoutEmail: number;
  readonly withoutRole: number;
  readonly inactive: number;
}

/** One page of a member list (`application/vnd.ims.lti-nrps.v2.membershipcontainer+json`),
 *  or a sentence saying why it is not one. */
export function pageOf(body: unknown): Page | string {
  if (!isRecord(body) || !Array.isArray(body['members'])) return 'The member list has no members array.';
  const members: Member[] = [];
  let withoutEmail = 0;
  let withoutRole = 0;
  let inactive = 0;
  for (const m of body['members']) {
    if (!isRecord(m)) return 'A member is not an object.';
    // Status is optional in NRPS and means Active when absent.
    if (m['status'] !== undefined && m['status'] !== 'Active') {
      inactive++;
      continue;
    }
    const roles = Array.isArray(m['roles']) ? m['roles'].filter((r): r is string => typeof r === 'string') : [];
    const role = rosterRole(roles);
    const email = str(m['email']);
    if (role === null) withoutRole++;
    else if (email === null) withoutEmail++;
    else members.push({ email: email.toLowerCase(), role });
  }
  return { members, withoutEmail, withoutRole, inactive };
}

/** The next page's address from an HTTP `Link` header, or null on the last
 *  page. NRPS pages with `rel="next"`, as Moodle does once a page is full. */
export function nextPage(link: string | null): string | null {
  if (link === null) return null;
  for (const part of link.split(',')) {
    const m = /<([^>]+)>\s*;(.*)/.exec(part.trim());
    if (m !== null && /\brel\s*=\s*"?next"?/i.test(m[2] ?? '')) return m[1] ?? null;
  }
  return null;
}
