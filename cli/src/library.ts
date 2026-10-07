/** `@yukibana/cli` as a library: what the Theia extension imports.
 *
 *  Three things, each usable without the others:
 *
 *  * **A submission bundle.** `createSubmissionBundle(folder)` reads the
 *    student's folder by its `yukibana.json`; the bundle lists its files
 *    (`files`, `skipped`, `problems`) and reads any of them (`read`) for a
 *    preview, and is only compressed when it is sent.
 *  * **A login.** `startLogin(registry, redirect)` gives the address to show
 *    and a `finish` for the address the browser comes back to;
 *    `loginWithLoopback` does both with a listener on 127.0.0.1. Either gives
 *    a `Session`, which a `SessionStore` keeps (`fileStore` is the
 *    terminal's; an IDE implements one over its secret storage).
 *  * **A client.** `new YukibanaClient({ url, accessToken })` is the whole
 *    API as that person. `tokenProvider(store)` is an `accessToken` that
 *    refreshes the session as it goes.
 *
 *  ```ts
 *  const store = theiaSecretStore();              // a SessionStore
 *  const session = await loginWithLoopback(url, { open, callbackPage }); // or startLogin + finish
 *  await store.save(session);
 *  const client = new YukibanaClient({ url, accessToken: tokenProvider(store) });
 *
 *  const made = await createSubmissionBundle(workspaceFolder);
 *  if (!made.ok) return show(made.problems);
 *  preview(made.bundle.files, (path) => made.bundle.read(path));
 *  if (await confirmed()) await client.submit(made.bundle);
 *  ```
 *
 *  The pure pieces under `lib/` (the config parser, the plans, tar, the
 *  assembly) are exported too, for an extension that wants to show what a
 *  read-only or hidden pattern matches.
 *
 *  The library is headless: it owns the protocol, the data, the disk and the
 *  network, and nothing a person sees. Opening a browser, the page the
 *  browser lands on after a login, and every word on a screen belong to the
 *  host (the CLI's are in `commands/`, the demo's in `demo/electron`).
 *  Errors carry a status and the registry's own sentence for the host to
 *  show or translate.
 */

export { createSubmissionBundle, bundleOf, type BundleFile, type BundleResult, type SubmissionBundle } from './bundle.js';
export { YukibanaClient, RegistryError, type ClientOptions, type SubmissionQuery } from './client.js';
export {
  startLogin, refreshSession, tokenProvider, logout, memoryStore, codeOf, NotLoggedIn,
  type PendingLogin, type Session, type SessionStore,
} from './session.js';
export { loginWithLoopback, type CallbackOutcome, type LoopbackOptions } from './loopback.js';
export { fileStore, defaultSessionPath } from './store.js';
export { readArchive, writeEntries } from './extract.js';
export { publish, type PublishInput } from './publish.js';
export { assemble, submissionRoot, teacherRoot, tampered, type Assembled, type Assembly, type Tampering } from './lib/assemble.js';
export { planSubmission, type Packing } from './lib/pack.js';
export { parseConfig, protectedPaths, CONFIG_FILE, KINDS, type Config, type Kind, type SubmissionRules } from './lib/yukibana.js';
export { matcher } from './lib/glob.js';
export { readTar, writeTar, type Entry, type EntryType } from './lib/tar.js';
export type { Accepted, Author, Edition, EditionRole, Me, Member, Project, Published, Release, Submission } from './lib/wire.js';
