// For the tests only (s3.test.mjs, sync.test.mjs): an S3 on this machine
// that checks what R2 checks of a request, the signature and the payload's
// hash, and keeps the objects in a Map. Not a test file itself, so that
// `node --test` runs its users' tests once each.
import { createHash } from 'node:crypto';
import http from 'node:http';
import { authorization, S3Bucket } from './s3.mjs';

/** The key of AWS's own examples, which the fake accepts and nothing else does. */
export const KEY = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' };

/**
 * An S3 on 127.0.0.1 holding objects in a Map, checking every request's
 * signature with {@link KEY} and every PUT's payload hash, as R2 does.
 * `fail` holds statuses to answer the next requests with instead.
 */
export async function fakeS3(t) {
	/** @type {Map<string, { body: Buffer, encoding: string | undefined, type: string | undefined }>} */
	const objects = new Map();
	const requests = [];
	const fail = [];
	const server = http.createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = Buffer.concat(chunks);
		const url = new URL(request.url, 'http://x');
		requests.push(`${request.method} ${url.pathname}`);
		const answer = (status, code = '') => response.writeHead(status, { 'content-type': 'application/xml' }).end(code && `<Error><Code>${code}</Code><Message>${code} said the fake</Message></Error>`);
		const failing = fail.shift();
		if (failing !== undefined) return answer(failing, failing === 403 ? 'AccessDenied' : 'InternalError');
		const signed = { host: request.headers.host, 'x-amz-content-sha256': request.headers['x-amz-content-sha256'], 'x-amz-date': request.headers['x-amz-date'] };
		const date = new Date(signed['x-amz-date'].replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
		const expected = authorization({ method: request.method, pathname: url.pathname, headers: signed, payloadHash: signed['x-amz-content-sha256'], date, credentials: KEY });
		if (request.headers.authorization !== expected) return answer(403, 'SignatureDoesNotMatch');
		const key = url.pathname.replace(/^\/bucket\//, '');
		if (request.method === 'HEAD') return answer(objects.has(key) ? 200 : 404);
		if (request.method !== 'PUT') return answer(405, 'MethodNotAllowed');
		if (createHash('sha256').update(body).digest('hex') !== signed['x-amz-content-sha256']) return answer(400, 'XAmzContentSHA256Mismatch');
		objects.set(key, { body, encoding: request.headers['content-encoding'], type: request.headers['content-type'] });
		answer(200);
	});
	await new Promise((done) => server.listen(0, '127.0.0.1', done));
	t.after(() => new Promise((done) => server.close(done)));
	const bucket = new S3Bucket(`http://127.0.0.1:${server.address().port}/bucket`, KEY, { wait: async () => {} });
	return { bucket, objects, requests, fail };
}
