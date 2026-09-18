/** The contract between a course repository and this service: `yukibana.json`
 *  at the repository root. Everything the builder needs to know about a
 *  project is in that file, so a teacher can see it, version it and review
 *  it with the rest of the assignment.
 *
 *  ```json
 *  {
 *    "version": 1,
 *    "kind": "rust-cargo",
 *    "hidden": ["tests/hidden"],
 *    "submission": { "maxBytes": 33554432 }
 *  }
 *  ```
 *
 *  `kind` names the build system. It chooses what is always stripped from a
 *  starter (build output, editor state) and, later, how a submission is
 *  packed and checked. `hidden` names what students must not receive: the
 *  paths are removed from the starter and, since the starter carries a copy
 *  of this file, from that copy too.
 */

import { matcher } from './glob';

export const KINDS = ['rust-cargo', 'scala-sbt'] as const;
export type Kind = (typeof KINDS)[number];

export interface Config {
  readonly version: 1;
  readonly kind: Kind;
  /** Paths a student must never receive, as globs relative to the root. */
  readonly hidden: readonly string[];
  readonly submission: { readonly maxBytes: number };
}

/** The largest submission accepted when the file does not say. A source
 *  tree without build output is well under a megabyte; the cap is for the
 *  student who tars up `target/`. */
export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/** What can never be in a starter, whatever the kind: the history (which
 *  would contain the hidden tests' every version), the teacher's own CI, and
 *  the config file itself, which is replaced by the copy `starterConfig`
 *  writes. */
export const ALWAYS_EXCLUDED: readonly string[] = ['.git', '.github', 'yukibana.json'];

/** What each build system leaves lying around that no student needs. */
const KIND_EXCLUDED: Record<Kind, readonly string[]> = {
  'rust-cargo': ['target'],
  'scala-sbt': ['target', 'project/target', 'project/project', '.bsp', '.bloop', '.metals', '.idea'],
};

/** Every pattern the starter drops for `config`, hidden paths last. */
export function excludes(config: Config): readonly string[] {
  return [...ALWAYS_EXCLUDED, ...KIND_EXCLUDED[config.kind], ...config.hidden];
}

export type Parsed = { ok: true; config: Config } | { ok: false; error: string };

/** Reads and checks the file. The error is a sentence for the build log,
 *  naming the field, because the teacher reads it and fixes the file. */
export function parseConfig(text: string): Parsed {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `yukibana.json is not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'yukibana.json must be an object' };
  }
  const o = raw as Record<string, unknown>;
  if (o['version'] !== 1) return { ok: false, error: 'yukibana.json: "version" must be 1' };
  const kind = o['kind'];
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: `yukibana.json: "kind" must be one of ${KINDS.join(', ')}` };
  }
  const hidden = o['hidden'] ?? [];
  if (!Array.isArray(hidden) || !hidden.every((h) => typeof h === 'string' && h.length > 0)) {
    return { ok: false, error: 'yukibana.json: "hidden" must be a list of paths' };
  }
  if (hidden.some((h: string) => h.startsWith('/') || h.split('/').includes('..'))) {
    return { ok: false, error: 'yukibana.json: "hidden" paths are relative to the repository root' };
  }
  let maxBytes = DEFAULT_MAX_BYTES;
  const submission = o['submission'];
  if (submission !== undefined) {
    if (typeof submission !== 'object' || submission === null) {
      return { ok: false, error: 'yukibana.json: "submission" must be an object' };
    }
    const m = (submission as Record<string, unknown>)['maxBytes'];
    if (m !== undefined) {
      if (typeof m !== 'number' || !Number.isInteger(m) || m <= 0) {
        return { ok: false, error: 'yukibana.json: "submission.maxBytes" must be a positive integer' };
      }
      maxBytes = m;
    }
  }
  return { ok: true, config: { version: 1, kind: kind as Kind, hidden: hidden as string[], submission: { maxBytes } } };
}

/** The copy of the file a starter carries: the same contract minus the
 *  hidden paths (which would name what they hide) plus the project id, so an
 *  IDE extension knows where a submission goes without parsing a URL. */
export function starterConfig(config: Config, projectId: string): string {
  return JSON.stringify(
    { version: 1, kind: config.kind, projectId, submission: config.submission },
    null,
    2,
  ) + '\n';
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
