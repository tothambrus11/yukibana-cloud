import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { configJSONSchema, SCHEMA_URL } from '../src/lib/yukibana.js';

test('the published JSON schema is the one the parser checks with, generated from it', async () => {
  const committed = await readFile(new URL('../../docs/yukibana.schema.json', import.meta.url), 'utf8');
  // A Windows checkout may have turned the newlines round.
  assert.equal(committed.replaceAll('\r\n', '\n'), `${JSON.stringify(configJSONSchema(), null, 2)}\n`, 'docs/yukibana.schema.json is stale: run `npm run schema` in cli/');
});

test('the schema says where it lives and what a file must have', () => {
  const schema = configJSONSchema();
  assert.equal(schema['$id'], SCHEMA_URL);
  assert.deepEqual(schema['required'], ['version', 'kind']);
});
