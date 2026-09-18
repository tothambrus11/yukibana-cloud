/** What GitHub sends when a repository changes, and how to know it was
 *  GitHub. Pure: the route hands in the raw body and headers and gets back
 *  either a verified event or a reason to answer 4xx. */

import { equalBytes, fromHex } from './bytes';

/** Whether `signature` (the X-Hub-Signature-256 header) is the HMAC of `body`
 *  under `secret`. The body must be the raw bytes as received: re-encoding
 *  parsed JSON changes whitespace and the check fails for no reason anyone
 *  will find quickly. */
export async function verifySignature(secret: string, body: Uint8Array, signature: string | null): Promise<boolean> {
  if (signature === null || !signature.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const buf = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const given = signature.slice('sha256='.length);
  if (given.length !== expected.length * 2 || !/^[0-9a-f]+$/i.test(given)) return false;
  return equalBytes(expected, fromHex(given));
}

/** A push we might build from. */
export interface PushEvent {
  readonly kind: 'push';
  readonly repoId: number;
  readonly fullName: string;
  /** `refs/heads/main`, as GitHub spells it. */
  readonly ref: string;
  /** The commit at the tip after the push; all zeros when the branch was deleted. */
  readonly after: string;
  readonly deleted: boolean;
  readonly installationId: number | null;
}

/** The app was removed from an account, or a repository from the app. */
export interface InstallationEvent {
  readonly kind: 'installation';
  readonly installationId: number;
  readonly action: string;
}

export type Event = PushEvent | InstallationEvent;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The event in a delivery, or null when it is not one this service acts on.
 *  `name` is the X-GitHub-Event header. Everything is read defensively: the
 *  payload is trusted only as far as the signature, and the shape only as far
 *  as this function checks. */
export function parseEvent(name: string | null, payload: unknown): Event | null {
  if (!isRecord(payload)) return null;
  if (name === 'push') {
    const repo = payload['repository'];
    const installation = payload['installation'];
    if (!isRecord(repo) || typeof repo['id'] !== 'number' || typeof repo['full_name'] !== 'string') return null;
    if (typeof payload['ref'] !== 'string' || typeof payload['after'] !== 'string') return null;
    return {
      kind: 'push',
      repoId: repo['id'],
      fullName: repo['full_name'],
      ref: payload['ref'],
      after: payload['after'],
      deleted: payload['deleted'] === true,
      installationId: isRecord(installation) && typeof installation['id'] === 'number' ? installation['id'] : null,
    };
  }
  if (name === 'installation' || name === 'installation_repositories') {
    const installation = payload['installation'];
    if (!isRecord(installation) || typeof installation['id'] !== 'number' || typeof payload['action'] !== 'string') return null;
    return { kind: 'installation', installationId: installation['id'], action: payload['action'] };
  }
  return null;
}
