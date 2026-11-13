/**
 * The languages a playground may be written in, as plain data the static
 * page and the island both read: what the code block is highlighted as,
 * what its tab says, how a line comment is written (for a prelude's
 * separators), and whether Run shows a program's output or a page.
 * Nothing here loads a language package; `languages.ts` does, in the
 * browser, when a playground of that language is first hydrated.
 */

/** A playground's language, as an MDX page names it (`lang="rust"`). */
export type PlaygroundLang = 'javascript' | 'typescript' | 'cpp' | 'rust' | 'swift' | 'python' | 'web' | 'p5';

/** What a page needs to know of a language without loading it. */
export interface LangInfo {
	/** The name a reader sees: a tab, a badge. */
	readonly label: string;
	/** The Shiki grammar the static code is highlighted with. */
	readonly grammar: 'javascript' | 'typescript' | 'cpp' | 'rust' | 'swift' | 'python';
	/** The pack that runs it (`light/app/static/packs/<pack>`). */
	readonly pack: 'javascript' | 'cpp' | 'rust' | 'swift' | 'python';
	/** How a line comment starts, for the separators a prelude puts between snippets. */
	readonly comment: '//' | '#';
	/**
	 * `output`: Run prints what the program wrote. `page`: Run builds the
	 * project into a page and shows it beside the code, live (std's
	 * `preview`).
	 */
	readonly shows: 'output' | 'page';
}

/** Every language a playground can be, by its name in MDX. */
export const LANGS: Readonly<Record<PlaygroundLang, LangInfo>> = {
	javascript: { label: 'JavaScript', grammar: 'javascript', pack: 'javascript', comment: '//', shows: 'output' },
	typescript: { label: 'TypeScript', grammar: 'typescript', pack: 'javascript', comment: '//', shows: 'output' },
	cpp: { label: 'C++', grammar: 'cpp', pack: 'cpp', comment: '//', shows: 'output' },
	rust: { label: 'Rust', grammar: 'rust', pack: 'rust', comment: '//', shows: 'output' },
	swift: { label: 'Swift', grammar: 'swift', pack: 'swift', comment: '//', shows: 'output' },
	python: { label: 'Python', grammar: 'python', pack: 'python', comment: '#', shows: 'output' },
	web: { label: 'Web page', grammar: 'typescript', pack: 'javascript', comment: '//', shows: 'page' },
	p5: { label: 'p5.js', grammar: 'typescript', pack: 'javascript', comment: '//', shows: 'page' },
};

/** Returns `name` as a playground language, or throws naming it: the one place an MDX attribute becomes one. */
export function langOf(name: string): PlaygroundLang {
	if (Object.hasOwn(LANGS, name)) return name as PlaygroundLang;
	throw new RangeError(`"${name}" is not a playground language; use one of ${Object.keys(LANGS).join(', ')}.`);
}
