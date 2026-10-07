/** The contract between a course repository and this service: `yukibana.cfg`
 *  at the project root. It is the file the student's IDE reads (which
 *  widgets it shows, which files open, which are read-only), and the builder
 *  reads the same file for what a student must never receive and what a
 *  submission holds. `docs/yukibana.schema.json` is its schema and
 *  `docs/yukibana-cfg.md` the prose.
 *
 *  ```json
 *  {
 *    "openFiles": ["README.md", "hello_world.scala"],
 *    "readOnly": ["tests/*", "README.md", "yukibana.cfg"],
 *    "hidden": ["tests/hidden"],
 *    "submission": { "exclude": [".metals", ".scala-build"] }
 *  }
 *  ```
 *
 *  Every field has a default, so `{}` is a valid file. What the IDE alone
 *  reads (`features`, `layout`, `openFiles`) is checked for its type and
 *  passed through untouched into the starter's copy.
 */

import { matcher } from './glob.js';

/** The file's name, at the project root, in the repository and in every
 *  starter. */
export const CONFIG_FILE = 'yukibana.cfg';

export interface SubmissionRules {
  /** When not null, only paths matching one of these are submitted. */
  readonly include: readonly string[] | null;
  /** Never submitted, whatever `include` says. */
  readonly exclude: readonly string[];
  /** What a packed submission is called on disk. Only a name: the bytes are
   *  always a zstandard-compressed tar, because that is what the registry
   *  accepts. */
  readonly filename: string;
}

export interface Config {
  /** Paths a student must never receive, as globs relative to the root. */
  readonly hidden: readonly string[];
  /** Paths a student receives and may not change. An assembly replaces what
   *  a submission holds under them with the teacher's version. */
  readonly readOnly: readonly string[];
  readonly submission: SubmissionRules;
  /** The registry project this folder submits to. Only a starter's copy has
   *  one (`starterConfig` writes it); in a course repository it is null. */
  readonly projectId: string | null;
  /** The parsed file as written, so the starter's copy carries the IDE's
   *  fields exactly, including ones this version does not know. */
  readonly raw: Readonly<Record<string, unknown>>;
}

/** What `submission.filename` is when the file does not say. */
export const DEFAULT_FILENAME = 'submission.tar.zst';

/** What can never be in a starter: the history (which would contain the
 *  hidden tests' every version), the teacher's own CI, and the config file
 *  itself, which is replaced by the copy `starterConfig` writes. */
export const ALWAYS_EXCLUDED: readonly string[] = ['.git', '.github', CONFIG_FILE];

/** What a build tool leaves lying around in a checkout, and no archive
 *  carries, starter or teacher. A teacher builds from their working tree,
 *  not from git, so this is what keeps a local `target/` out of a release.
 *  Paths at the root only: a `target` directory deeper down may be source. */
export const BUILD_OUTPUT: readonly string[] = [
  'target', 'project/target', 'project/project', '.bsp', '.bloop', '.metals', '.scala-build', 'node_modules',
];

/** Every pattern the starter drops for `config`, hidden paths last. */
export function excludes(config: Config): readonly string[] {
  return [...ALWAYS_EXCLUDED, ...BUILD_OUTPUT, ...config.hidden];
}

/** What a teacher assembly takes from the teacher's version rather than the
 *  student's: everything read-only, everything hidden, and this file, which
 *  decides the rest and so is never the student's to say. */
export function protectedPaths(config: Config): readonly string[] {
  return [CONFIG_FILE, ...config.readOnly, ...config.hidden];
}

export type Parsed =
  | { ok: true; config: Config; warnings: readonly string[] }
  | { ok: false; error: string };

/** The top-level fields this version knows. Anything else is passed through
 *  to the starter with a warning: the IDE may know a field the CLI does not,
 *  and a typo like "hiden" should not pass in silence. */
const KNOWN = new Set(['features', 'layout', 'openFiles', 'readOnly', 'hidden', 'projectId', 'submission']);

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

  const openFiles = strings(raw['openFiles'] ?? []);
  if (openFiles === null) return bad('"openFiles" must be a list of paths');
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

  return {
    ok: true,
    warnings,
    config: { hidden: lists.hidden, readOnly: lists.readOnly, submission: { include, exclude, filename }, projectId, raw },
  };
}

function strings(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : null;
}

/** A list of globs, or what is wrong with it as the end of a sentence. */
function globs(v: unknown): string[] | string {
  const list = strings(v);
  if (list === null || list.some((s) => s === '')) return 'must be a list of paths';
  if (list.some((s) => s.startsWith('/') || s.split('/').includes('..'))) return 'paths are relative to the project root';
  return list;
}

/** The copy of the file a starter carries: the same file minus `hidden`
 *  (which would name what it hides) plus the project id, so the IDE and
 *  `yukibana submit` know where a submission goes. */
export function starterConfig(config: Config, projectId: string): string {
  const copy: Record<string, unknown> = { ...config.raw };
  delete copy['hidden'];
  copy['projectId'] = projectId;
  return JSON.stringify(copy, null, 4) + '\n';
}

/** Ways a repository can defeat the starter: a build manifest that names a
 *  hidden path. Deleting the file would then leave a manifest pointing at
 *  nothing, and the starter would not build. For now the rule is that hidden
 *  tests must be auto-discovered; rewriting manifests is the extension point
 *  this function will grow into. `read` returns a file's text by path, or
 *  undefined. Only Cargo names paths this way; sbt and scala-cli discover
 *  sources by directory. */
export function manifestProblems(config: Config, read: (path: string) => string | undefined): string[] {
  const hidden = matcher(config.hidden);
  const problems: string[] = [];
  const cargo = read('Cargo.toml');
  if (cargo === undefined) return problems;
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
  return problems;
}
