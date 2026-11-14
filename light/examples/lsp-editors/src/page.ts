/**
 * The parts both editor pages share: finding their elements, the language
 * picker (which reopens the page with `?language=`), the status line and
 * the log. The page's state for the end-to-end test is kept as `data-`
 * attributes of `<body>`: `data-server` (the session's state kind) and
 * `data-language`.
 */
import type { LogLevel } from '@yukibana/runtime';
import { DEMO_LANGUAGES, demoLanguage, type DemoLanguage } from './languages.ts';
import type { SessionView } from './session.ts';

/** Returns the element `selector` finds under `root`; throws naming it when there is none (the page's HTML is wrong). */
export function part<T extends Element>(root: ParentNode, selector: string): T {
	const found = root.querySelector<T>(selector);
	if (found === null) throw new Error(`The page has no ${selector}.`);
	return found;
}

/** The language the page's address asks for (`?language=`), else the first. */
export function chosenLanguage(): DemoLanguage {
	return demoLanguage(new URLSearchParams(location.search).get('language'));
}

/** Fills `select` with the languages, `chosen` selected; choosing another reopens the page with it. */
export function languagePicker(select: HTMLSelectElement, chosen: DemoLanguage): void {
	for (const language of DEMO_LANGUAGES) select.append(new Option(language.label, language.key, false, language === chosen));
	select.addEventListener('change', () => {
		const url = new URL(location.href);
		url.searchParams.set('language', select.value);
		location.assign(url);
	});
	document.body.dataset['language'] = chosen.key;
	// The link to the other editor's page opens the same language.
	const other = document.querySelector<HTMLAnchorElement>('#other');
	if (other !== null) other.search = `?language=${encodeURIComponent(chosen.key)}`;
}

/** Returns the view of a session that writes to the page's status line and log. */
export function sessionView(status: HTMLElement, log: HTMLElement): SessionView {
	return {
		status: (text) => {
			status.textContent = text;
		},
		log: (level: LogLevel, text: string) => {
			const line = document.createElement('div');
			line.className = `log-${level}`;
			line.textContent = text;
			log.append(line);
			log.scrollTop = log.scrollHeight;
		},
	};
}
