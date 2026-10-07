import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_FILENAME, DEFAULT_MAX_BYTES, excludes, manifestProblems, parseConfig, protectedPaths, sameStudentConfig, starterConfig } from '../src/lib/yukibana.js';

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
  assert.match(bad('{"version":1,"kind":"rust-cargo","hidden":["../x"]}'), /relative to the project root/);
  assert.match(bad('{"version":1,"kind":"rust-cargo","submission":{"maxBytes":-1}}'), /"submission.maxBytes"/);
  assert.match(bad('{"version":1,"kind":"rust-cargo","readOnly":"README.md"}'), /"readOnly" must be a list/);
  assert.match(bad('{"version":1,"kind":"rust-cargo","features":{"ai":"no"}}'), /"features"/);
  assert.match(bad('{"version":1,"kind":"rust-cargo","layout":{"widgets":{"files":1}}}'), /"layout.widgets"/);
  assert.match(bad('{"version":1,"kind":"rust-cargo","openFiles":[1]}'), /"openFiles"/);
  assert.match(bad('{"version":1,"kind":"rust-cargo","submission":{"exclude":["/abs"]}}'), /"submission.exclude" paths are relative/);
  assert.match(bad('{"version":1,"kind":"rust-cargo","submission":{"filename":"a/b.tar.zst"}}'), /"submission.filename"/);
});

test('the IDE settings from the example file are a valid project, with the defaults filled in', () => {
  const p = parseConfig(JSON.stringify({
    version: 1, kind: 'scala-sbt',
    features: { codeSuggestions: true, squiggles: true, ai: false },
    layout: { widgets: { files: false, search: false }, containers: { 'metals-explorer': false } },
    openFiles: ['README.md', 'hello_world.scala'],
    submission: { exclude: ['.metals', '.scala-build'] },
    readOnly: ['tests/*', 'README.md', 'yukibana.json'],
  }));
  assert.ok(p.ok);
  assert.deepEqual(p.warnings, []);
  assert.deepEqual(p.config.readOnly, ['tests/*', 'README.md', 'yukibana.json']);
  assert.equal(p.config.submission.include, null);
  assert.equal(p.config.submission.filename, DEFAULT_FILENAME);
  assert.equal(p.config.projectId, null);
});

test('an unknown field passes with a warning, so a misspelt "hiden" does not ship the tests in silence', () => {
  const p = parseConfig('{"version":1,"kind":"rust-cargo","hiden":["tests/hidden"]}');
  assert.ok(p.ok);
  assert.equal(p.config.hidden.length, 0);
  assert.match(p.warnings[0] ?? '', /unknown field "hiden"/);
});

test('an assembly protects the config itself, the read-only paths and the hidden ones', () => {
  const c = ok('{"version":1,"kind":"rust-cargo","readOnly":["tests/*"],"hidden":["tests/hidden"]}');
  assert.deepEqual(protectedPaths(c), ['yukibana.json', 'tests/*', 'tests/hidden']);
});

test('a student copy that says what the starter said is unchanged, whatever its formatting', () => {
  const c = ok('{"version":1,"kind":"rust-cargo","readOnly":["tests/*"],"hidden":["tests/hidden"]}');
  const copy = starterConfig(c, 'p-1');
  assert.ok(sameStudentConfig(c, copy));
  assert.ok(sameStudentConfig(c, '{"readOnly":["tests/*"],"kind":"rust-cargo","version":1}'), 'key order and the project id do not matter');
  assert.ok(!sameStudentConfig(c, copy.replace('"tests/*"', '"nothing"')), 'an emptied read-only list is a change');
  assert.ok(!sameStudentConfig(c, 'not json'));
});

test('what is always dropped comes first, then the kind, then the teacher', () => {
  const c = ok('{"version":1,"kind":"scala-sbt","hidden":["src/test/scala/hidden"]}');
  const x = excludes(c);
  assert.deepEqual(x.slice(0, 4), ['.git', '.github', '.theia', 'yukibana.json']);
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

test('the schema the IDE validates against and the parser here know the same fields', async () => {
  const { readFile } = await import('node:fs/promises');
  const schema = JSON.parse(await readFile(new URL('../../docs/yukibana.schema.json', import.meta.url), 'utf8')) as { properties: Record<string, unknown>; required: string[] };
  const every = Object.fromEntries(Object.keys(schema.properties).map((k) => [k, k === 'version' ? 1 : k === 'kind' ? 'rust-cargo' : k === 'projectId' ? 'p' : k === 'openFiles' || k === 'readOnly' || k === 'hidden' ? [] : {}]));
  const p = parseConfig(JSON.stringify(every));
  assert.ok(p.ok, p.ok ? '' : p.error);
  assert.deepEqual(p.warnings, [], 'every field the schema has, the parser knows');
  assert.deepEqual(schema.required, ['version', 'kind']);
});
