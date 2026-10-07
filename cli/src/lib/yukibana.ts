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
 *  What the IDE alone reads (`features`, `layout`, `openFiles`) is checked
 *  for its type and passed through untouched into the starter's copy.
 */

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
  /** What a packed submission is called on disk. Only a name: the bytes are
   *  always a zstandard-compressed tar, because that is what the registry
   *  accepts. */
  readonly filename: string;
  /** The largest submission this project expects, in bytes. The registry
   *  has its own cap above which this cannot go. */
  readonly maxBytes: number;
}

export interface Config {
  readonly version: 1;
  readonly kind: Kind;
  /** Paths a student must never receive, as globs relative to the root. */
  readonly hidden: readonly string[];
  /** Paths a student receives and may not change. An assembly replaces what
   *  a submission holds under them with the teacher's version, and says so
   *  when the two differ. */
  readonly readOnly: readonly string[];
  readonly submission: SubmissionRules;
  /** The registry project this folder submits to. Only a starter's copy has
   *  one (`starterConfig` writes it); in a course repository it is null. */
  readonly projectId: string | null;
  /** The parsed file as written, so the starter's copy carries the IDE's
   *  fields exactly, including ones this version does not know. */
  readonly raw: Readonly<Record<string, unknown>>;
}

/** The largest submission accepted when the file does not say. A source
 *  tree without build output is well under a megabyte; the cap is for the
 *  student who tars up `target/`. */
export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/** What `submission.filename` is when the file does not say. */
export const DEFAULT_FILENAME = 'submission.tar.zst';

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
 *  history is theirs and can be large, and the IDE's state is not work. */
export const NEVER_SUBMITTED: readonly string[] = ['.git', IDE_STATE];

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

/** The top-level fields this version knows. Anything else is passed through
 *  to the starter with a warning: the IDE may know a field the CLI does not,
 *  and a typo like "hiden" should not pass in silence. */
const KNOWN = new Set(['version', 'kind', 'features', 'layout', 'openFiles', 'readOnly', 'hidden', 'projectId', 'submission']);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads and checks the file. The error is a sentence for the terminal,
 *  naming the field, because the teacher reads it and fixes the file. */
export function parseConfig(text: string): Parsed {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `${CONFIG_FILE} is not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!isObject(raw)) return { ok: false, error: `${CONFIG_FILE} must be an object` };
  const bad = (what: string): Parsed => ({ ok: false, error: `${CONFIG_FILE}: ${what}` });
  const warnings = Object.keys(raw).filter((k) => !KNOWN.has(k)).map((k) => `${CONFIG_FILE}: unknown field "${k}" is passed through as it is`);

  if (raw['version'] !== 1) return bad('"version" must be 1');
  const kind = raw['kind'];
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return bad(`"kind" must be one of ${KINDS.join(', ')}`);

  const features = raw['features'] ?? {};
  if (!isObject(features) || !Object.values(features).every((v) => typeof v === 'boolean')) {
    return bad('"features" must be an object of true and false');
  }
  const layout = raw['layout'] ?? {};
  if (!isObject(layout)) return bad('"layout" must be an object');
  for (const part of ['widgets', 'containers', 'views'] as const) {
    const v = layout[part] ?? {};
    if (!isObject(v) || !Object.values(v).every((b) => typeof b === 'boolean')) {
      return bad(`"layout.${part}" must be an object of true and false`);
    }
  }

  if (strings(raw['openFiles'] ?? []) === null) return bad('"openFiles" must be a list of paths');
  const lists: Record<'readOnly' | 'hidden', readonly string[]> = { readOnly: [], hidden: [] };
  for (const name of ['readOnly', 'hidden'] as const) {
    const list = globs(raw[name] ?? []);
    if (typeof list === 'string') return bad(`"${name}" ${list}`);
    lists[name] = list;
  }

  const projectId = raw['projectId'] ?? null;
  if (projectId !== null && (typeof projectId !== 'string' || projectId === '')) return bad('"projectId" must be a project id');

  const submission = raw['submission'] ?? {};
  if (!isObject(submission)) return bad('"submission" must be an object');
  let include: readonly string[] | null = null;
  if (submission['include'] !== undefined) {
    const list = globs(submission['include']);
    if (typeof list === 'string') return bad(`"submission.include" ${list}`);
    include = list;
  }
  const exclude = globs(submission['exclude'] ?? []);
  if (typeof exclude === 'string') return bad(`"submission.exclude" ${exclude}`);
  const filename = submission['filename'] ?? DEFAULT_FILENAME;
  if (typeof filename !== 'string' || filename === '' || /[/\\]/.test(filename)) {
    return bad('"submission.filename" must be a file name, without a directory');
  }
  const maxBytes = submission['maxBytes'] ?? DEFAULT_MAX_BYTES;
  if (typeof maxBytes !== 'number' || !Number.isInteger(maxBytes) || maxBytes <= 0) {
    return bad('"submission.maxBytes" must be a positive integer');
  }

  return {
    ok: true,
    warnings,
    config: {
      version: 1,
      kind: kind as Kind,
      hidden: lists.hidden,
      readOnly: lists.readOnly,
      submission: { include, exclude, filename, maxBytes },
      projectId,
      raw,
    },
  };
}

function strings(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((s) => typeof s === 'string') ? v : null;
}

/** A list of globs, or what is wrong with it as the end of a sentence. */
function globs(v: unknown): string[] | string {
  const list = strings(v);
  if (list === null || list.some((s) => s === '')) return 'must be a list of paths';
  if (list.some((s) => s.startsWith('/') || s.split('/').includes('..'))) return 'paths are relative to the project root';
  return list;
}

/** The fields of the starter's copy: the file minus `hidden` (which would
 *  name what it hides) and minus any `projectId` the repository had. */
function studentFields(raw: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...raw };
  delete copy['hidden'];
  delete copy['projectId'];
  return copy;
}

/** The copy of the file a starter carries: the same file minus `hidden`
 *  plus the project id, so the IDE and `yukibana submit` know where a
 *  submission goes. */
export function starterConfig(config: Config, projectId: string): string {
  return JSON.stringify({ ...studentFields(config.raw), projectId }, null, 2) + '\n';
}

/** Whether a student's copy of the file says what the starter's copy said,
 *  `projectId` and formatting aside. An assembly asks this to tell a
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
