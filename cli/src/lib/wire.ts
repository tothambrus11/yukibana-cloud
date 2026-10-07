/** What the registry's JSON API answers, as the CLI relies on it.
 *
 *  `app/src/lib/api.ts` is the other side and says the same in the same
 *  words. Every response is `unknown` until one of the decoders here has
 *  looked at it: a registry of another version answers something else, and
 *  "the registry answered `deadline` as a number" is a better sentence than
 *  a TypeError three calls later. Times are ISO 8601 strings in UTC; a null
 *  means what the field says it means.
 */

export type EditionRole = 'student' | 'assistant' | 'owner';

export interface Me {
  readonly userId: string;
  readonly email: string | null;
  readonly fullName: string | null;
  readonly githubLogin: string | null;
  /** `user`, `teacher` or `admin`. */
  readonly platformRole: string;
}

export interface Edition {
  readonly editionId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly label: string;
  readonly archived: boolean;
  /** The caller's role in it. */
  readonly role: EditionRole;
}

export interface Project {
  readonly projectId: string;
  readonly editionId: string;
  readonly courseCode: string;
  readonly editionLabel: string;
  readonly slug: string;
  readonly title: string;
  readonly kind: string;
  /** Null: a draft, which only staff see. */
  readonly availableAfter: string | null;
  /** When work is due. Null: no deadline. Later submissions are accepted
   *  until `closesAt`, and read as late. */
  readonly deadline: string | null;
  /** When the window closes and the project disappears for students. Null:
   *  never. */
  readonly closesAt: string | null;
  /** Whether the deadline has passed: a submission now would be late. */
  readonly late: boolean;
  readonly role: EditionRole;
  /** Whether a starter has been released and the caller may download it. */
  readonly starterReady: boolean;
  /** Whether the caller may submit right now. Only ever true for a student. */
  readonly canSubmit: boolean;
  /** How many submissions the caller has made to it. */
  readonly mySubmissions: number;
  readonly myLastSubmittedAt: string | null;
}

export interface Author {
  readonly userId: string;
  readonly fullName: string | null;
  readonly githubLogin: string | null;
  /** The address they were enrolled with; null when the caller may not see
   *  it or the enrolment is gone. */
  readonly email: string | null;
}

export interface Submission {
  readonly submissionId: string;
  readonly projectId: string;
  readonly submittedAt: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly author: Author;
  /** Whether this is the author's newest submission to the project: the
   *  one that counts. */
  readonly latest: boolean;
  /** Whether it arrived after the deadline, as the deadline is now. */
  readonly late: boolean;
}

export interface Release {
  readonly releaseId: string;
  readonly label: string;
  readonly commit: string | null;
  readonly starterSize: number;
  readonly teacherSize: number;
  readonly uploadedAt: string;
  readonly uploadedBy: string | null;
  readonly viaToken: boolean;
}

export interface Member {
  readonly email: string;
  readonly role: EditionRole;
  readonly source: string;
  /** Null until the address has logged in. */
  readonly userId: string | null;
  readonly fullName: string | null;
  readonly githubLogin: string | null;
}

export interface Accepted {
  readonly submissionId: string;
  readonly byteSize: number;
  readonly sha256: string;
}

export interface Published {
  readonly releaseId: string;
  readonly starter: { readonly size: number; readonly sha256: string };
  readonly teacher: { readonly size: number; readonly sha256: string };
}

/** The public half of the registry's Auth configuration: what a browser
 *  login needs, and nothing secret. */
export interface AuthConfig {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
}

/** A response that is not what this version expects. */
export class Unexpected extends Error {}

type Obj = Record<string, unknown>;

function obj(v: unknown, where: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Unexpected(`the registry answered ${where} as something other than an object`);
  return v as Obj;
}
function str(o: Obj, k: string, where: string): string {
  const v = o[k];
  if (typeof v !== 'string') throw new Unexpected(`the registry answered ${where}.${k} as ${typeof v}, not text`);
  return v;
}
function strOrNull(o: Obj, k: string, where: string): string | null {
  return o[k] === null || o[k] === undefined ? null : str(o, k, where);
}
function num(o: Obj, k: string, where: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Unexpected(`the registry answered ${where}.${k} as ${typeof v}, not a number`);
  return v;
}
function bool(o: Obj, k: string, where: string): boolean {
  const v = o[k];
  if (typeof v !== 'boolean') throw new Unexpected(`the registry answered ${where}.${k} as ${typeof v}, not true or false`);
  return v;
}
function role(o: Obj, k: string, where: string): EditionRole {
  const v = str(o, k, where);
  if (v !== 'student' && v !== 'assistant' && v !== 'owner') throw new Unexpected(`the registry answered ${where}.${k} as "${v}", not a role`);
  return v;
}
function list<T>(v: unknown, where: string, item: (v: unknown, where: string) => T): T[] {
  if (!Array.isArray(v)) throw new Unexpected(`the registry answered ${where} as something other than a list`);
  return v.map((x, i) => item(x, `${where}[${i}]`));
}

export function decodeMe(v: unknown, w = 'me'): Me {
  const o = obj(v, w);
  return { userId: str(o, 'userId', w), email: strOrNull(o, 'email', w), fullName: strOrNull(o, 'fullName', w), githubLogin: strOrNull(o, 'githubLogin', w), platformRole: str(o, 'platformRole', w) };
}

export function decodeEdition(v: unknown, w = 'edition'): Edition {
  const o = obj(v, w);
  return { editionId: str(o, 'editionId', w), courseCode: str(o, 'courseCode', w), courseTitle: str(o, 'courseTitle', w), label: str(o, 'label', w), archived: bool(o, 'archived', w), role: role(o, 'role', w) };
}

export function decodeProject(v: unknown, w = 'project'): Project {
  const o = obj(v, w);
  return {
    projectId: str(o, 'projectId', w), editionId: str(o, 'editionId', w), courseCode: str(o, 'courseCode', w), editionLabel: str(o, 'editionLabel', w),
    slug: str(o, 'slug', w), title: str(o, 'title', w), kind: str(o, 'kind', w),
    availableAfter: strOrNull(o, 'availableAfter', w), deadline: strOrNull(o, 'deadline', w), closesAt: strOrNull(o, 'closesAt', w),
    late: bool(o, 'late', w), role: role(o, 'role', w),
    starterReady: bool(o, 'starterReady', w), canSubmit: bool(o, 'canSubmit', w),
    mySubmissions: num(o, 'mySubmissions', w), myLastSubmittedAt: strOrNull(o, 'myLastSubmittedAt', w),
  };
}

export function decodeSubmission(v: unknown, w = 'submission'): Submission {
  const o = obj(v, w);
  const a = obj(o['author'], `${w}.author`);
  const aw = `${w}.author`;
  return {
    submissionId: str(o, 'submissionId', w), projectId: str(o, 'projectId', w), submittedAt: str(o, 'submittedAt', w),
    byteSize: num(o, 'byteSize', w), sha256: str(o, 'sha256', w), latest: bool(o, 'latest', w), late: bool(o, 'late', w),
    author: { userId: str(a, 'userId', aw), fullName: strOrNull(a, 'fullName', aw), githubLogin: strOrNull(a, 'githubLogin', aw), email: strOrNull(a, 'email', aw) },
  };
}

export function decodeRelease(v: unknown, w = 'release'): Release {
  const o = obj(v, w);
  return {
    releaseId: str(o, 'releaseId', w), label: str(o, 'label', w), commit: strOrNull(o, 'commit', w), starterSize: num(o, 'starterSize', w),
    teacherSize: num(o, 'teacherSize', w), uploadedAt: str(o, 'uploadedAt', w), uploadedBy: strOrNull(o, 'uploadedBy', w), viaToken: bool(o, 'viaToken', w),
  };
}

export function decodeMember(v: unknown, w = 'member'): Member {
  const o = obj(v, w);
  return { email: str(o, 'email', w), role: role(o, 'role', w), source: str(o, 'source', w), userId: strOrNull(o, 'userId', w), fullName: strOrNull(o, 'fullName', w), githubLogin: strOrNull(o, 'githubLogin', w) };
}

export function decodeAccepted(v: unknown, w = 'submission'): Accepted {
  const o = obj(v, w);
  return { submissionId: str(o, 'submissionId', w), byteSize: num(o, 'byteSize', w), sha256: str(o, 'sha256', w) };
}

export function decodePublished(v: unknown, w = 'release'): Published {
  const o = obj(v, w);
  const s = obj(o['starter'], `${w}.starter`);
  const t = obj(o['teacher'], `${w}.teacher`);
  return {
    releaseId: str(o, 'releaseId', w),
    starter: { size: num(s, 'size', `${w}.starter`), sha256: str(s, 'sha256', `${w}.starter`) },
    teacher: { size: num(t, 'size', `${w}.teacher`), sha256: str(t, 'sha256', `${w}.teacher`) },
  };
}

export function decodeAuthConfig(v: unknown, w = 'auth config'): AuthConfig {
  const o = obj(v, w);
  return { supabaseUrl: str(o, 'supabaseUrl', w), publishableKey: str(o, 'publishableKey', w) };
}

export const decodeList = <T>(item: (v: unknown, where: string) => T, where: string) => (v: unknown): T[] => list(v, where, item);
