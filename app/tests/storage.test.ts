import { expect, test } from 'vitest';
import { credentialProblem, s3Failure } from '../src/lib/server/storage';

const r2 = 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com';
const keyId = 'a'.repeat(32);
const secret = 'b'.repeat(64);

test('R2 credentials of the right shape pass', () => {
  expect(credentialProblem({ endpoint: r2, accessKeyId: keyId, secretAccessKey: secret })).toBeNull();
});

test('the token value pasted as the access key id is named for what it probably is', () => {
  const problem = credentialProblem({ endpoint: r2, accessKeyId: 'x'.repeat(53), secretAccessKey: secret });
  expect(problem).toContain('S3_ACCESS_KEY_ID is 53 characters');
  expect(problem).toContain('token value');
});

test('a secret of the wrong shape is caught too', () => {
  expect(credentialProblem({ endpoint: r2, accessKeyId: keyId, secretAccessKey: 'short' })).toContain('S3_SECRET_ACCESS_KEY is 5 characters');
});

test('a local bucket, whose keys have no fixed shape, is not checked', () => {
  expect(credentialProblem({ endpoint: 'http://127.0.0.1:9000', accessKeyId: 'rustfsadmin', secretAccessKey: 'rustfsadmin' })).toBeNull();
});

test('an S3 error reaches a person as its code and message, not as XML', () => {
  const body = '<?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Credential access key has length 53, should be 32</Message></Error>';
  expect(s3Failure('PUT starters/x.tar.gz', 400, body)).toBe('storage: PUT starters/x.tar.gz answered 400 (InvalidArgument: Credential access key has length 53, should be 32)');
  expect(s3Failure('GET k', 502, 'Bad gateway')).toBe('storage: GET k answered 502');
});
