/** Uploading a release to the registry. One multipart request; the server
 *  hashes and stores both archives and records the release under the
 *  project the token names. */

export interface PublishInput {
  /** The registry, like https://yukibana.example.org */
  readonly url: string;
  readonly token: string;
  readonly projectId: string;
  readonly starter: Uint8Array;
  readonly teacher: Uint8Array;
  readonly label: string;
  readonly commit: string | null;
}

export interface Published {
  readonly releaseId: string;
  readonly starter: { readonly size: number; readonly sha256: string };
  readonly teacher: { readonly size: number; readonly sha256: string };
}

export async function publish(input: PublishInput, fetchFn: typeof fetch = fetch): Promise<Published> {
  const form = new FormData();
  form.set('starter', new Blob([buffer(input.starter)], { type: 'application/gzip' }), 'starter.tar.gz');
  form.set('teacher', new Blob([buffer(input.teacher)], { type: 'application/gzip' }), 'teacher.tar.gz');
  form.set('label', input.label);
  if (input.commit !== null) form.set('commit', input.commit);
  const res = await fetchFn(`${input.url.replace(/\/+$/, '')}/api/projects/${encodeURIComponent(input.projectId)}/releases`, {
    method: 'POST',
    headers: { authorization: `Bearer ${input.token}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`the registry answered ${res.status}: ${messageOf(text)}`);
  return JSON.parse(text) as Published;
}

function messageOf(text: string): string {
  try {
    const body = JSON.parse(text) as { message?: unknown };
    return typeof body.message === 'string' ? body.message : text;
  } catch {
    return text;
  }
}

function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
