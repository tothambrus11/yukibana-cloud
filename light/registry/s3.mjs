// The two calls of the S3 API that putting a registry into a bucket needs
// (HEAD and PUT of one object), signed with AWS Signature Version 4. R2
// speaks it at https://<account>.r2.cloudflarestorage.com, and so do
// RustFS and MinIO for a registry run elsewhere.
//
// Hand-written rather than an SDK: two calls, and the registry's tool has
// no dependencies (package.json), so nobody installs anything to run it.
// The signing is a pure function, checked against the example in AWS's own
// documentation (s3.test.mjs).
import { createHash, createHmac } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';

/**
 * An access key for a bucket.
 * @typedef {object} Credentials
 * @property {string} accessKeyId
 * @property {string} secretAccessKey
 * @property {string} region R2's is `auto`; RustFS and MinIO take `us-east-1`
 */

/**
 * The access key in `env`: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY,
 * the names every S3 tool reads, and AWS_REGION, `auto` when unset, which
 * is R2's. An R2 key is made in Cloudflare's dashboard under R2, "Manage
 * API tokens", with write access to the one bucket.
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, credentials: Credentials } | { ok: false, problems: string[] }}
 */
export function credentialsFromEnv(env) {
	const accessKeyId = env.AWS_ACCESS_KEY_ID ?? '';
	const secretAccessKey = env.AWS_SECRET_ACCESS_KEY ?? '';
	const missing = [accessKeyId === '' && 'AWS_ACCESS_KEY_ID', secretAccessKey === '' && 'AWS_SECRET_ACCESS_KEY'].filter(Boolean);
	if (missing.length > 0) return { ok: false, problems: [`no bucket key: ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set`] };
	return { ok: true, credentials: { accessKeyId, secretAccessKey, region: env.AWS_REGION || 'auto' } };
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/** The SHA-256 of no bytes: the payload hash of a request without a body. */
export const EMPTY_SHA256 = sha256('');

/** A path's segments encoded as S3's canonical request wants: every byte but A-Z, a-z, 0-9, `-`, `.`, `_` and `~` as %XX. */
const canonicalPath = (pathname) =>
	pathname
		.split('/')
		.map((segment) => encodeURIComponent(decodeURIComponent(segment)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
		.join('/');

/**
 * The Authorization header of one request, by AWS Signature Version 4
 * (https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html).
 *
 * Every header in `headers` is signed, so the caller passes exactly the
 * ones to sign: at least `host`, `x-amz-content-sha256` and `x-amz-date`,
 * the last of which must be `date` written as `YYYYMMDD'T'HHMMSS'Z'`. A
 * request carries no query string here.
 * @param {object} request
 * @param {string} request.method
 * @param {string} request.pathname the URL's path, as sent
 * @param {Record<string, string>} request.headers by lowercase name
 * @param {string} request.payloadHash the hex SHA-256 of the body, or `UNSIGNED-PAYLOAD`
 * @param {Date} request.date
 * @param {Credentials} request.credentials
 * @param {string} [request.service] `s3`
 * @returns {string}
 */
export function authorization({ method, pathname, headers, payloadHash, date, credentials, service = 's3' }) {
	const amzDate = amzDateOf(date);
	const day = amzDate.slice(0, 8);
	const names = Object.keys(headers)
		.map((name) => name.toLowerCase())
		.sort();
	const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
	const canonical = [method, canonicalPath(pathname), '', ...names.map((name) => `${name}:${String(lower[name]).trim().replace(/\s+/g, ' ')}`), '', names.join(';'), payloadHash].join('\n');
	const scope = `${day}/${credentials.region}/${service}/aws4_request`;
	const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
	const key = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), credentials.region), service), 'aws4_request');
	const signature = createHmac('sha256', key).update(toSign).digest('hex');
	return `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
}

/** `date` as SigV4 writes it: `20130524T000000Z`. */
export const amzDateOf = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** What a bucket answered that was not what was asked, with S3's own words for it. */
export class BucketError extends Error {
	/**
	 * @param {string} message
	 * @param {number | null} status the HTTP status; null when no answer came, 0 when nothing was sent
	 */
	constructor(message, status) {
		super(message);
		this.name = 'BucketError';
		this.status = status;
	}
}

/** Whether a failure is worth one more try: no answer, too many requests, or the server's own fault. */
const transient = (error) => error instanceof BucketError && (error.status === null || error.status === 429 || error.status >= 500);

/** Whether `host` is this machine, the one place a bucket may be reached over plain HTTP. */
const loopback = (host) => host === 'localhost' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);

/**
 * One bucket, reached by its address in path style
 * (`https://<endpoint>/<bucket>`), as R2, RustFS and MinIO all serve it.
 *
 * Every call is tried again on a failure that may pass (no answer, 429, a
 * 5xx), up to four times in all, waiting longer each time; any other
 * answer is a BucketError at once.
 */
export class S3Bucket {
	/**
	 * Throws a RangeError when `address` is not a bucket's: HTTPS (plain
	 * HTTP only to this machine), no user, query or fragment, and a path
	 * that is one bucket name.
	 * @param {string} address
	 * @param {Credentials} credentials
	 * @param {{ wait?: (attempt: number) => Promise<void>, now?: () => Date }} [options] how long to wait before attempt 2, 3 and 4 (by default 1, 2 and 4 seconds), and the clock
	 */
	constructor(address, credentials, options = {}) {
		let url;
		try {
			url = new URL(address);
		} catch {
			throw new RangeError(`${JSON.stringify(address)} is not a URL`);
		}
		if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback(url.hostname))) throw new RangeError(`${address} is not HTTPS: a bucket's key is sent only over HTTPS, or to this machine`);
		if (url.username || url.password || url.search || url.hash) throw new RangeError(`${address} has a user, a query or a fragment, which a bucket's address does not`);
		if (!/^\/[a-z0-9][a-z0-9.-]{1,62}$/.test(url.pathname)) throw new RangeError(`${address} does not end in one bucket name, as https://<account>.r2.cloudflarestorage.com/<bucket> does`);
		this.url = url;
		this.credentials = credentials;
		this.wait = options.wait ?? ((attempt) => new Promise((done) => setTimeout(done, 500 * 2 ** attempt)));
		this.now = options.now ?? (() => new Date());
	}

	/** The bucket's address, as given. */
	toString() {
		return this.url.href;
	}

	/**
	 * Whether the bucket holds an object at `key`.
	 * @param {string} key
	 * @returns {Promise<boolean>}
	 */
	async has(key) {
		const status = await this.#tried(() => this.#send('HEAD', key, {}, EMPTY_SHA256, null, [200, 404]));
		return status === 200;
	}

	/**
	 * Puts the file `file` at `key`, replacing what is there. `size` and
	 * `sha256` are the file's, as the caller knows them: the bucket refuses
	 * the object unless the bytes it got hash to `sha256`, so a file that
	 * changed meanwhile is never stored. `encoding`, when given, is stored
	 * as the object's Content-Encoding, which the registry's Worker sends
	 * with it.
	 * @param {string} key
	 * @param {string} file
	 * @param {{ size: number, sha256: string, encoding?: 'br' }} what
	 */
	async put(key, file, { size, sha256: hash, encoding }) {
		const found = await stat(file);
		if (found.size !== size) throw new BucketError(`${file} is ${found.size} bytes, not the ${size} it was to be`, 0);
		const headers = { 'content-type': 'application/octet-stream', 'content-length': String(size), ...(encoding ? { 'content-encoding': encoding } : {}) };
		await this.#tried(() => this.#send('PUT', key, headers, hash, file, [200]));
	}

	/** `call`, tried again while it fails in a way that may pass. */
	async #tried(call) {
		for (let attempt = 1; ; attempt++) {
			try {
				return await call();
			} catch (error) {
				if (attempt === 4 || !transient(error)) throw error;
				await this.wait(attempt);
			}
		}
	}

	/**
	 * Sends one signed request and resolves with its status when it is one
	 * of `expected`, else rejects with a BucketError carrying the answer's
	 * first kilobyte, where S3 says why.
	 */
	#send(method, key, extra, payloadHash, file, expected) {
		const pathname = `${this.url.pathname}/${key}`;
		const date = this.now();
		const signed = { host: this.url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDateOf(date) };
		const headers = { ...extra, ...signed, authorization: authorization({ method, pathname, headers: signed, payloadHash, date, credentials: this.credentials }) };
		const client = this.url.protocol === 'https:' ? https : http;
		return new Promise((resolve, reject) => {
			const request = client.request({ protocol: this.url.protocol, hostname: this.url.hostname, port: this.url.port || undefined, method, path: pathname, headers }, (response) => {
				const status = response.statusCode ?? 0;
				const chunks = [];
				let length = 0;
				response.on('data', (chunk) => {
					if (length < 1024) chunks.push(chunk), (length += chunk.length);
				});
				response.on('end', () => {
					if (expected.includes(status)) return resolve(status);
					const said = Buffer.concat(chunks).toString('utf8').slice(0, 1024);
					const code = /<Code>([^<]*)<\/Code>/.exec(said)?.[1];
					const message = /<Message>([^<]*)<\/Message>/.exec(said)?.[1];
					reject(new BucketError(`${method} ${key}: the bucket answered ${status}${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}`, status));
				});
				response.on('error', (error) => reject(new BucketError(`${method} ${key}: ${error.message}`, null)));
			});
			request.on('error', (error) => reject(new BucketError(`${method} ${key}: ${error.message}`, null)));
			if (file === null) return request.end();
			const body = createReadStream(file);
			body.on('error', (error) => request.destroy(error));
			body.pipe(request);
		});
	}
}
