/** The contract between a course repository and this service: `yukibana.json`
 *  at the project root. It is the file the student's IDE (our Theia fork)
 *  reads for which widgets it shows, which files open and which are
 *  read-only, and the file the builder reads for the build system, what a
 *  student must never receive and what a submission holds.
 *  `docs/yukibana.schema.json` is its schema and `docs/yukibana-json.md`
 *  the prose.
 *
 *  ```json
 *  {
 *    "version": 1,
 *    "kind": "scala-sbt",
 *    "openFiles": ["README.md", "src/main/scala/Main.scala"],
 *    "readOnly": ["src/test/**", "README.md", "yukibana.json"],
 *    "hidden": ["src/test/scala/hidden"],
 *    "submission": { "exclude": [".scala-build"] }
 *  }
 *  ```
 *
 *  One zod schema (`configSchema`) checks the whole file, the IDE's fields
 *  with the IDE's defaults included, and the IDE parses the file with it
 *  (`settingsSchema`, the part it reads), so the two cannot disagree about
 *  what a field means. It is the whole of `zod`, not `zod/mini`: the
 *  mini build saved a few dozen KB in bundles that are hundreds of MB,
 *  at the price of a terser API nobody else here writes.
 *  The starter's copy is the file as written, so a
 *  field this version does not know passes through untouched.
 */

import * as z from 'zod';
// The function form of .default(), which zod spells _default, since default is a keyword.
import { _default as withDefault } from 'zod';
import { matcher } from './glob.js';

/** The file's name, at the project root, in the repository and in every
 *  starter. */
export const CONFIG_FILE = 'yukibana.json';

export const KINDS = ['rust-cargo', 'scala-sbt'] as const;
export type Kind = (typeof KINDS)[number];

export interface SubmissionRules {
  /** When not null, only paths matching one of these are submitted. */
  readonly include: readonly string[] | null;
  /** Never submitted, on top of what is never submitted for any project
   *  (`NEVER_SUBMITTED`) and what the kind's build leaves (`buildOutput`). */
  readonly exclude: readonly string[];
  /** `true` iff what the project's `.gitignore` files ignore is not
   *  submitted either, as git would leave it out of a commit. */
  readonly respectGitignore: boolean;
  /** Where the IDE sends a submission: `cloud`, the registry, or `file`, an
   *  archive the student saves. The CLI always sends to the registry. */
  readonly target: string;
  /** What a packed submission is called on disk. Only a name: the bytes are
   *  always a gzipped tar, because that is what the registry accepts. */
  readonly filename: string;
  /** The largest submission this project expects, in bytes. The registry
   *  has its own cap above which this cannot go. */
  readonly maxBytes: number;
}

/** Which of the IDE's helpers a project has on. */
export interface Features {
  readonly codeSuggestions: boolean;
  /** Error and warning underlines in the editor. */
  readonly squiggles: boolean;
  readonly ai: boolean;
}

/** Which of the IDE's views a project shows; each is shown unless set false. */
export interface Widgets {
  readonly files: boolean;
  readonly search: boolean;
  readonly vcs: boolean;
  readonly debug: boolean;
  readonly testing: boolean;
  readonly outline: boolean;
  readonly aiChat: boolean;
}

/** How the IDE lays out a project's window. */
export interface Layout {
  readonly widgets: Widgets;
  /** View containers by id, shown iff true; one not named is left as it is. */
  readonly containers: Readonly<Record<string, boolean>>;
  /** Views by id, shown iff true; one not named is left as it is. */
  readonly views: Readonly<Record<string, boolean>>;
}

/** What a student's folder is set up with: the fields the IDE reads, each
 *  with its default when the file leaves it out. */
export interface Settings {
  /** The file the IDE opens as the assignment, relative to the root. */
  readonly assignmentFile: string;
  readonly features: Features;
  readonly layout: Layout;
  /** Files the IDE opens when the project opens. */
  readonly openFiles: readonly string[];
  /** Paths a student receives and may not change. An assembly replaces what
   *  a submission holds under them with the teacher's version, and says so
   *  when the two differ. */
  readonly readOnly: readonly string[];
  readonly submission: SubmissionRules;
  /** The registry project this folder submits to. Only a starter's copy has
   *  one (`starterConfig` writes it); in a course repository it is null. */
  readonly projectId: string | null;
}

/** The whole file, as a course repository and a starter carry it. */
export interface Config extends Settings {
  readonly version: 1;
  readonly kind: Kind;
  /** Paths a student must never receive, as globs relative to the root. */
  readonly hidden: readonly string[];
  /** The release this folder's starter was, as `yukibana build` and
   *  `publish` wrote it before uploading, so it is the release row's own id.
   *  A submission sends it, and grading compares the student's read-only
   *  files with that release rather than the newest. Null in a course
   *  repository, in a starter from before releases carried ids, and in one
   *  built only to check. A student can edit it, so it is a claim: the
   *  registry keeps it only when it names a release of the same project. */
  readonly releaseId: string | null;
  /** The parsed file as written, so the starter's copy carries the IDE's
   *  fields exactly, including ones this version does not know. */
  readonly raw: Readonly<Record<string, unknown>>;
}

/** The largest submission accepted when the file does not say. A source
 *  tree without build output is well under a megabyte; the cap is for the
 *  student who tars up `target/`. */
export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/** What `submission.filename` is when the file does not say. */
export const DEFAULT_FILENAME = 'submission.tar.gz';

/** The IDE's own state. Everything the IDE is set up with is declared in
 *  this file and read by the Theia fork, so a `.theia` folder is only ever
 *  one person's leftovers: it is in no archive and no submission. */
export const IDE_STATE = '.theia';

/** What can never be in a starter: the history (which would contain the
 *  hidden tests' every version), the teacher's own CI, the IDE's state, and
 *  the config file itself, which is replaced by the copy `starterConfig`
 *  writes. */
export const ALWAYS_EXCLUDED: readonly string[] = ['.git', '.github', IDE_STATE, CONFIG_FILE];

/** What no submission carries, whatever the project says: a student's
 *  history is theirs and can be large, the IDE's state is not work, and
 *  what a package manager installed is not the student's either. */
export const NEVER_SUBMITTED: readonly string[] = ['.git', IDE_STATE, '**/node_modules'];

/** What each build system leaves lying around that no archive carries,
 *  starter, teacher or submission. A teacher builds from their working
 *  tree, not from git, so this is what keeps a local `target/` out of a
 *  release. Paths at the root only. */
const KIND_OUTPUT: Record<Kind, readonly string[]> = {
  'rust-cargo': ['target'],
  'scala-sbt': ['target', 'project/target', 'project/project', '.bsp', '.bloop', '.metals', '.scala-build', '.idea'],
};

export function buildOutput(kind: Kind): readonly string[] {
  return KIND_OUTPUT[kind];
}

/** Every pattern the starter drops for `config`, hidden paths last. */
export function excludes(config: Config): readonly string[] {
  return [...ALWAYS_EXCLUDED, ...KIND_OUTPUT[config.kind], ...config.hidden];
}

/** What a teacher assembly takes from the teacher's version rather than the
 *  student's: this file, which decides the rest and so is never the
 *  student's to say, everything read-only and everything hidden. */
export function protectedPaths(config: Config): readonly string[] {
  return [CONFIG_FILE, ...config.readOnly, ...config.hidden];
}

export type Parsed =
  | { ok: true; config: Config; warnings: readonly string[] }
  | { ok: false; error: string };

/** `true` iff `s` is a uuid, in any case. Release ids are the database's
 *  uuids, so this is the whole check the CLI can make of one. */
export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

const bool = z.boolean({ error: 'must be true or false' });
const on = withDefault(bool, true);
const flags = z.record(z.string(), bool, { error: 'must be an object of true and false' });
const paths = z.array(z.string({ error: 'must be a list of paths' }), { error: 'must be a list of paths' });
/** A list of globs relative to the project root. */
const globs = paths.check(
  z.refine((list: string[]) => list.every((s) => s !== ''), 'must be a list of paths'),
  z.refine((list: string[]) => !list.some((s) => s.startsWith('/') || s.split('/').includes('..')), 'paths are relative to the project root'),
);

/** The fields of `Settings`, as the file spells them, with their defaults. */
const settingsShape = {
  assignmentFile: withDefault(z.string({ error: 'must be a path' }), 'ASSIGNMENT.md'),
  features: z.prefault(z.object({ codeSuggestions: on, squiggles: on, ai: on }, { error: 'must be an object of true and false' }), {}),
  layout: z.prefault(z.object({
    widgets: z.prefault(z.object({ files: on, search: on, vcs: on, debug: on, testing: on, outline: on, aiChat: on }, { error: 'must be an object of true and false' }), {}),
    containers: withDefault(flags, {}),
    views: withDefault(flags, {}),
  }, { error: 'must be an object' }), {}),
  openFiles: withDefault(paths, []),
  readOnly: withDefault(globs, []),
  submission: z.prefault(z.object({
    include: withDefault(z.nullable(globs), null),
    exclude: withDefault(globs, []),
    respectGitignore: withDefault(bool, true),
    target: withDefault(z.string({ error: 'must be a submission target' }), 'cloud'),
    filename: withDefault(z.string({ error: 'must be a file name, without a directory' }).check(
      z.refine((name: string) => name !== '' && !/[/\\]/.test(name), 'must be a file name, without a directory'),
    ), DEFAULT_FILENAME),
    maxBytes: withDefault(z.number({ error: 'must be a positive integer' }).check(
      z.refine((n: number) => Number.isInteger(n) && n > 0, 'must be a positive integer'),
    ), DEFAULT_MAX_BYTES),
  }, { error: 'must be an object' }), {}),
  projectId: withDefault(z.nullable(z.string({ error: 'must be a project id' }).check(z.minLength(1, 'must be a project id'))), null),
};

/** What the IDE reads from the file: every field optional, so a folder whose
 *  file says nothing, or that has none, still opens with defaults. */
export const settingsSchema = z.object(settingsShape);

/** The whole file: `settingsSchema` plus what a release is built from. */
export const configSchema = z.object({
  version: z.literal(1, { error: 'must be 1' }),
  kind: z.enum(KINDS, { error: `must be one of ${KINDS.join(', ')}` }),
  hidden: withDefault(globs, []),
  releaseId: withDefault(z.nullable(z.string({ error: 'must be a release id, a uuid' }).check(z.refine(isUuid, 'must be a release id, a uuid'))), null),
  ...settingsShape,
});

/** The top-level fields this version knows. Anything else is passed through
 *  to the starter with a warning: the IDE may know a field the CLI does not,
 *  and a typo like "hiden" should not pass in silence. */
const KNOWN = new Set(Object.keys(configSchema.shape));

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Returns the first of `issues` as a sentence naming the field, because
 *  the teacher reads it and fixes the file. */
function sentence(issues: readonly z.core.$ZodIssue[]): string {
  const issue = issues[0];
  const field = issue?.path.filter((p) => typeof p === 'string').join('.') ?? '';
  const what = issue?.message ?? 'is not valid';
  return field === '' ? `${CONFIG_FILE} ${what}` : `${CONFIG_FILE}: "${field}" ${what}`;
}

/** Returns `text` as a JSON object, or why it is not one. */
function objectOf(text: string): { ok: true; raw: Record<string, unknown> } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `${CONFIG_FILE} is not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  return isObject(raw) ? { ok: true, raw } : { ok: false, error: `${CONFIG_FILE} must be an object` };
}

/** Returns the file `text` checked, with its defaults, or why it is not
 *  valid, as a sentence naming the field. */
export function parseConfig(text: string): Parsed {
  const read = objectOf(text);
  if (!read.ok) return read;
  const parsed = configSchema.safeParse(read.raw);
  if (!parsed.success) return { ok: false, error: sentence(parsed.error.issues) };
  const warnings = Object.keys(read.raw).filter((k) => !KNOWN.has(k)).map((k) => `${CONFIG_FILE}: unknown field "${k}" is passed through as it is`);
  const config: Config = { ...parsed.data, releaseId: parsed.data.releaseId?.toLowerCase() ?? null, raw: read.raw };
  return { ok: true, config, warnings };
}

/** Returns what the IDE reads from `text`, a `yukibana.json`, or why it
 *  cannot. Unlike `parseConfig`, a file without `version` or `kind` is
 *  fine: the IDE opens any folder. */
export function parseSettings(text: string): { ok: true; settings: Settings } | { ok: false; error: string } {
  const read = objectOf(text);
  if (!read.ok) return read;
  const parsed = settingsSchema.safeParse(read.raw);
  return parsed.success ? { ok: true, settings: parsed.data } : { ok: false, error: sentence(parsed.error.issues) };
}

/** What the IDE is set up with in a folder without a `yukibana.json`. */
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

/** The fields of the starter's copy: the file minus `hidden` (which would
 *  name what it hides) and minus any `projectId` or `releaseId` the
 *  repository had, which only a build may write. */
function studentFields(raw: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...raw };
  delete copy['hidden'];
  delete copy['projectId'];
  delete copy['releaseId'];
  return copy;
}

/** The copy of the file a starter carries: the same file minus `hidden`
 *  plus the project id, so the IDE and `yukibana submit` know where a
 *  submission goes, and the release id, so a submission says which
 *  release it started from. An empty `projectId` (a build that was not told
 *  the project) leaves the field out: it once wrote `""`, which the parser
 *  rightly refuses, and a student could not submit from that folder at all.
 *  A null `releaseId` (a build that is only a check) leaves its field out
 *  likewise. */
export function starterConfig(config: Config, projectId: string, releaseId: string | null): string {
  const fields: Record<string, unknown> = studentFields(config.raw);
  if (projectId !== '') fields['projectId'] = projectId;
  if (releaseId !== null) fields['releaseId'] = releaseId;
  return JSON.stringify(fields, null, 2) + '\n';
}

/** Whether a student's copy of the file says what the starter's copy said,
 *  `projectId`, `releaseId` and formatting aside. The release id differs
 *  from one release to the next by design, so it is not a change the
 *  student made; whether it names the right release is the download's
 *  question, not this one. An assembly asks this to tell a
 *  student who changed their read-only list from one who did not; the copy
 *  is replaced by the teacher's either way. */
export function sameStudentConfig(teacher: Config, studentText: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(studentText);
  } catch {
    return false;
  }
  if (!isObject(parsed)) return false;
  return canonical(studentFields(parsed)) === canonical(studentFields(teacher.raw));
}

/** JSON with object keys sorted, so two files that say the same thing in a
 *  different order compare equal. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObject(v)) return `{${Object.keys(v).toSorted().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** Ways a repository can defeat the starter: a build manifest that names a
 *  hidden path. Deleting the file would then leave a manifest pointing at
 *  nothing, and the starter would not build. For now the rule is that hidden
 *  tests must be auto-discovered; rewriting manifests is the per-kind
 *  extension point this function will grow into. `read` returns a file's
 *  text by path, or undefined. */
export function manifestProblems(config: Config, read: (path: string) => string | undefined): string[] {
  const hidden = matcher(config.hidden);
  const problems: string[] = [];
  if (config.kind === 'rust-cargo') {
    const cargo = read('Cargo.toml');
    if (cargo === undefined) {
      problems.push('Cargo.toml is missing at the repository root');
      return problems;
    }
    for (const m of cargo.matchAll(/\bpath\s*=\s*"([^"]+)"/g)) {
      const p = m[1] ?? '';
      if (hidden(p)) problems.push(`Cargo.toml names the hidden path "${p}"; hidden tests must be auto-discovered`);
    }
    const members = /\bmembers\s*=\s*\[([^\]]*)\]/.exec(cargo);
    if (members) {
      for (const m of (members[1] ?? '').matchAll(/"([^"]+)"/g)) {
        const p = m[1] ?? '';
        if (hidden(p)) problems.push(`Cargo.toml lists the hidden workspace member "${p}"`);
      }
    }
  } else {
    if (read('build.sbt') === undefined) problems.push('build.sbt is missing at the repository root');
  }
  return problems;
}
