/** Where bytes live.
 *
 *  One interface, one implementation: any bucket that speaks S3, which is
 *  R2 in production and MinIO on a laptop and in CI. The Worker talks to it
 *  with signed requests; a browser gets a presigned URL that expires. The
 *  database holds keys, never URLs, so changing provider is a change to
 *  three variables.
 */

import { AwsClient } from 'aws4fetch';
import type { ObjectKey } from '#lib/ids.ts';
import { Misconfigured } from './db';
import type { S3Config } from './env';

export interface Bucket {
  /** Stores `body` under `key`, replacing what was there. */
  put(key: ObjectKey, body: Uint8Array, contentType: string): Promise<void>;
  /** The object's size, or null when there is no such object. */
  head(key: ObjectKey): Promise<{ size: number } | null>;
  /** The object's bytes, or null. */
  get(key: ObjectKey): Promise<Uint8Array | null>;
  /** A URL that fetches the object for `ttlSeconds`, then stops working.
   *  `filename` is what the browser saves it as. The URL is a bearer token:
   *  it outlives the permission that minted it, which is why it is short. */
  presignGet(key: ObjectKey, ttlSeconds: number, filename: string): Promise<URL>;
  delete(key: ObjectKey): Promise<void>;
}

/** What is wrong with credentials for R2, in a sentence an operator can act
 *  on, or null when nothing visibly is (or the bucket is not R2: MinIO's and
 *  RustFS's keys have no fixed shape).
 *
 *  R2's "Create API token" page shows three values one under another: the
 *  token value, the Access Key ID and the Secret Access Key. Only the last
 *  two are S3 credentials. The first, pasted as S3_ACCESS_KEY_ID, made every
 *  upload fail with R2's own "Credential access key has length 53, should be
 *  32" in raw XML (2026-10), after everything else had worked; so the
 *  shapes are checked before a request is signed with them. */
export function credentialProblem(cfg: Pick<S3Config, 'endpoint' | 'accessKeyId' | 'secretAccessKey'>): string | null {
  let host: string;
  try {
    host = new URL(cfg.endpoint).hostname;
  } catch {
    return `S3_ENDPOINT is not a URL: ${cfg.endpoint}`;
  }
  if (!host.endsWith('.r2.cloudflarestorage.com')) return null;
  if (!/^[0-9a-f]{32}$/.test(cfg.accessKeyId)) {
    return `S3_ACCESS_KEY_ID is ${cfg.accessKeyId.length} characters, and an R2 Access Key ID is 32 hexadecimal ones. `
      + 'R2 → Manage API tokens shows three values when a token is made: this is probably the first, the token value. '
      + 'Set the Access Key ID instead (npx wrangler secret put S3_ACCESS_KEY_ID).';
  }
  if (!/^[0-9a-f]{64}$/.test(cfg.secretAccessKey)) {
    return `S3_SECRET_ACCESS_KEY is ${cfg.secretAccessKey.length} characters, and an R2 Secret Access Key is 64 hexadecimal ones. `
      + 'Set the Secret Access Key from the page that made the token (npx wrangler secret put S3_SECRET_ACCESS_KEY).';
  }
  return null;
}

/** An S3 error response as one line: its `<Code>` and `<Message>` when the
 *  body is the usual XML, the status alone otherwise. A person sees this in a
 *  toast, so the XML itself is not passed on. */
export function s3Failure(what: string, status: number, body: string): string {
  const field = (name: string): string | null => body.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? null;
  const code = field('Code');
  const message = field('Message');
  const said = [code, message].filter((x) => x !== null && x !== '').join(': ');
  return `storage: ${what} answered ${status}${said === '' ? '' : ` (${said})`}`;
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function s3Bucket(cfg: S3Config, fetchFn: typeof fetch = fetch): Bucket {
  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    region: cfg.region,
  });
  // Path-style addressing: works for R2, MinIO and AWS alike, and needs no DNS.
  const objectUrl = (base: string, key: ObjectKey): string =>
    `${base.replace(/\/+$/, '')}/${cfg.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;

  // Checked when the bucket is used rather than when it is made, so a bad
  // key fails uploads and downloads with the sentence above, and nothing
  // else: every request builds a bucket, most never touch it.
  const problem = credentialProblem(cfg);
  const send = async (url: string, init: RequestInit): Promise<Response> => {
    if (problem !== null) throw new Misconfigured(problem);
    const signed = await client.sign(url, init);
    return fetchFn(signed);
  };

  return {
    async put(key, body, contentType) {
      const res = await send(objectUrl(cfg.endpoint, key), {
        method: 'PUT',
        body: bufferOf(body),
        headers: { 'content-type': contentType, 'content-length': String(body.byteLength) },
      });
      if (!res.ok) throw new Error(s3Failure(`PUT ${key}`, res.status, await res.text()));
    },
    async head(key) {
      const res = await send(objectUrl(cfg.endpoint, key), { method: 'HEAD' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`storage: HEAD ${key} answered ${res.status}`);
      return { size: Number(res.headers.get('content-length') ?? '0') };
    },
    async get(key) {
      const res = await send(objectUrl(cfg.endpoint, key), { method: 'GET' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(s3Failure(`GET ${key}`, res.status, await res.text()));
      return new Uint8Array(await res.arrayBuffer());
    },
    async presignGet(key, ttlSeconds, filename) {
      const url = new URL(objectUrl(cfg.publicEndpoint, key));
      url.searchParams.set('X-Amz-Expires', String(ttlSeconds));
      url.searchParams.set('response-content-disposition', `attachment; filename="${filename.replace(/["\\\r\n]/g, '_')}"`);
      if (problem !== null) throw new Misconfigured(problem);
      const signed = await client.sign(url.toString(), { method: 'GET', aws: { signQuery: true } });
      return new URL(signed.url);
    },
    async delete(key) {
      const res = await send(objectUrl(cfg.endpoint, key), { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(s3Failure(`DELETE ${key}`, res.status, await res.text()));
    },
  };
}
