/**
 * A playground's language as the browser runs it: its package's spec made
 * into a language (std's `packLanguage`) and an instance of
 * @yukibana/core with that language alone and the providers its package
 * makes, borrowing the page's one host. Each package is imported when the
 * first playground of one of its languages hydrates, and each language is
 * made once per page, so two C++ playgrounds share one instance, and a
 * page with no Rust never downloads lang-rust.
 *
 * A language's body (its sample project, its server's settings) is an
 * `import()` that nothing here asks for: a docs page has its own code.
 */
import { createInstance, type Instance } from '@yukibana/core';
import { packLanguage, type PackageLanguage, type PackHost, type PackLanguage, type PackLanguageBody } from '@yukibana/std';
import { pageHost } from './host.ts';
import type { PlaygroundLang } from './langs.ts';

/** A language ready to run: the language and the instance that performs for it. */
export interface Loaded {
	readonly language: PackLanguage;
	/** An instance with `language` alone, on the page's host. */
	readonly instance: Instance<PackHost>;
}

/** Makes the language `pkg` describes and its instance on the page's host. */
function made(pkg: PackageLanguage<PackHost>, body: () => Promise<PackLanguageBody>): Loaded {
	const language = packLanguage(pkg.spec, body);
	return { language, instance: createInstance<PackHost>({ languages: [language], providers: pkg.providers(language), host: pageHost() }) };
}

/** How each language is loaded: its package's index, and its body only if asked. */
const LOADERS: Readonly<Record<PlaygroundLang, () => Promise<Loaded>>> = {
	javascript: async () => {
		const { LANGUAGES } = await import('@yukibana/lang-javascript');
		return made(LANGUAGES.javascript, () => import('@yukibana/lang-javascript/body').then((body) => body.BODIES.javascript));
	},
	typescript: async () => {
		const { LANGUAGES } = await import('@yukibana/lang-javascript');
		return made(LANGUAGES.typescript, () => import('@yukibana/lang-javascript/body').then((body) => body.BODIES.typescript));
	},
	web: async () => {
		const { LANGUAGES } = await import('@yukibana/lang-javascript');
		return made(LANGUAGES.web, () => import('@yukibana/lang-javascript/body').then((body) => body.BODIES.web));
	},
	p5: async () => {
		const { LANGUAGES } = await import('@yukibana/lang-javascript');
		return made(LANGUAGES.p5, () => import('@yukibana/lang-javascript/body').then((body) => body.BODIES.p5));
	},
	cpp: async () => {
		const { LANGUAGES } = await import('@yukibana/lang-cpp');
		return made(LANGUAGES.cpp, () => import('@yukibana/lang-cpp/body').then((body) => body.BODIES.cpp));
	},
	rust: async () => {
		const { LANGUAGES } = await import('@yukibana/lang-rust');
		return made(LANGUAGES.rust, () => import('@yukibana/lang-rust/body').then((body) => body.BODIES.rust));
	},
	swift: async () => {
		const { LANGUAGES } = await import('@yukibana/lang-swift');
		return made(LANGUAGES.swift, () => import('@yukibana/lang-swift/body').then((body) => body.BODIES.swift));
	},
	python: async () => {
		const { LANGUAGES } = await import('@yukibana/lang-python');
		return made(LANGUAGES.python, () => import('@yukibana/lang-python/body').then((body) => body.BODIES.python));
	},
};

const loading = new Map<PlaygroundLang, Promise<Loaded>>();

/**
 * Returns `lang` loaded, importing its package at the first call; every
 * later call on the page gets the same language and instance. A failed
 * import is forgotten, so the next call tries again.
 */
export function loadLanguage(lang: PlaygroundLang): Promise<Loaded> {
	let found = loading.get(lang);
	if (found === undefined) {
		found = LOADERS[lang]();
		loading.set(lang, found);
		found.catch(() => loading.delete(lang));
	}
	return found;
}
