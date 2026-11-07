/**
 * The Preview panel of a web project: its page in a sandboxed iframe,
 * reloaded live as the project changes, with the page's console in the
 * terminal.
 *
 * The page is built by the language's provider of @yukibana/std's
 * `preview` (lang-javascript/index.ts: the pack's runner, `type: 'preview'`,
 * see packs/javascript/README.md, "Preview"), whose session keeps its
 * worker for as long as the preview is shown, so TypeScript is loaded once:
 * it answers with one HTML document in which the stylesheets are inlined
 * and the scripts are `data:` URLs. That document is the iframe's `srcdoc`:
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
 * next one (a @yukibana/core `Slot`, whose job checks, builds and shows the
 * page): each edit used to post a build to the runner, which answered
 * them all in turn, so a burst of typing left the page seconds behind. With
 * Auto reload off, edits wait for the Reload button. This is live reload,
 * not module hot replacement.
 */
import { slot, type LanguageKey, type Slot } from '@yukibana/core';
import { isFromPage, type ToPage } from '@yukibana/protocol';
import type { PreviewSession } from '@yukibana/std';
import type { Files } from './languages';

/** How long the project must go without an edit before the page is rebuilt. */
const RELOAD_DELAY_MS = 300;
/** Where Auto reload is remembered, per browser. */
const AUTO_KEY = 'yukibana-light.preview.auto-reload';

/** Where the page's console and build errors go (the terminal). */
export interface PreviewOutput {
	print(kind: 'stdout' | 'stderr' | 'info', text: string): void;
	/**
	 * Empties the console for a page about to load, as a browser's console
	 * starts again on a reload: what it shows is that page's output only,
	 * not the last one's logs or the errors that kept it from reloading.
	 */
	restart(): void;
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
	/** The session building the page shown, while previewing (lang-javascript/index.ts). */
	private session: PreviewSession | null = null;
	/** Whose session it is: the language it was opened for, while previewing. */
	private owner: LanguageKey | null = null;
	private files: () => Files = () => ({});
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
	/**
	 * The updates (a check, then a build, then the page shown): at most one
	 * runs, and of those asked for meanwhile only the newest follows it.
	 */
	private readonly updates: Slot<null, void> = slot((_, signal) => this.update(signal));
	/** Bumped by start and stop, so an update from before either drops what it was doing. */
	private generation = 0;
	/** Aborts the error check running, when an edit makes it moot or the preview stops. */
	private checking: AbortController | null = null;
	/** The errors last printed, so the same ones are not printed at every edit. */
	private printed = '';
	private status = '';
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly output: PreviewOutput;
	private readonly check: ErrorCheck;

	/** `output` takes the page's console and why it was not reloaded; `check` says whether the project has errors. */
	constructor(output: PreviewOutput, check: ErrorCheck) {
		this.output = output;
		this.check = check;
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
		return this.session !== null;
	}

	/** Returns the session previewing a page for `owner`, which `start` keeps, or null when there is none. */
	sessionOf(owner: LanguageKey): PreviewSession | null {
		return this.owner === owner ? this.session : null;
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
	 * Shows the project's page, built by `session`, opened for `owner`;
	 * `files` gives the project as it is now, at each rebuild. Any other
	 * session is stopped first. To show the page again with
	 * the session it has, a caller passes that one (`sessionOf`): a new
	 * session would start a new worker.
	 */
	start(owner: LanguageKey, session: PreviewSession, files: () => Files): void {
		if (session !== this.session) this.stop();
		this.generation++;
		this.checking?.abort();
		this.session = session;
		this.owner = owner;
		this.files = files;
		this.stale.clear();
		this.printed = '';
		this.forced = true;
		this.flush();
	}

	/** Stops previewing: the session's worker ends and the panel is emptied. */
	stop(): void {
		this.generation++;
		clearTimeout(this.timer);
		this.checking?.abort();
		this.stale.clear();
		this.forced = false;
		this.printed = '';
		this.session?.stop();
		this.session = null;
		this.owner = null;
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

	/**
	 * Runs an update, or another one after the one running, which is told to
	 * give up its check: updates asked for meanwhile are taken together.
	 */
	private flush(): void {
		void this.updates.submit(null).then((result) => {
			if (result.kind === 'failed') this.output.print('stderr', `The preview could not be updated: ${result.error.message}\n`);
		});
	}

	/**
	 * Shows the stale files: a stylesheet swapped in place, or the page
	 * rebuilt if the project has no errors, and shown. `signal` is aborted
	 * when a newer update is asked for: the check then gives up, and the
	 * newer update checks the newer text. A build is not given up: the page
	 * it brings is shown, as every finished build always was, unless the
	 * preview was started again or stopped meanwhile.
	 */
	private async update(signal: AbortSignal): Promise<void> {
		const generation = this.generation;
		const session = this.session;
		if (session === null) return;
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
		// Its own controller, which an edit aborts (`changed`) as well as a
		// newer update: an edit must not drop a Reload asked for meanwhile.
		const controller = new AbortController();
		const supersede = (): void => controller.abort();
		signal.addEventListener('abort', supersede, { once: true });
		this.checking = controller;
		let errors: string[];
		try {
			errors = await this.check(controller.signal);
		} finally {
			signal.removeEventListener('abort', supersede);
			if (this.checking === controller) this.checking = null;
		}
		// Edited meanwhile: the next update checks the newer text (with
		// Auto reload off, the next Reload does).
		if (generation !== this.generation) return;
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
		const page = await session.build({ ...this.files() });
		if (generation !== this.generation) return;
		switch (page.kind) {
			case 'unanswered':
				this.showStatus('Not reloaded: the runner did not answer');
				return;
			case 'errors':
				// The page shown stays as it was; the reasons go to the terminal.
				this.output.print('stderr', page.errors.join('\n') + '\n');
				this.showStatus('Not reloaded: the page could not be built, see the terminal');
				return;
			case 'page':
				this.styles = [...page.styles];
				this.render(page.html);
				this.showStatus(this.idleStatus());
		}
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
		this.output.restart();
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
