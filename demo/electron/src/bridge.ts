/** What the window may ask the main process, and nothing more.
 *
 *  The window is a web page and is treated as one: no Node, no filesystem,
 *  no token. Everything that holds a credential or touches the disk (the
 *  session, the client, the bundle) lives in the main process, and the
 *  window gets this interface through the preload script. A Theia
 *  extension has the same split: a backend that owns the library and a
 *  frontend that renders what the backend answers.
 *
 *  Types only; the preload script lists the method names it forwards and
 *  fails to compile when that list misses one.
 */

import type { Accepted, Me, Project, Submission } from '@yukibana/cli';

/** A bundle made from a folder the student chose, as the window sees it:
 *  the list and the verdict, not the bytes. `bundleId` names it in later
 *  calls; the bytes stay in the main process until it is sent. */
export interface BundlePreview {
  readonly bundleId: string;
  readonly folder: string;
  /** The project the folder's yukibana.json names, or null. */
  readonly projectId: string | null;
  readonly files: readonly { readonly path: string; readonly size: number; readonly type: 'file' | 'symlink' }[];
  readonly skipped: readonly string[];
  readonly problems: readonly string[];
  readonly totalBytes: number;
}

/** One file of a bundle, for the preview pane. `text` is null for a file
 *  that is not UTF-8 text, or too large to show. */
export interface FilePreview {
  readonly path: string;
  readonly size: number;
  readonly text: string | null;
}

export interface Status {
  /** The registry logged in to, or the one to offer on the login screen. */
  readonly registry: string;
  /** Null: nobody is logged in. */
  readonly me: Me | null;
  /** Whether the session survives a restart: false where the system has no
   *  keychain for Electron's safeStorage, and the session is kept in memory. */
  readonly persistent: boolean;
}

/** Every call either answers or rejects with an Error whose message is a
 *  sentence for the screen. */
export interface Bridge {
  status(): Promise<Status>;
  login(registry: string): Promise<Status>;
  logout(): Promise<Status>;
  /** The projects the registry shows this person. For a student, the
   *  registry only ever returns those of their editions whose window is
   *  open, so this is their list of current exercises. */
  exercises(): Promise<Project[]>;
  /** The person's submissions to one project (all of them, for staff). */
  submissions(projectId: string): Promise<Submission[]>;
  /** Asks for a folder and unpacks the starter into it. Null: cancelled. */
  downloadStarter(projectId: string): Promise<string | null>;
  /** Asks for a folder and makes a bundle of it. Null: cancelled. */
  chooseFolder(): Promise<BundlePreview | null>;
  previewFile(bundleId: string, path: string): Promise<FilePreview>;
  submit(bundleId: string, projectId: string): Promise<Accepted>;
}

declare global {
  interface Window {
    readonly yukibana: Bridge;
    /** For running without a person: the page says when its first render,
     *  data included, is on screen (see YUKIBANA_DEMO_SCREENSHOT). */
    readonly yukibanaDemo: { rendered(): void };
  }
}
