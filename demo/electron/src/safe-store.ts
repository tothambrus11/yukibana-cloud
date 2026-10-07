/** A `SessionStore` over Electron's safeStorage: the session encrypted with
 *  a key the operating system keeps (Keychain, DPAPI, libsecret), in a file
 *  under the app's own data folder. This is the piece a Theia extension
 *  replaces with its own secret storage; the library only needs `load`,
 *  `save` and `clear`.
 *
 *  Where the system has no keychain, safeStorage cannot encrypt, and a
 *  refresh token written in the clear would be a login anyone with the disk
 *  has. Then the session is kept in memory only, and `persistent` says so.
 */

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import { memoryStore, type Session, type SessionStore } from '@yukibana/cli';

export interface SafeStore extends SessionStore {
  readonly persistent: boolean;
}

export function safeStore(dir: string): SafeStore {
  if (!safeStorage.isEncryptionAvailable()) return { ...memoryStore(), persistent: false };
  const path = join(dir, 'session.bin');
  return {
    persistent: true,
    async load() {
      let blob: Buffer;
      try {
        blob = await readFile(path);
      } catch {
        return null;
      }
      try {
        const raw: unknown = JSON.parse(safeStorage.decryptString(blob));
        return isSession(raw) ? raw : null;
      } catch {
        // A file from another machine or another key: log in again.
        return null;
      }
    },
    async save(session) {
      await writeFile(path, safeStorage.encryptString(JSON.stringify(session)), { mode: 0o600 });
    },
    async clear() {
      await rm(path, { force: true });
    },
  };
}

function isSession(v: unknown): v is Session {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return ['url', 'supabaseUrl', 'publishableKey', 'accessToken', 'refreshToken'].every((k) => typeof o[k] === 'string')
    && typeof o['expiresAt'] === 'number';
}
