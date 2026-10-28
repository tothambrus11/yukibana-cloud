/**
 * A docs page of many snippets, each with its own Run and Stop, its own
 * status line and its own output panel, all sharing one RunnerPool and so
 * one runner (and one compiler) per source: what the Hylo site needs from
 * Yukibana's runtime today (section 2 of the architecture plan).
 *
 * The page holds no rule about runs. It sends what the reader asked for to
 * the pool and shows what the pool tells each snippet's handle: output is
 * routed by the handle, so one snippet's panel only ever shows its own
 * run, and the status line is `statusOf` of the run's state.
 *
 * Markup it reads, as a docs site would render it:
 *
 * ```html
 * <section class="snippet" data-snippet="answer" data-title="The answer">
 *   <textarea class="code">…main.hylo…</textarea>
 *   <template data-file="prelude.hylo">…a hidden file…</template>
 *   <input class="input">   (optional: lines typed are the program's input)
 *   …
 * </section>
 * ```
 */
import { RunnerPool, workerTransport, type RunEvent, type RunHandle, type SessionSource } from '@yukibana/runtime';
import { statusOf } from './status.ts';

/** The entry file of every snippet: what the reader edits. */
const ENTRY = 'main.hylo';

/** An element `selector` finds in `root`, which the markup must have. */
function part<T extends Element>(root: Element, selector: string): T {
	const found = root.querySelector<T>(selector);
	if (found === null) throw new Error(`a snippet has no ${selector}: the page's markup is broken`);
	return found;
}

/** Makes one element with `className` and `text`. */
function element(tag: string, className: string, text = ''): HTMLElement {
	const made = document.createElement(tag);
	made.className = className;
	made.textContent = text;
	return made;
}

/**
 * Turns every `.snippet` of the page into a runnable one, running on
 * `source` through one pool, and returns the pool. Creates no worker:
 * the first Run does (H8).
 */
export function mountPage(source: SessionSource): RunnerPool {
	const pool = new RunnerPool({ transport: workerTransport() });
	const sections = [...document.querySelectorAll<HTMLElement>('.snippet')];
	const titles = new Map(sections.map((section) => [section.dataset['snippet'] ?? '', section.dataset['title'] ?? section.dataset['snippet'] ?? '']));
	const titleOf = (snippet: string): string => titles.get(snippet) ?? snippet;
	for (const section of sections) mountSnippet(section, source, pool, titleOf);
	return pool;
}

function mountSnippet(section: HTMLElement, source: SessionSource, pool: RunnerPool, titleOf: (snippet: string) => string): void {
	const snippet = section.dataset['snippet'];
	if (snippet === undefined || snippet === '') throw new Error('a snippet has no data-snippet name');
	const code = part<HTMLTextAreaElement>(section, '.code');
	const run = part<HTMLButtonElement>(section, '.run');
	const stop = part<HTMLButtonElement>(section, '.stop');
	const status = part<HTMLElement>(section, '.status');
	const output = part<HTMLElement>(section, '.output');
	const input = section.querySelector<HTMLInputElement>('.input');
	const hidden = [...section.querySelectorAll<HTMLTemplateElement>('template[data-file]')];
	/** The snippet's latest run; a run started again replaces it, and the old one's events are no longer shown. */
	let handle: RunHandle | null = null;
	let current: object | null = null;

	const show = (event: RunEvent): void => {
		switch (event.type) {
			case 'state': {
				const shown = statusOf(event.state, titleOf);
				section.dataset['state'] = event.state.kind;
				status.replaceChildren(shown.text);
				if (shown.stoppable !== null) {
					const behind = element('button', 'stop-behind', `Stop “${titleOf(shown.stoppable)}”`);
					// Read when clicked: a run's first state arrives before pool.run returns its handle.
					behind.addEventListener('click', () => handle?.stopBehind());
					status.append(' ', behind);
				}
				stop.disabled = shown.final;
				return;
			}
			case 'output':
				output.append(element('span', event.stream, event.pieces.join('')));
				return;
			case 'notice':
				output.append(element('span', 'notice', `${event.text}\n`));
				return;
			case 'problem':
				output.append(element('span', 'problem', `${event.text}\n`));
				return;
			default:
				// Traces, kernels, timings and test reports: Hylo's runner sends none.
				return;
		}
	};

	run.addEventListener('click', () => {
		output.replaceChildren();
		const files: Record<string, string> = { [ENTRY]: code.value };
		for (const template of hidden) files[template.dataset['file'] ?? ''] = template.content.textContent ?? '';
		const mine = {};
		current = mine;
		handle = pool.run({
			snippet,
			source,
			request: { type: 'run', files, entry: ENTRY },
			onEvent: (event) => {
				if (current === mine) show(event);
			},
		});
	});
	stop.addEventListener('click', () => handle?.stop());
	input?.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			handle?.input(input.value);
			output.append(element('span', 'typed', `${input.value}\n`));
			input.value = '';
		} else if (event.key === 'd' && event.ctrlKey) {
			event.preventDefault();
			handle?.endInput();
		}
	});
}
