/**
 * The Preview panel of a web project: its page in a sandboxed iframe,
 * reloaded live as the project changes, with the page's console in the
 * terminal.
 *
 * The page is built by the pack's runner (`type: 'preview'`, see
 * packs/javascript/README.md, "Preview"), a worker kept for as long as the
 * preview is shown, so TypeScript is loaded once: it answers with one HTML
 * document in which the stylesheets are inlined and the scripts are `data:`
 * URLs. That document is the iframe's `srcdoc`:
 *
 * - The iframe is sandboxed without `allow-same-origin`, so the page has an
 *   opaque origin: it cannot reach the app's storage, cookies or DOM, and
 *   its only way out is `postMessage`. A service worker cannot serve an
 *   opaque-origin document, and `blob:` URLs are bound to the app's origin,
 *   which is why the page carries everything inline.
 * - The app is cross-origin isolated (COEP `require-corp`); an `about:srcdoc`
 *   document inherits that policy and loads nothing over the network, so it
 *   is allowed. A page that fetches from another origin needs CORS (or, for
 *   an image, a `Cross-Origin-Resource-Policy` header) as any isolated page
 *   does.
 *
 * Live reload: a build waits for 300 ms without an edit, then asks the
 * language server for the project's errors (`ErrorCheck`) and reloads only
 * when there are none; the page shown stays, and the bar above it says why.
 * When every changed file is a stylesheet the page has inlined, its
 * `<style>` is replaced in place (the page keeps its state) without asking;
 * any other change rebuilds the page and reloads the iframe. One check or
 * build runs at a time, and edits made meanwhile are taken together by the
 * next one: each edit used to post a build to the runner, which answered
 * them all in turn, so a burst of typing left the page seconds behind. With
 * Auto reload off, edits wait for the Reload button. This is live reload,
 * not module hot replacement.
 */
import { isFromPage, readFromRunner, type Page, type PreviewMessage, type ToPage } from '@yukibana/protocol';
import type { PackId } from '@yukibana/runtime';
import type { Files } from './languages';
import { appPacks } from './packs';

/** How long the project must go without an edit before the page is rebuilt. */
const RELOAD_DELAY_MS = 300;
/**
 * How long the runner may stay silent while building before it is given up
 * on. Its download progress counts as an answer, so the first build, which
 * loads the runner and for TypeScript the compiler, is not cut short.
 */
const SILENT_RUNNER_MS = 15_000;
/** Where Auto reload is remembered, per browser. */
const AUTO_KEY = 'yukibana-light.preview.auto-reload';

/** Where the page's console and build errors go (the terminal). */
export interface PreviewOutput {
	print(kind: 'stdout' | 'stderr' | 'info', text: string): void;
}

/**
 * The project's errors now, each as `path:line:column: message`, for edits
 * made so far; none means the page may be rebuilt. Aborted when a newer edit
 * makes the answer moot (it may then answer anything).
 */
export type ErrorCheck = (signal: AbortSignal) => Promise<string[]>;

export class Preview {
	/** The panel's element, while mounted. */
	private host: HTMLElement | null = null;
	/** Whether dockview has placed the panel since it mounted: no frame is made before (`render`). */
	private placed = false;
	/** The iframe of the page shown: a new one for every page (see `render`). */
	private frame: HTMLIFrameElement | null = null;
	private placeholder: HTMLElement | null = null;
	/** The bar above the page: Auto reload, Reload and what is going on. */
	private bar: { auto: HTMLInputElement; reload: HTMLButtonElement; status: HTMLElement } | null = null;
	private worker: Worker | null = null;
	private pack: PackId | null = null;
	private entry = '';
	private files: () => Files = () => ({});
	/** The id of the latest request; older answers are dropped. */
	private requested = 0;
	/** Stylesheets of the page shown, which an edit can swap in place. */
	private styles: string[] = [];
	/** The document shown, kept so that a panel mounted later (or moved by dockview) shows it too. */
	private html: string | null = null;
	/** Files edited, created or deleted since the page shown was built. */
	private readonly stale = new Set<string>();
	/** Whether the next update builds even with nothing stale: Run and Reload. */
	private forced = false;
	/** Whether edits rebuild the page by themselves (the bar's checkbox). */
	private auto = loadAuto();
	/** Whether an update (a check, then a build) is running; at most one is. */
	private busy = false;
	/** Whether something asked for an update while one was running: another follows. */
	private again = false;
	/** Bumped by start and stop, so an update from before either drops what it was doing. */
	private session = 0;
	/** Aborts the error check running, when an edit makes it moot or the preview stops. */
	private checking: AbortController | null = null;
	/** Settles the build waited for: with the runner's page, or null when it will not come. */
	private answer: ((page: Page | null) => void) | null = null;
	/** The errors last printed, so the same ones are not printed at every edit. */
	private printed = '';
	private status = '';
	private timer: ReturnType<typeof setTimeout> | undefined;
	/** Fires when the runner went silent for SILENT_RUNNER_MS during a build. */
	private watchdog: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly output: PreviewOutput,
		private readonly check: ErrorCheck,
	) {
		addEventListener('message', (e: MessageEvent<unknown>) => {
			// Only the iframe's own messages: anything else may post to the app too.
			if (!this.frame || e.source !== this.frame.contentWindow) return;
			if (isFromPage(e.data)) this.output.print(e.data.type, e.data.text);
			// The page's own code may post anything to its parent; only what
			// claims to be the bridge's and is not well formed is worth saying.
			else if (typeof e.data === 'object' && e.data !== null && (e.data as { yukibana?: unknown }).yukibana === 'preview') {
				this.output.print('stderr', "The preview's console bridge sent a message without a stream and text; it was ignored.\n");
			}
		});
	}

	/** Whether a page is being previewed (Run was pressed and nothing stopped it). */
	get active(): boolean {
		return this.pack !== null;
	}

	/** Shows the preview in the panel's element. */
	mount(element: HTMLElement): void {
		element.append(this.createBar());
		const placeholder = document.createElement('p');
		placeholder.className = 'preview-empty';
		placeholder.textContent = 'Press Run (Ctrl+Enter) to show the page here. It reloads as you edit.';
		element.append(placeholder);
		this.host = element;
		this.placeholder = placeholder;
		this.placed = false;
		this.showStatus(this.status);
		// dockview positions the panel's overlay in an animation frame of its
		// own; two frames on, it has, and the page (shown already, or arriving
		// meanwhile) gets its frame. A frame made before that stays blank (`render`).
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				if (this.host !== element) return;
				this.placed = true;
				this.render(this.html);
			}),
		);
	}

	unmount(): void {
		this.frame?.remove();
		this.placeholder?.remove();
		this.host?.querySelector('.preview-bar')?.remove();
		this.host = null;
		this.placed = false;
		this.frame = null;
		this.placeholder = null;
		this.bar = null;
	}

	/** The bar above the page. */
	private createBar(): HTMLElement {
		const bar = document.createElement('div');
		bar.className = 'preview-bar';
		const label = document.createElement('label');
		label.className = 'preview-auto';
		label.title = `Rebuild the page ${RELOAD_DELAY_MS} ms after you stop typing, when the project has no errors`;
		const auto = document.createElement('input');
		auto.type = 'checkbox';
		auto.checked = this.auto;
		auto.addEventListener('change', () => this.setAuto(auto.checked));
		label.append(auto, 'Auto reload');
		const reload = document.createElement('button');
		reload.type = 'button';
		reload.className = 'preview-reload';
		reload.textContent = 'Reload';
		reload.title = 'Rebuild the page now, when the project has no errors';
		reload.addEventListener('click', () => this.reload());
		const status = document.createElement('span');
		status.className = 'preview-status';
		status.setAttribute('role', 'status');
		bar.append(label, reload, status);
		this.bar = { auto, reload, status };
		return bar;
	}

	/** Turns Auto reload on or off; turned on, the edits not shown yet are built. */
	setAuto(on: boolean): void {
		this.auto = on;
		saveAuto(on);
		if (this.bar) this.bar.auto.checked = on;
		if (on && this.stale.size > 0) this.flush();
		else this.showStatus(this.idleStatus());
	}

	/** Rebuilds the page now (the Reload button), when the project has no errors. */
	reload(): void {
		if (!this.active) return;
		clearTimeout(this.timer);
		this.forced = true;
		this.flush();
	}

	/** A new iframe for a page, sandboxed. */
	private createFrame(): HTMLIFrameElement {
		const frame = document.createElement('iframe');
		frame.className = 'preview-frame';
		frame.title = 'Preview';
		// Scripts, forms and alert() run; same-origin, popups and top navigation do not.
		frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
		// The motion sensors, for p5.js's deviceMoved and rotationX and the
		// like: p5 listens for devicemotion and deviceorientation in every
		// sketch, which the frame's default permissions policy refuses (a
		// console violation per sketch, and the events never come).
		frame.allow = 'accelerometer; gyroscope; magnetometer';
		frame.referrerPolicy = 'no-referrer';
		return frame;
	}

	/**
	 * Shows the page `entry` of the project, built with the runner of the
	 * pack `pack`; `files` gives the project as it is now, at each rebuild.
	 */
	start(pack: PackId, entry: string, files: () => Files): void {
		if (pack !== this.pack) this.stop();
		this.session++;
		this.checking?.abort();
		this.pack = pack;
		this.entry = entry;
		this.files = files;
		this.stale.clear();
		this.printed = '';
		this.forced = true;
		this.flush();
	}

	/** Stops previewing: the worker ends and the panel is emptied. */
	stop(): void {
		this.session++;
		clearTimeout(this.timer);
		clearTimeout(this.watchdog);
		this.checking?.abort();
		this.answer?.(null);
		this.stale.clear();
		this.forced = false;
		this.printed = '';
		this.worker?.terminate();
		this.worker = null;
		this.pack = null;
		this.styles = [];
		this.showStatus('');
		this.render(null);
	}

	/** A project file changed, was created or was deleted: reload, or swap a stylesheet, shortly. */
	changed(path: string): void {
		if (!this.active) return;
		this.stale.add(path);
		// An answer for the text before this edit is moot.
		this.checking?.abort();
		clearTimeout(this.timer);
		if (this.auto) this.timer = setTimeout(() => this.flush(), RELOAD_DELAY_MS);
		else this.showStatus(this.idleStatus());
	}

	/** Runs an update, or another one after the one running. */
	private flush(): void {
		if (this.busy) {
			this.again = true;
			return;
		}
		this.busy = true;
		void (async () => {
			try {
				do {
					this.again = false;
					await this.update();
				} while (this.again);
			} catch (e) {
				this.output.print('stderr', `The preview could not be updated: ${e instanceof Error ? e.message : String(e)}\n`);
			} finally {
				this.busy = false;
			}
		})();
	}

	/** Shows the stale files: a stylesheet swapped in place, or the page rebuilt if the project has no errors. */
	private async update(): Promise<void> {
		const session = this.session;
		if (this.pack === null) return;
		const paths = [...this.stale];
		const files = this.files();
		const window = this.frame?.contentWindow;
		if (this.html !== null && window && paths.length > 0 && paths.every((p) => this.styles.includes(p) && p in files)) {
			for (const href of paths) {
				const text = files[href];
				if (text === undefined) continue;
				const message: ToPage = { yukibana: 'css', href, text };
				window.postMessage(message, '*');
				this.stale.delete(href);
			}
			this.showStatus(this.idleStatus());
			return;
		}
		if (paths.length === 0 && !this.forced) return;

		this.showStatus('Checking for errors…');
		const controller = new AbortController();
		this.checking = controller;
		const errors = await this.check(controller.signal);
		if (this.checking === controller) this.checking = null;
		// Edited meanwhile: the next update checks the newer text (with
		// Auto reload off, the next Reload does).
		if (session !== this.session) return;
		if (controller.signal.aborted) {
			this.showStatus(this.idleStatus());
			return;
		}
		if (errors.length > 0) {
			const listed = errors.join('\n');
			if (listed !== this.printed) {
				this.printed = listed;
				const count = errors.length === 1 ? 'an error' : `${errors.length} errors`;
				this.output.print('stderr', `The preview was not reloaded: the project has ${count}.\n${listed}\n`);
			}
			this.showStatus(`Not reloaded: ${errors.length === 1 ? '1 error' : `${errors.length} errors`}, see the terminal`);
			return;
		}
		this.printed = '';
		this.forced = false;
		this.stale.clear();
		this.showStatus('Building…');
		const page = await this.build();
		if (session !== this.session) return;
		if (page === null) {
			this.showStatus('Not reloaded: the runner did not answer');
			return;
		}
		if (page.html === null) {
			// The page shown stays as it was; the reasons go to the terminal.
			this.output.print('stderr', page.errors.join('\n') + '\n');
			this.showStatus('Not reloaded: the page could not be built, see the terminal');
			return;
		}
		this.styles = page.styles;
		this.render(page.html);
		this.showStatus(this.idleStatus());
	}

	/** What the bar says while nothing runs. */
	private idleStatus(): string {
		return this.stale.size > 0 && !this.auto ? 'Edited since the last reload' : '';
	}

	private showStatus(text: string): void {
		this.status = text;
		if (!this.bar) return;
		this.bar.status.textContent = text;
		this.bar.status.title = text;
		this.bar.reload.disabled = !this.active;
	}

	/** Asks the runner for the page; null when it cannot answer (its worker failed or went silent). */
	private build(): Promise<Page | null> {
		// Only start() makes the preview active, after setting the pack; said rather than skipped, should that change.
		if (this.pack === null) {
			this.output.print('stderr', 'The preview has no pack to build it with: start() was never called.\n');
			return Promise.resolve(null);
		}
		const url = appPacks().url(this.pack, 'runner.js');
		if (!this.worker) {
			const worker = new Worker(url, { type: 'module' });
			worker.onmessage = (e: MessageEvent<unknown>) => {
				if (this.worker !== worker) return;
				// Anything from the runner, its download progress included, shows it is alive.
				this.watch(url);
				// The runner's other messages (its download progress) are not
				// the page's; one the contract does not allow is said, since a
				// malformed page would otherwise leave the panel blank in silence.
				const read = readFromRunner(e.data);
				if (read.kind === 'rejected') this.output.print('stderr', `The preview runner sent a message the pack contract does not allow: ${read.reason}.\n`);
				else if (read.kind === 'known' && read.message.type === 'page' && read.message.id === this.requested) {
					clearTimeout(this.watchdog);
					this.answer?.(read.message);
				}
			};
			worker.onerror = (e) => {
				if (this.worker !== worker) return;
				e.preventDefault();
				clearTimeout(this.watchdog);
				this.worker = null;
				this.output.print('stderr', `The preview could not be built: ${e.message || `the runner (${url.pathname}) did not load`}\n`);
				this.answer?.(null);
			};
			this.worker = worker;
		}
		const worker = this.worker;
		return new Promise<Page | null>((resolve) => {
			this.answer?.(null);
			this.answer = (page) => {
				this.answer = null;
				clearTimeout(this.watchdog);
				resolve(page);
			};
			const request: PreviewMessage = { type: 'preview', id: ++this.requested, files: { ...this.files() }, entry: this.entry };
			worker.postMessage(request);
			this.watch(url);
		});
	}

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
	private watch(url: URL): void {
		clearTimeout(this.watchdog);
		if (!this.answer) return;
		this.watchdog = setTimeout(() => {
			this.output.print(
				'stderr',
				`The preview runner (${url.pathname}) has not answered for ${SILENT_RUNNER_MS / 1000} s and was stopped. ` +
					'Press Reload to try again; if it happens again, reload the app.\n',
			);
			this.worker?.terminate();
			this.worker = null;
			this.answer?.(null);
		}, SILENT_RUNNER_MS);
	}

	/**
	 * Shows `html` (null: no page) in a new iframe, put into the panel with
	 * its document already set. The frame used to be made once, when the
	 * panel mounted, and given each page as a new `srcdoc`; in Chrome and
	 * Dia as people run them (not under test automation, whose flags hide
	 * it) that frame often stayed white for good: the page ran, its canvas
	 * drew, but nothing reached the screen. The sandboxed page is an
	 * out-of-process frame, and that one was made inside dockview's overlay
	 * (a composited layer) before the overlay was positioned and shown. A
	 * frame made afterwards, in the same place, is painted, so each page
	 * gets a new one, which is what a reload amounts to anyway.
	 */
	private render(html: string | null): void {
		this.html = html;
		if (this.placeholder) this.placeholder.hidden = html !== null;
		this.frame?.remove();
		this.frame = null;
		if (!this.host || !this.placed || html === null) return;
		const frame = this.createFrame();
		frame.srcdoc = html;
		this.host.append(frame);
		this.frame = frame;
	}
}

/** Whether Auto reload was left on in this browser; on unless turned off. */
function loadAuto(): boolean {
	try {
		return localStorage.getItem(AUTO_KEY) !== 'off';
	} catch {
		return true;
	}
}

function saveAuto(on: boolean): void {
	try {
		localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');
	} catch {
		// Storage refused (a private window, say): the choice lasts until the page is reloaded.
	}
}
