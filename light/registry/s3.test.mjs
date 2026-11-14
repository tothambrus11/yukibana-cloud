// The S3 calls: the signature against AWS's own example, and the bucket
// client against a small S3 on this machine that checks what a real one
// checks (the signature, the payload's hash).
//
//   node --test light/registry/
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fakeS3, KEY } from './fake-s3.mjs';
import { amzDateOf, authorization, BucketError, credentialsFromEnv, EMPTY_SHA256, S3Bucket } from './s3.mjs';

test('a request is signed as AWS documents it', () => {
	// "Example: GET Object", https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
	const date = new Date('2013-05-24T00:00:00Z');
	assert.equal(amzDateOf(date), '20130524T000000Z');
	const signed = authorization({
		method: 'GET',
		pathname: '/test.txt',
		headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256, 'x-amz-date': '20130524T000000Z' },
		payloadHash: EMPTY_SHA256,
		date,
		credentials: KEY,
	});
	assert.equal(
		signed,
		'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
	);
});

test('the key comes from the variables every S3 tool reads, and R2 is the region when none is named', () => {
	assert.deepEqual(credentialsFromEnv({ AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' }), { ok: true, credentials: { accessKeyId: 'a', secretAccessKey: 'b', region: 'auto' } });
	assert.equal(credentialsFromEnv({ AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b', AWS_REGION: 'us-east-1' }).credentials.region, 'us-east-1');
	assert.deepEqual(credentialsFromEnv({ AWS_ACCESS_KEY_ID: '' }), { ok: false, problems: ['no bucket key: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are not set'] });
});

test('a key is sent only over HTTPS or to this machine, and only to an address that names one bucket', () => {
	for (const address of ['http://example.org/bucket', 'https://user:pass@x.example/bucket', 'https://x.example/bucket?a', 'https://x.example/', 'https://x.example/a/b', 'not a url']) {
		assert.throws(() => new S3Bucket(address, KEY), RangeError, address);
	}
	assert.doesNotThrow(() => new S3Bucket('https://0123.r2.cloudflarestorage.com/yukibana-run', KEY));
	assert.doesNotThrow(() => new S3Bucket('http://127.0.0.1:9000/packs', KEY));
});

test('an object is put with its hash and encoding, and is then there', async (t) => {
	const { bucket, objects } = await fakeS3(t);
	const dir = await mkdtemp(path.join(tmpdir(), 'yukibana-s3-'));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const file = path.join(dir, 'runner.js.br');
	await writeFile(file, 'compressed bytes');
	const sha256 = createHash('sha256').update('compressed bytes').digest('hex');
	assert.equal(await bucket.has('packs/x/runner.js'), false);
	await bucket.put('packs/x/runner.js', file, { size: 16, sha256, encoding: 'br' });
	assert.equal(await bucket.has('packs/x/runner.js'), true);
	assert.deepEqual(objects.get('packs/x/runner.js'), { body: Buffer.from('compressed bytes'), encoding: 'br', type: 'application/octet-stream' });

	// The bucket hashes what it got: bytes that are not the ones meant are not stored.
	await assert.rejects(bucket.put('packs/x/other.js', file, { size: 16, sha256: EMPTY_SHA256 }), /answered 400 XAmzContentSHA256Mismatch/);
	await assert.rejects(bucket.put('packs/x/other.js', file, { size: 17, sha256 }), /is 16 bytes, not the 17/);
	assert.equal(objects.has('packs/x/other.js'), false);
});

test('a failure that may pass is tried again, and one that will not is said at once', async (t) => {
	const { bucket, requests, fail } = await fakeS3(t);
	fail.push(500, 503);
	assert.equal(await bucket.has('a'), false);
	assert.equal(requests.length, 3, 'two failures, then the answer');

	requests.length = 0;
	fail.push(403);
	const refused = await bucket.has('a').catch((error) => error);
	assert.ok(refused instanceof BucketError);
	assert.equal(refused.status, 403);
	// An answer to HEAD has no body, so no words for why.
	assert.equal(refused.message, 'HEAD a: the bucket answered 403');
	assert.equal(requests.length, 1);

	fail.push(500, 500, 500, 500);
	requests.length = 0;
	await assert.rejects(bucket.has('a'), /answered 500$/);
	assert.equal(requests.length, 4, 'four tries in all');

	const dir = await mkdtemp(path.join(tmpdir(), 'yukibana-s3-'));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await writeFile(path.join(dir, 'a'), '');
	fail.push(403);
	await assert.rejects(bucket.put('a', path.join(dir, 'a'), { size: 0, sha256: EMPTY_SHA256 }), /^BucketError: PUT a: the bucket answered 403 AccessDenied: AccessDenied said the fake$/);

	const wrong = new S3Bucket(bucket.toString(), { ...KEY, secretAccessKey: 'another' });
	await assert.rejects(wrong.put('a', path.join(dir, 'a'), { size: 0, sha256: EMPTY_SHA256 }), /403 SignatureDoesNotMatch/);
});
