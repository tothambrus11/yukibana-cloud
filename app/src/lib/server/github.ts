/** GitHub, as an App.
 *
 *  A GitHub App is installed on the repositories a teacher chooses and
 *  nothing else. To act on one, the Worker signs a short JWT with the App's
 *  private key, trades it for an installation token that lives an hour, and
 *  uses that. No personal token of anyone's is ever stored.
 *
 *  Every function takes `fetchFn` so the builder can be tested against a
 *  fake GitHub that serves a fixture tarball.
 */

import { importPKCS8, SignJWT } from 'jose';
import type { GitHubConfig } from './env';

const API = 'https://api.github.com';
const headers = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'yukibana',
});

/** GitHub issues App keys as PKCS#1 ("BEGIN RSA PRIVATE KEY"); WebCrypto
 *  imports PKCS#8 only. The difference is a fixed wrapper around the same
 *  bytes, added here so either form of the key works. */
export function toPkcs8(pem: string): string {
  if (!pem.includes('BEGIN RSA PRIVATE KEY')) return pem;
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const pkcs1 = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  const der = (tag: number, content: Uint8Array): Uint8Array => {
    let len: number[];
    if (content.length < 0x80) len = [content.length];
    else if (content.length < 0x100) len = [0x81, content.length];
    else if (content.length < 0x10000) len = [0x82, content.length >> 8, content.length & 0xff];
    else len = [0x83, content.length >> 16, (content.length >> 8) & 0xff, content.length & 0xff];
    const out = new Uint8Array(1 + len.length + content.length);
    out[0] = tag;
    out.set(len, 1);
    out.set(content, 1 + len.length);
    return out;
  };
  const rsaAlgorithm = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const key = der(0x04, pkcs1);
  const info = der(0x30, concat(version, rsaAlgorithm, key));
  let b64 = btoa(String.fromCharCode(...info));
  b64 = b64.replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The JWT that identifies the App itself, good for ten minutes. */
export async function appJwt(cfg: GitHubConfig, now = Date.now()): Promise<string> {
  const key = await importPKCS8(toPkcs8(cfg.privateKey), 'RS256');
  const iat = Math.floor(now / 1000) - 60; // a minute of clock skew
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(cfg.appId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 9 * 60)
    .sign(key);
}

/** A token for one installation, good for an hour, scoped by GitHub to the
 *  repositories that installation covers. */
export async function installationToken(cfg: GitHubConfig, installationId: number, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(`${API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: headers(await appJwt(cfg)),
  });
  if (!res.ok) throw new Error(`github: installation ${installationId} token answered ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { token?: unknown };
  if (typeof body.token !== 'string') throw new Error('github: token response had no token');
  return body.token;
}

export interface Repo {
  readonly id: number;
  readonly fullName: string;
  readonly defaultBranch: string;
}

/** The repositories an installation can see. */
export async function installationRepos(token: string, fetchFn: typeof fetch = fetch): Promise<Repo[]> {
  const res = await fetchFn(`${API}/installation/repositories?per_page=100`, { headers: headers(token) });
  if (!res.ok) throw new Error(`github: listing repositories answered ${res.status}`);
  const body = (await res.json()) as { repositories?: { id: number; full_name: string; default_branch: string }[] };
  return (body.repositories ?? []).map((r) => ({ id: r.id, fullName: r.full_name, defaultBranch: r.default_branch }));
}

/** The commit `ref` (a branch, a tag or a sha) names right now. */
export async function resolveRef(token: string, fullName: string, ref: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(`${API}/repos/${fullName}/commits/${encodeURIComponent(ref)}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`github: ${fullName}@${ref} answered ${res.status}`);
  const body = (await res.json()) as { sha?: unknown };
  if (typeof body.sha !== 'string') throw new Error(`github: no sha for ${fullName}@${ref}`);
  return body.sha;
}

/** The repository at `sha` as GitHub's gzipped tarball, wrapped in a
 *  `owner-repo-sha/` directory. `maxBytes` bounds what the builder will hold
 *  in memory. */
export async function fetchTarball(token: string, fullName: string, sha: string, maxBytes: number, fetchFn: typeof fetch = fetch): Promise<Uint8Array> {
  const res = await fetchFn(`${API}/repos/${fullName}/tarball/${sha}`, { headers: headers(token), redirect: 'follow' });
  if (!res.ok) throw new Error(`github: tarball of ${fullName}@${sha} answered ${res.status}`);
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new Error(`github: tarball is ${declared} bytes, over the ${maxBytes} byte limit`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error(`github: tarball is ${bytes.byteLength} bytes, over the ${maxBytes} byte limit`);
  return bytes;
}

/** Where a teacher goes to install the App. `state` comes back on the setup
 *  URL, so it carries the project this installation is for. */
export function installUrl(cfg: GitHubConfig, state: string): string {
  return `https://github.com/apps/${cfg.appSlug}/installations/new?state=${encodeURIComponent(state)}`;
}
