/**
 * What both pages do the same way: start a language's server from its pack
 * as a `LanguageSession` (@yukibana/runtime), name its documents, and say
 * what it is doing in the page's status line and log. Which editor is the
 * session's client is the page's choice: Monaco through `MonacoBinding`,
 * or the textarea page's own client.
 */
import type { LoadingProgress } from '@yukibana/protocol';
import { LanguageSession, PackLocator, workspaceRoot, type LogLevel, type ServerState } from '@yukibana/runtime';
import type { PackLanguageBody } from '@yukibana/std';
import type { DemoLanguage } from './languages.ts';

/** The workspace folder every document is under, with its slash: `initialize`'s root. */
export const ROOT_URI = 'file:///workspace/';

/**
 * The workspace under {@link ROOT_URI}: `uriOf(path)` is project file
 * `path`'s URI, each segment encoded (so a name with `#` or `%` works), and
 * `pathOf(uri)` the project path of a URI, or null for one outside it.
 */
export const WORKSPACE = workspaceRoot(ROOT_URI);

/** Where the packs are: /packs/ beside the page, as vite.config.ts and test.mjs serve them. */
export const PACKS = PackLocator.unpinned(new URL('packs/', document.baseURI));

/** Says in words what a session is doing, for a status line. */
export function describeState(state: ServerState): string {
	switch (state.kind) {
		case 'starting':
			return 'Starting the language server…';
		case 'running':
			return `${state.server} is running.`;
		case 'stopped':
			return 'The language server stopped.';
		case 'failed':
			return `The language server failed: ${state.reason}`;
	}
}

/** Says in words how far a pack's download is, for a status line. */
export function describeLoading(progress: LoadingProgress): string {
	const mb = (bytes: number): string => (bytes / 1e6).toFixed(1);
	return progress.total > 0 ? `Downloading ${progress.label}: ${mb(progress.loaded)} of ${mb(progress.total)} MB` : `Downloading ${progress.label}: ${mb(progress.loaded)} MB`;
}

/** What a page shows of a session. */
export interface SessionView {
	/** The status line's text. */
	readonly status: (text: string) => void;
	/** One line of the page's log. */
	readonly log: (level: LogLevel, text: string) => void;
}

/**
 * Returns a session of `language`'s server, from `server.js` of its pack,
 * set up with the server settings of `body`, reporting to `view`. It is not
 * started: its client starts it (`MonacoBinding.start`, or
 * `LanguageSession.start` with the page's own client).
 *
 * `?trace` in the page's address logs every message to the console.
 */
export function languageSession(language: DemoLanguage, body: PackLanguageBody, view: SessionView): LanguageSession {
	const url = PACKS.url(language.pack, 'server.js');
	let state: ServerState = { kind: 'starting' };
	return new LanguageSession(new Worker(url, { type: 'module', name: url.pathname }), {
		rootUri: ROOT_URI,
		settings: body.serverSettings,
		initializationOptions: null,
		clientName: 'Yukibana LSP editors example',
		locale: navigator.language,
		trace: new URLSearchParams(location.search).has('trace') ? (direction, message) => console.debug(`lsp ${direction}`, JSON.stringify(message).slice(0, 2000)) : null,
		events: {
			state: (next) => {
				state = next;
				// For the end-to-end test (test.mjs), which waits for `running`.
				document.body.dataset['server'] = next.kind;
				view.status(describeState(next));
			},
			loading: (progress) => view.status(progress === null ? describeState(state) : describeLoading(progress)),
			log: (level, text) => view.log(level, text),
			status: (part) => view.log('info', `${part.label}: ${part.state}${part.detail ? ` (${part.detail})` : ''}`),
		},
	});
}

/**
 * Explains a session that failed to start: a worker that fails to load
 * says nothing about why, and a pack that is not installed is the usual
 * reason, so the server's URL is asked for.
 */
export async function whyNotStarted(language: DemoLanguage, error: unknown): Promise<string> {
	const url = PACKS.url(language.pack, 'server.js');
	const status = await fetch(url, { method: 'HEAD' }).then(
		(response) => response.status,
		() => 0,
	);
	if (status === 404) return `The ${language.pack} pack is not installed: ${url.pathname} was not found. Install it with light/setup (node setup/cli.mjs ${language.pack}).`;
	return `The ${language.label} language server did not start: ${error instanceof Error ? error.message : String(error)}`;
}
