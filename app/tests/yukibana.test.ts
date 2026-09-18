import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_MAX_BYTES, excludes, manifestProblems, parseConfig, starterConfig } from '../src/lib/yukibana.js';

const ok = (text: string) => {
  const p = parseConfig(text);
  assert.ok(p.ok, p.ok ? '' : p.error);
  return p.config;
};
const bad = (text: string) => {
  const p = parseConfig(text);
  assert.ok(!p.ok, 'expected a rejection');
  return p.error;
};

test('the smallest valid file is a version and a kind', () => {
  const c = ok('{"version":1,"kind":"scala-sbt"}');
  assert.equal(c.kind, 'scala-sbt');
  assert.deepEqual(c.hidden, []);
  assert.equal(c.submission.maxBytes, DEFAULT_MAX_BYTES);
});

test('every rejection names the field the teacher has to fix', () => {
  assert.match(bad('not json'), /not JSON/);
  assert.match(bad('[]'), /must be an object/);
  assert.match(bad('{"version":2,"kind":"rust-cargo"}'), /"version"/);
  assert.match(bad('{"version":1,"kind":"python"}'), /"kind" must be one of rust-cargo, scala-sbt/);
  assert.match(bad('{"version":1,"kind":"rust-cargo","hidden":"tests"}'), /"hidden" must be a list/);
  assert.match(bad('{"version":1,"kind":"rust-cargo","hidden":["../x"]}'), /relative to the repository root/);
  assert.match(bad('{"version":1,"kind":"rust-cargo","submission":{"maxBytes":-1}}'), /"submission.maxBytes"/);
});

test('what is always dropped comes first, then the kind, then the teacher', () => {
  const c = ok('{"version":1,"kind":"scala-sbt","hidden":["src/test/scala/hidden"]}');
  const x = excludes(c);
  assert.deepEqual(x.slice(0, 3), ['.git', '.github', 'yukibana.json']);
  assert.ok(x.includes('project/target'));
  assert.equal(x.at(-1), 'src/test/scala/hidden');
});

test('the starter copy carries the project id and not the hidden paths', () => {
  const c = ok('{"version":1,"kind":"rust-cargo","hidden":["tests/hidden"]}');
  const copy = JSON.parse(starterConfig(c, 'p-1')) as Record<string, unknown>;
  assert.equal(copy['projectId'], 'p-1');
  assert.equal(copy['kind'], 'rust-cargo');
  assert.equal('hidden' in copy, false, 'the copy must not say what was removed');
});

test('a Cargo.toml that names a hidden path is a problem, not a surprise later', () => {
  const c = ok('{"version":1,"kind":"rust-cargo","hidden":["tests/hidden"]}');
  const files: Record<string, string> = {
    'Cargo.toml': '[package]\nname = "x"\n[[test]]\nname = "secret"\npath = "tests/hidden/secret.rs"\n',
  };
  const problems = manifestProblems(c, (p) => files[p]);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /tests\/hidden\/secret.rs/);
  assert.deepEqual(manifestProblems(c, () => undefined), ['Cargo.toml is missing at the repository root']);
  assert.deepEqual(manifestProblems(c, (p) => (p === 'Cargo.toml' ? '[package]\nname = "x"\n' : undefined)), []);
});

test('a workspace member that is hidden is a problem too', () => {
  const c = ok('{"version":1,"kind":"rust-cargo","hidden":["grader"]}');
  const cargo = '[workspace]\nmembers = ["app", "grader"]\n';
  const problems = manifestProblems(c, (p) => (p === 'Cargo.toml' ? cargo : undefined));
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /workspace member "grader"/);
});
