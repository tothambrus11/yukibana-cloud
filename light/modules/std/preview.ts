/**
 * Previewing a web project: the token whose provider builds the project's
 * page, again and again as it is edited, for a host to show.
 *
 * A pack's runner builds a page from a `type: 'preview'` message
 * (packs/CONTRACT.md; packs/javascript/README.md, "Preview") and answers
 * with one HTML document whose stylesheets are inlined. A provider of
 * `preview` owns the worker that does it, for as long as its session lasts,
 * so a compiler is loaded once and not at every edit. Showing the page,
 * deciding when to rebuild it, and swapping a stylesheet in place are the
 * host's: they need the host's frame.
 */

import { defineToken, type Files, type Path, type Token } from '../core/index.ts';

/** What a preview session is opened with. */
export interface PreviewInput {
	/**
	 * Takes what the person is told about the runner rather than the page
	 * (it broke the contract, failed to load, or went silent): sentences
	 * ending in a newline, to be shown as they are. Called any number of
	 * times while the session lasts (Light: in the terminal, beside the
	 * page's console).
	 */
	readonly report: (text: string) => void;
}

/** What one build of the page came to. */
export type BuiltPage =
	| {
			/** The page was built. */
			readonly kind: 'page';
			/** The whole document, stylesheets inlined and scripts as `data:` URLs. */
			readonly html: string;
			/** The paths of the project's stylesheets the document inlined, which a host may swap in place. */
			readonly styles: readonly string[];
	  }
	| {
			/** The project could not be built into a page. */
			readonly kind: 'errors';
			/** Why, one sentence per error, as the runner said them. */
			readonly errors: readonly string[];
	  }
	| {
			/**
			 * No answer will come: the runner failed, went silent, or the
			 * session was stopped. What happened was reported already, but for
			 * a stop.
			 */
			readonly kind: 'unanswered';
	  };

/**
 * A page being previewed: builds of it, one after another.
 *
 * Invariant: a build asked for after `stop` resolves to `unanswered`.
 */
export interface PreviewSession {
	/** The file the page is built from (`index.html`). */
	readonly entry: Path;
	/**
	 * Returns the page built from `files`. A build asked for while another is
	 * waited for replaces it, which then resolves to `unanswered`: one build
	 * at a time is the host's to keep. Never rejects.
	 */
	build(files: Files): Promise<BuiltPage>;
	/** Ends the session: its worker ends, and a build waited for resolves to `unanswered`. A second call does nothing. */
	stop(): void;
}

/** Opens a preview of the project's page: a runner's `type: 'preview'`, one message per build. */
export const preview: Token<PreviewInput, PreviewSession, 'one'> = /* @__PURE__ */ defineToken<PreviewInput, PreviewSession>()('@yukibana/std#preview');
