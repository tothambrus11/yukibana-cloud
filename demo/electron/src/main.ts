/** The main process: owns the session, the registry client and every bundle,
 *  and answers the window's questions (`bridge.ts`) over IPC.
 *
 *  Everything Yukibana-specific is a call into `@yukibana/cli`:
 *  `loginWithLoopback` for the login, `tokenProvider` over a `SessionStore`
 *  for credentials, `YukibanaClient` for the API, `createSubmissionBundle`
 *  for the preview, `readArchive` and `writeEntries` for the starter.
 *
 *  Two environment variables exist for running without a person:
 *  `YUKIBANA_ACCESS_TOKEN` stands in for a login (with `YUKIBANA_URL`), and
 *  `YUKIBANA_DEMO_SCREENSHOT=<file.png>` saves the window once it has drawn
 *  and quits. `YUKIBANA_DEMO_FOLDER=<dir>` answers every folder dialog with
 *  that folder, and with a screenshot, opens the submit preview of it
 *  first. The README's screenshots are made this way.
 */

import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import {
  YukibanaClient, createSubmissionBundle, loginWithLoopback, logout, readArchive, tokenProvider, writeEntries,
  type SubmissionBundle,
} from '@yukibana/cli';
import type { Bridge, BundlePreview, FilePreview, Status } from './bridge.js';
import { safeStore } from './safe-store.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY = process.env['YUKIBANA_URL'] ?? 'https://cloud.yukibana.dev';
const fixedToken = process.env['YUKIBANA_ACCESS_TOKEN'];

let store: ReturnType<typeof safeStore>;
const bundles = new Map<string, SubmissionBundle>();

async function registry(): Promise<string> {
  return (await store.load())?.url ?? DEFAULT_REGISTRY;
}

async function client(): Promise<YukibanaClient> {
  const accessToken = fixedToken !== undefined && fixedToken !== '' ? () => fixedToken : tokenProvider(store);
  return new YukibanaClient({ url: await registry(), accessToken });
}

async function status(): Promise<Status> {
  const url = await registry();
  const loggedIn = (fixedToken !== undefined && fixedToken !== '') || (await store.load()) !== null;
  const me = loggedIn ? await (await client()).me().catch(() => null) : null;
  return { registry: url, me, persistent: store.persistent };
}

function window(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

async function pickFolder(event: IpcMainInvokeEvent, title: string, create: boolean): Promise<string | null> {
  const preset = process.env['YUKIBANA_DEMO_FOLDER'];
  if (preset !== undefined && preset !== '') return preset;
  const options: Electron.OpenDialogOptions = { title, properties: create ? ['openDirectory', 'createDirectory'] : ['openDirectory'] };
  const parent = window(event);
  const chosen = parent === undefined ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(parent, options);
  return chosen.canceled ? null : (chosen.filePaths[0] ?? null);
}

/** Text worth showing in a preview: valid UTF-8, no NUL bytes, under 256 KiB. */
function textOf(bytes: Uint8Array): string | null {
  if (bytes.length > 256 * 1024 || bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The handlers, one per bridge method. Each runs in the main process. */
const handlers: { [K in keyof Bridge]: (event: IpcMainInvokeEvent, ...args: Parameters<Bridge[K]>) => ReturnType<Bridge[K]> } = {
  status: async () => status(),
  async login(_event, url) {
    const session = await loginWithLoopback(url, { open: (u) => shell.openExternal(u.toString()) });
    await store.save(session);
    return status();
  },
  async logout() {
    await logout(store);
    bundles.clear();
    return status();
  },
  exercises: async () => (await client()).projects(),
  submissions: async (_event, projectId) => (await client()).submissions(projectId),
  async downloadStarter(event, projectId) {
    const folder = await pickFolder(event, 'Where should the starter go?', true);
    if (folder === null) return null;
    const entries = await readArchive(await (await client()).downloadStarter(projectId));
    await writeEntries(folder, entries);
    const top = entries[0]?.path.split('/')[0] ?? '';
    return join(folder, top);
  },
  async chooseFolder(event) {
    const folder = await pickFolder(event, 'Which folder do you want to submit?', false);
    if (folder === null) return null;
    const made = await createSubmissionBundle(folder);
    if (!made.ok) throw new Error(made.problems.join(' '));
    const bundleId = randomUUID();
    bundles.set(bundleId, made.bundle);
    const b = made.bundle;
    const preview: BundlePreview = {
      bundleId, folder, projectId: b.projectId,
      files: b.files.map((f) => ({ path: f.path, size: f.size, type: f.type })),
      skipped: b.skipped, problems: b.problems, totalBytes: b.totalBytes,
    };
    return preview;
  },
  async previewFile(_event, bundleId, path) {
    const bundle = bundles.get(bundleId);
    const file = bundle?.files.find((f) => f.path === path);
    if (bundle === undefined || file === undefined) throw new Error('That file is not in the bundle.');
    const bytes = bundle.read(path);
    const preview: FilePreview = { path, size: file.size, text: bytes === undefined ? (file.type === 'symlink' ? '(a symbolic link)' : null) : textOf(bytes) };
    return preview;
  },
  async submit(_event, bundleId, projectId) {
    const bundle = bundles.get(bundleId);
    if (bundle === undefined) throw new Error('Choose the folder again: that bundle is gone.');
    const accepted = await (await client()).submit(bundle, projectId);
    bundles.delete(bundleId);
    return accepted;
  },
};

async function main(): Promise<void> {
  await app.whenReady();
  store = safeStore(app.getPath('userData'));
  for (const [name, handler] of Object.entries(handlers)) {
    // Errors cross IPC as their message only, which is what the window shows.
    ipcMain.handle(name, (event, ...args: unknown[]) => (handler as (e: IpcMainInvokeEvent, ...a: unknown[]) => Promise<unknown>)(event, ...args));
  }

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'Yukibana',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  await win.loadFile(join(here, '..', 'static', 'index.html'));

  const shot = process.env['YUKIBANA_DEMO_SCREENSHOT'];
  if (shot !== undefined && shot !== '') {
    // The page signals when its first render, data included, is done.
    ipcMain.once('rendered', () => {
      const folder = process.env['YUKIBANA_DEMO_FOLDER'];
      if (folder !== undefined && folder !== '') {
        // Open the preview the way a person would: the button, then a file.
        void win.webContents.executeJavaScript(`
          [...document.querySelectorAll('button')].find((b) => b.textContent === 'Submit a folder…')?.click();
          setTimeout(() => document.querySelectorAll('.files button')[1]?.click(), 400);`);
      }
      // A virtual display's compositor sometimes fails the first capture
      // ("UnknownVizError"); one retry, then a failure that says so rather
      // than a process that never exits.
      const capture = async (tries: number): Promise<void> => {
        try {
          await writeFile(shot, (await win.webContents.capturePage()).toPNG());
          app.quit();
        } catch (e) {
          if (tries > 1) {
            setTimeout(() => void capture(tries - 1), 500);
            return;
          }
          console.error(`screenshot failed: ${e instanceof Error ? e.message : String(e)}`);
          app.exit(1);
        }
      };
      setTimeout(() => void capture(3), folder === undefined || folder === '' ? 300 : 1500);
    });
  }
}

app.on('window-all-closed', () => app.quit());
main().catch((e: unknown) => {
  console.error(e);
  app.exit(1);
});
