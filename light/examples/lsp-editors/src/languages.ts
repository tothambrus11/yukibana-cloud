/**
 * The languages both pages offer, each as its package describes it: the
 * pack whose language server answers, the sample project to open (the
 * package's body, loaded only when the language is chosen), the entry file
 * shown first, and the Monaco languages the server's features are for.
 * Nothing here is the example's own but the choice of languages and their
 * order.
 */
import { LANGUAGES as CPP } from '@yukibana/lang-cpp';
import { MONACO_LANGUAGES as CPP_MONACO } from '@yukibana/lang-cpp/monaco';
import { LANGUAGES as GO } from '@yukibana/lang-go';
import { MONACO_LANGUAGES as GO_MONACO } from '@yukibana/lang-go/monaco';
import { LANGUAGES as JAVASCRIPT } from '@yukibana/lang-javascript';
import { MONACO_LANGUAGES as JAVASCRIPT_MONACO } from '@yukibana/lang-javascript/monaco';
import { LANGUAGES as PYTHON } from '@yukibana/lang-python';
import { MONACO_LANGUAGES as PYTHON_MONACO } from '@yukibana/lang-python/monaco';
import { LANGUAGES as RUST } from '@yukibana/lang-rust';
import { MONACO_LANGUAGES as RUST_MONACO } from '@yukibana/lang-rust/monaco';
import { packLanguage, type PackLanguage, type PackLanguageBody, type PackLanguageSpec } from '@yukibana/std';

/**
 * A language a page can open: the package's language (its key, which is
 * also the `?language=` of a page's URL; its label; the pack whose
 * `server.js` is the language server; the entry file shown first; its
 * body, the sample project and the server's settings), with what an editor
 * needs besides.
 */
export interface DemoLanguage extends PackLanguage {
	/** The Monaco languages the server answers for, the language's own first: also its LSP language id. */
	readonly monacoLanguages: readonly string[];
}

const demo = (spec: PackLanguageSpec, monacoLanguages: readonly string[], body: () => Promise<PackLanguageBody>): DemoLanguage => ({ ...packLanguage(spec, body), monacoLanguages });

/** The languages, in the order the pages list them. */
export const DEMO_LANGUAGES: readonly DemoLanguage[] = [
	demo(PYTHON.python.spec, PYTHON_MONACO.python, () => import('@yukibana/lang-python/body').then((b) => b.BODIES.python)),
	demo(CPP.cpp.spec, CPP_MONACO.cpp, () => import('@yukibana/lang-cpp/body').then((b) => b.BODIES.cpp)),
	demo(RUST.rust.spec, RUST_MONACO.rust, () => import('@yukibana/lang-rust/body').then((b) => b.BODIES.rust)),
	demo(GO.go.spec, GO_MONACO.go, () => import('@yukibana/lang-go/body').then((b) => b.BODIES.go)),
	demo(JAVASCRIPT.typescript.spec, JAVASCRIPT_MONACO.typescript, () => import('@yukibana/lang-javascript/body').then((b) => b.BODIES.typescript)),
	demo(JAVASCRIPT.javascript.spec, JAVASCRIPT_MONACO.javascript, () => import('@yukibana/lang-javascript/body').then((b) => b.BODIES.javascript)),
];

/** The language `key` names, or the first when it names none (a page opened without `?language=`). */
export function demoLanguage(key: string | null): DemoLanguage {
	const first = DEMO_LANGUAGES[0];
	if (first === undefined) throw new Error('No languages to show.');
	return DEMO_LANGUAGES.find((language) => language.key === key) ?? first;
}
