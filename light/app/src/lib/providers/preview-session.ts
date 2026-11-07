/**
 * A web project's preview session (providers/preview.ts): the runner's
 * worker, the request ids and the watchdog. Loaded at the first Run of a
 * web project, not with the provider, so a first load of the page
 * downloads none of it.
 *
 * Temporary and app-side: step 6 of light/modules/DESIGN.md moves it into
 * the JavaScript language's package with its provider, unchanged.
 */
import type { Files, Path } from '@yukibana/core';
import { readFromRunner, type PreviewMessage } from '@yukibana/protocol';
import type { BuiltPage, PackLanguage, PreviewSession, RunHost } from '@yukibana/std';

/**
 * How long the runner may stay silent while building before it is given up
 * on. Its download progress counts as an answer, so the first build, which
 * loads the runner and for TypeScript the compiler, is not cut short.
 */
const SILENT_RUNNER_MS = 15_000;

/**
 * Returns a session previewing `entry` with the runner of `language`'s
 * pack, found through `host`'s packs (asked at every build, which an
 * unpinned locator answers at once, and not before: a host may make its
 * locator on first read); `report` takes what goes wrong with the
 * runner. The worker starts at the first build, and again after one that
 * failed or went silent.
 */
export function sessionOf(language: PackLanguage, entry: Path, host: RunHost, report: (text: string) => void): PreviewSession {
	let worker: Worker | null = null;
	/** Where the worker's runner.js is, once a build has located it. */
	let url: URL | null = null;
	/** The id of the latest request; older answers are dropped. */
	let requested = 0;
	/** Settles the build waited for, or null when none is. */
	let answer: ((page: BuiltPage) => void) | null = null;
	/** Fires when the runner went silent for SILENT_RUNNER_MS during a build. */
	let watchdog: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;

	const settle = (page: BuiltPage): void => {
		const waiting = answer;
		answer = null;
		clearTimeout(watchdog);
		waiting?.(page);
	};

	/**
	 * (Re)starts the watchdog on the build waited for. A runner that never
	 * answers left the panel blank and said nothing, so the terminal says so,
	 * without guessing why, and the runner is ended: the next build starts a
	 * new one rather than queueing behind it. The one case seen so far was a
	 * runner.js from before previews existed, which ignores `preview`
	 * requests, served by a service worker from before 2026-10-24 (see
	 * switchIfStale in pwa.ts). That case is gone after 2027-01-31, when
	 * switchIfStale is removed; the watchdog stays, for any runner that
	 * hangs or never loads.
	 */
	const watch = (): void => {
		clearTimeout(watchdog);
		if (!answer) return;
		watchdog = setTimeout(() => {
			report(`The preview runner (${url?.pathname ?? 'runner.js'}) has not answered for ${SILENT_RUNNER_MS / 1000} s and was stopped. ` + 'Press Reload to try again; if it happens again, reload the app.\n');
			worker?.terminate();
			worker = null;
			settle({ kind: 'unanswered' });
		}, SILENT_RUNNER_MS);
	};

	const started = (at: URL): Worker => {
		if (worker) return worker;
		url = at;
		const made = new Worker(at, { type: 'module' });
		made.onmessage = (e: MessageEvent<unknown>) => {
			if (worker !== made) return;
			// Anything from the runner, its download progress included, shows it is alive.
			watch();
			// The runner's other messages (its download progress) are not
			// the page's; one the contract does not allow is said, since a
			// malformed page would otherwise leave the panel blank in silence.
			const read = readFromRunner(e.data);
			if (read.kind === 'rejected') report(`The preview runner sent a message the pack contract does not allow: ${read.reason}.\n`);
			else if (read.kind === 'known' && read.message.type === 'page' && read.message.id === requested) {
				const page = read.message;
				settle(page.html === null ? { kind: 'errors', errors: page.errors } : { kind: 'page', html: page.html, styles: page.styles });
			}
		};
		made.onerror = (e) => {
			if (worker !== made) return;
			e.preventDefault();
			worker = null;
			report(`The preview could not be built: ${e.message || `the runner (${at.pathname}) did not load`}\n`);
			settle({ kind: 'unanswered' });
		};
		worker = made;
		return made;
	};

	return {
		entry,
		async build(files: Files): Promise<BuiltPage> {
			if (stopped) return { kind: 'unanswered' };
			let at: URL;
			try {
				at = await host.packs.file(language.pack, 'runner.js');
			} catch (e) {
				report(`The preview could not be built: ${e instanceof Error ? e.message : String(e)}\n`);
				return { kind: 'unanswered' };
			}
			if (stopped) return { kind: 'unanswered' };
			const target = started(at);
			settle({ kind: 'unanswered' });
			const { promise, resolve } = Promise.withResolvers<BuiltPage>();
			answer = resolve;
			const request: PreviewMessage = { type: 'preview', id: ++requested, files: { ...files }, entry };
			target.postMessage(request);
			watch();
			return promise;
		},
		stop(): void {
			if (stopped) return;
			stopped = true;
			settle({ kind: 'unanswered' });
			worker?.terminate();
			worker = null;
		},
	};
}
