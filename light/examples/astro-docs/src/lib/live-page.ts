/**
 * A playground's live page: a web project built by its language's
 * provider of std's `preview` (the JavaScript pack's runner, `type:
 * 'preview'`), shown in a sandboxed iframe and rebuilt as the reader
 * types, with the page's console beside it.
 *
 * - The iframe is sandboxed without `allow-same-origin`, so the page has an
 *   opaque origin: it cannot reach the site's storage or DOM, and its only
 *   way out is `postMessage` (its console lines, @yukibana/protocol's
 *   `FromPage`). The runner inlines the page's stylesheets and makes its
 *   scripts `data:` URLs for that reason.
 * - The site is cross-origin isolated (COEP `require-corp`); an
 *   `about:srcdoc` document inherits that policy and fetches nothing, so it
 *   is allowed.
 * - One build at a time (a @yukibana/core `slot`): edits made while a page
 *   builds are taken together by the next build, and a build waits for
 *   {@link RELOAD_DELAY_MS} without an edit. A page that does not build
 *   leaves the last good one shown, and the errors are said.
 * - Each page gets a new iframe, as Light's preview does (a frame given a
 *   new `srcdoc` in place sometimes stays white in Chrome).
 */
import { slot, type Files, type Instance, type LanguageMeta, type ProjectSnapshot, type Slot } from '@yukibana/core';
import { isFromPage } from '@yukibana/protocol';
import { preview, type PackHost, type PreviewSession } from '@yukibana/std';

/** How long the project must go without an edit before its page is rebuilt, in milliseconds. */
export const RELOAD_DELAY_MS = 300;

/** Where a live page says what happens: the page's console, and the build's state. */
export interface LivePageOutput {
	/** A line of the page's console (with its "\n"), or a message about the runner. */
	print(stream: 'stdout' | 'stderr' | 'info', text: string): void;
	/** A new page is about to be shown: its console starts empty, as a browser's does on reload. */
	restart(): void;
	/** What the build is doing, in a sentence; empty when there is nothing to say. */
	status(text: string): void;
}

/** A page being previewed in `frameHost`, until stopped. */
export interface LivePage {
	/** Asks for the page to be built from `files` after {@link RELOAD_DELAY_MS} without another call. */
	edited(files: Files): void;
	/** Builds the page from `files` now. */
	reload(files: Files): void;
	/** Ends the session (its worker), removes the frame and stops listening. A second call does nothing. */
	stop(): void;
}

/**
 * Opens a preview of the web project `snapshot` (whose `index.html` is
 * the page) through `instance`, showing its pages in a new iframe in
 * `frameHost`; resolves once the session is open, before its first page,
 * which is built at once. Resolves to the reason when `preview` is
 * unavailable for the project; rejects when its body does not load.
 */
export async function openLivePage(instance: Instance<PackHost>, language: LanguageMeta, snapshot: ProjectSnapshot, frameHost: HTMLElement, output: LivePageOutput): Promise<LivePage | string> {
	const outcome = await instance.perform(
		{ kind: 'language', id: language.key },
		preview,
		{ report: (text: string) => output.print('info', text) },
		snapshot,
		new AbortController().signal,
	);
	if (outcome.kind !== 'done') return outcome.reason;
	return livePage(outcome.value, frameHost, output, snapshot);
}

/** Returns the live page over an open `session`, building the first page from `snapshot` now. */
function livePage(session: PreviewSession, frameHost: HTMLElement, output: LivePageOutput, snapshot: ProjectSnapshot): LivePage {
	let frame: HTMLIFrameElement | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;

	const onMessage = (event: MessageEvent<unknown>): void => {
		if (frame === null || event.source !== frame.contentWindow || !isFromPage(event.data)) return;
		output.print(event.data.type, event.data.text);
	};
	window.addEventListener('message', onMessage);

	const show = (html: string): void => {
		output.restart();
		const made = document.createElement('iframe');
		made.className = 'live-frame';
		made.title = 'The page this snippet builds';
		// Scripts, forms and alert() run; same-origin, popups and top navigation do not.
		made.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
		made.referrerPolicy = 'no-referrer';
		made.srcdoc = html;
		frame?.remove();
		frameHost.append(made);
		frame = made;
	};

	const builds: Slot<Files, void> = slot(async (files, signal) => {
		output.status('Building the page…');
		const built = await session.build(files);
		if (signal.aborted) return;
		switch (built.kind) {
			case 'page':
				show(built.html);
				output.status('');
				return;
			case 'errors':
				output.status('The page did not build; the last one stays shown.');
				for (const error of built.errors) output.print('stderr', `${error}\n`);
				return;
			case 'unanswered':
				output.status(stopped ? '' : 'The preview runner did not answer.');
				return;
		}
	});

	const build = (files: Files): void => {
		clearTimeout(timer);
		if (!stopped) void builds.submit(files);
	};
	build(snapshot.files());

	return {
		edited: (files) => {
			clearTimeout(timer);
			if (!stopped) timer = setTimeout(() => build(files), RELOAD_DELAY_MS);
		},
		reload: build,
		stop: () => {
			if (stopped) return;
			stopped = true;
			clearTimeout(timer);
			builds.dispose();
			session.stop();
			window.removeEventListener('message', onMessage);
			frame?.remove();
			frame = null;
		},
	};
}
