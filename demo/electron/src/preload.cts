/** The only bridge between the page and the main process: each method of
 *  `Bridge` becomes one IPC call, and nothing else is exposed. CommonJS,
 *  because a sandboxed preload cannot be an ES module; the method names are
 *  repeated here for the same reason (it cannot import bridge.ts at run
 *  time), and the type below fails to compile if the two lists drift. */

import electron = require('electron');
import type { Bridge } from './bridge.js' with { 'resolution-mode': 'import' };

const { contextBridge, ipcRenderer } = electron;

const METHODS = [
  'status', 'login', 'logout', 'exercises', 'submissions', 'downloadStarter', 'chooseFolder', 'previewFile', 'submit',
] as const satisfies readonly (keyof Bridge)[];
type Missing = Exclude<keyof Bridge, (typeof METHODS)[number]>;
const complete: Missing extends never ? true : Missing = true;
void complete;

/** IPC errors arrive as "Error invoking remote method 'x': Error: <message>";
 *  the page wants the sentence. */
const call = (name: string) => async (...args: unknown[]): Promise<unknown> => {
  try {
    return await ipcRenderer.invoke(name, ...args);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''), { cause: e });
  }
};

contextBridge.exposeInMainWorld('yukibana', Object.fromEntries(METHODS.map((m) => [m, call(m)])));
contextBridge.exposeInMainWorld('yukibanaDemo', { rendered: () => ipcRenderer.send('rendered') });
