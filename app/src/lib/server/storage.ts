/** Where bytes live.
 *
 *  One interface, one implementation: any bucket that speaks S3, which is
 *  R2 in production and MinIO on a laptop and in CI. The Worker talks to it
 *  with signed requests; a browser gets a presigned URL that expires. The
 *  database holds keys, never URLs, so changing provider is a change to
 *  three variables.
 */

import { AwsClient } from 'aws4fetch';
import type { ObjectKey } from '$lib/ids';
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

  const send = async (url: string, init: RequestInit): Promise<Response> => {
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
      if (!res.ok) throw new Error(`storage: PUT ${key} answered ${res.status}: ${await res.text()}`);
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
      if (!res.ok) throw new Error(`storage: GET ${key} answered ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async presignGet(key, ttlSeconds, filename) {
      const url = new URL(objectUrl(cfg.publicEndpoint, key));
      url.searchParams.set('X-Amz-Expires', String(ttlSeconds));
      url.searchParams.set('response-content-disposition', `attachment; filename="${filename.replace(/["\\\r\n]/g, '_')}"`);
      const signed = await client.sign(url.toString(), { method: 'GET', aws: { signQuery: true } });
      return new URL(signed.url);
    },
    async delete(key) {
      const res = await send(objectUrl(cfg.endpoint, key), { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`storage: DELETE ${key} answered ${res.status}`);
    },
  };
}
