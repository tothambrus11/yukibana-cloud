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
 * Live reload: edits are collected for 300 ms. When every changed file is
 * a stylesheet the page has inlined, its `<style>` is replaced in place
 * (the page keeps its state); any other change rebuilds the page and
 * reloads the iframe. This is live reload, not module hot replacement.
 */
import { isFromPage, readFromRunner, type Page, type PreviewMessage, type ToPage } from '@yukibana/protocol';
import type { Files } from './languages';

const RELOAD_DELAY_MS = 300;
/**
 * How long a build may go unanswered before the terminal says so. The first
 * build loads the runner and, for TypeScript, the compiler, so this is
 * generous; the usual answer takes well under a second.
 */
const SILENT_RUNNER_MS = 15_000;

/** Where the page's console and build errors go (the terminal). */
export interface PreviewOutput {
	print(kind: 'stdout' | 'stderr' | 'info', text: string): void;
}

export class Preview {
	/** The panel's element, while mounted. */
	private host: HTMLElement | null = null;
	/** Whether dockview has placed the panel since it mounted: no frame is made before (`render`). */
	private placed = false;
	/** The iframe of the page shown: a new one for every page (see `render`). */
	private frame: HTMLIFrameElement | null = null;
	private placeholder: HTMLElement | null = null;
	private worker: Worker | null = null;
	private pack = '';
	private entry = '';
	private files: () => Files = () => ({});
	/** The id of the latest request; older answers are dropped. */
	private requested = 0;
	/** Stylesheets of the page shown, which an edit can swap in place. */
	private styles: string[] = [];
	/** The document shown, kept so that a panel mounted later (or moved by dockview) shows it too. */
	private html: string | null = null;
	private readonly pending = new Set<string>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	/** Fires when the latest build went unanswered for SILENT_RUNNER_MS. */
	private watchdog: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly output: PreviewOutput) {
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
		return this.worker !== null;
	}

	/** Shows the preview in the panel's element. */
	mount(element: HTMLElement): void {
		const placeholder = document.createElement('p');
		placeholder.className = 'preview-empty';
		placeholder.textContent = 'Press Run (Ctrl+Enter) to show the page here. It reloads as you edit.';
		element.append(placeholder);
		this.host = element;
		this.placeholder = placeholder;
		this.placed = false;
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
		this.host = null;
		this.placed = false;
		this.frame = null;
		this.placeholder = null;
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
	start(pack: string, entry: string, files: () => Files): void {
		if (pack !== this.pack) this.stop();
		this.pack = pack;
		this.entry = entry;
		this.files = files;
		this.pending.clear();
		this.build();
	}

	/** Stops previewing: the worker ends and the panel is emptied. */
	stop(): void {
		clearTimeout(this.timer);
		clearTimeout(this.watchdog);
		this.pending.clear();
		this.worker?.terminate();
		this.worker = null;
		this.styles = [];
		this.render(null);
	}

	/** A project file changed, was created or was deleted: reload, or swap a stylesheet, shortly. */
	changed(path: string): void {
		if (!this.active) return;
		this.pending.add(path);
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush(), RELOAD_DELAY_MS);
	}

	private flush(): void {
		const paths = [...this.pending];
		this.pending.clear();
		const files = this.files();
		const window = this.frame?.contentWindow;
		if (this.html !== null && window && paths.length > 0 && paths.every((p) => this.styles.includes(p) && p in files)) {
			for (const href of paths) {
				const text = files[href];
				if (text === undefined) continue;
				const message: ToPage = { yukibana: 'css', href, text };
				window.postMessage(message, '*');
			}
		} else this.build();
	}

	private build(): void {
		if (!this.worker) {
			const url = new URL(`packs/${this.pack}/runner.js`, document.baseURI);
			const worker = new Worker(url, { type: 'module' });
			worker.onmessage = (e: MessageEvent<unknown>) => {
				if (this.worker !== worker) return;
				// The runner's other messages (its download progress) are not
				// the page's; one the contract does not allow is said, since a
				// malformed page would otherwise leave the panel blank in silence.
				const read = readFromRunner(e.data);
				if (read.kind === 'rejected') this.output.print('stderr', `The preview runner sent a message the pack contract does not allow: ${read.reason}.\n`);
				else if (read.kind === 'known' && read.message.type === 'page') this.receive(read.message);
			};
			worker.onerror = (e) => {
				if (this.worker !== worker) return;
				e.preventDefault();
				clearTimeout(this.watchdog);
				this.worker = null;
				this.output.print('stderr', `The preview could not be built: ${e.message || `the runner (packs/${this.pack}/runner.js) did not load`}\n`);
			};
			this.worker = worker;
		}
		const request: PreviewMessage = { type: 'preview', id: ++this.requested, files: { ...this.files() }, entry: this.entry };
		this.worker.postMessage(request);
		// A runner that never answers leaves the panel blank and says nothing,
		// so the terminal says it instead, without guessing why. The one case
		// seen so far was a runner.js from before previews existed, which
		// ignores `preview` requests, served by a service worker from before
		// 2026-10-24 (see switchIfStale in pwa.ts). That case is gone after
		// 2027-01-31, when switchIfStale is removed; the watchdog stays, for
		// any runner that hangs or never loads.
		clearTimeout(this.watchdog);
		this.watchdog = setTimeout(() => {
			this.output.print(
				'stderr',
				`The preview runner (packs/${this.pack}/runner.js) has not answered for ${SILENT_RUNNER_MS / 1000} s. ` +
					'Reload the page and press Run again.\n',
			);
		}, SILENT_RUNNER_MS);
	}

	private receive(page: Page): void {
		if (page.id !== this.requested) return;
		clearTimeout(this.watchdog);
		if (page.html === null) {
			// The page shown stays as it was; the reasons go to the terminal.
			this.output.print('stderr', page.errors.join('\n') + '\n');
			return;
		}
		this.styles = page.styles;
		this.render(page.html);
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
