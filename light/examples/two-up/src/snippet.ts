/**
 * One snippet of the page: an editor of one document, a Run and a Stop
 * button, a status line and an output panel, run through an instance of
 * @yukibana/core. The same code serves the Monaco editor and the textarea:
 * it sees an editor only as the core does, a `Project` and an
 * `EditorPort`, and a language only as its `LanguageMeta`.
 *
 * Markup it reads:
 *
 * ```html
 * <section class="snippet">
 *   …the editor…
 *   <button class="run">Run</button> <button class="stop">Stop</button> <span class="status"></span>
 *   <pre class="output"></pre>
 * </section>
 * ```
 */
import type { EditorKind, EditorPort, Instance, LanguageMeta, Project, Subject } from '@yukibana/core';
import type { RunEvent, RunHandle } from '@yukibana/runtime';
import { run, type PackHost } from '@yukibana/std';
import { statusOf } from './status.ts';

/** An editor as a snippet uses it: the project it edits, and its view of the document that runs. */
export interface SnippetEditor {
	/** The project the snippet runs: the edited document and any hidden files. */
	readonly project: Project;
	/** The editor; its `path` is the file the run starts from. */
	readonly port: EditorPort<EditorKind>;
}

/** Returns the element `selector` finds in `root`, which the markup must have. */
export function part<T extends Element>(root: Element, selector: string): T {
	const found = root.querySelector<T>(selector);
	if (found === null) throw new Error(`a snippet has no ${selector}: the page's markup is broken`);
	return found;
}

/** Makes one span of `className` holding `text`. */
function span(className: string, text: string): HTMLElement {
	const made = document.createElement('span');
	made.className = className;
	made.textContent = text;
	return made;
}

/**
 * Makes `section` the snippet `snippet` of `language` editing `editor`'s
 * project, run by `instance`: Run is enabled exactly when the instance says
 * `run` is available on the project as it is, and says why when it is not.
 * `snippet` is the pool's name for its runs: a Run stops the earlier run of
 * the same name only, so two snippets of one language each keep their own.
 *
 * - Requires: `language` is one of `instance`'s languages, and `snippet` is
 *   unique among the page's snippets.
 */
export function mountSnippet(section: HTMLElement, snippet: string, instance: Instance<PackHost>, language: LanguageMeta, editor: SnippetEditor): void {
	const subject: Subject = { kind: 'language', id: language.key };
	const button = part<HTMLButtonElement>(section, '.run');
	const stop = part<HTMLButtonElement>(section, '.stop');
	const status = part<HTMLElement>(section, '.status');
	const output = part<HTMLElement>(section, '.output');
	/** The snippet's latest run; a run started again replaces it, and the old one's events are no longer shown. */
	let handle: RunHandle | null = null;
	let current: object | null = null;

	const refresh = (): void => {
		const availability = instance.availability(subject, run, editor.project.snapshot());
		button.disabled = availability.kind === 'unavailable';
		button.title = availability.kind === 'unavailable' ? availability.reason : `Run ${language.label}`;
	};
	refresh();
	editor.project.onChange(refresh);

	const show = (event: RunEvent): void => {
		switch (event.type) {
			case 'state':
				section.dataset['state'] = event.state.kind;
				status.textContent = statusOf(event.state);
				stop.disabled = event.state.kind === 'ended' || event.state.kind === 'stopped' || event.state.kind === 'unavailable' || event.state.kind === 'failed';
				return;
			case 'output':
				output.append(span(event.stream, event.pieces.join('')));
				return;
			case 'notice':
			case 'problem':
				output.append(span(event.type, `${event.text}\n`));
				return;
			default:
				return;
		}
	};

	button.addEventListener('click', () => {
		output.replaceChildren();
		const snapshot = editor.project.snapshot();
		const mine = {};
		current = mine;
		// Until this run's handle arrives, Stop has nothing to stop: never the replaced run.
		handle = null;
		const onEvent = (event: RunEvent): void => {
			if (current === mine) show(event);
		};
		const input = { files: snapshot.files(), entry: editor.port.path, options: null, snippet, onEvent };
		instance.perform(subject, run, input, snapshot, new AbortController().signal).then(
			(outcome) => {
				if (current !== mine) return;
				if (outcome.kind === 'done') handle = outcome.value;
				else show({ type: 'problem', text: outcome.reason });
			},
			(error: unknown) => {
				if (current === mine) show({ type: 'problem', text: error instanceof Error ? error.message : String(error) });
			},
		);
	});
	stop.addEventListener('click', () => handle?.stop());
}
