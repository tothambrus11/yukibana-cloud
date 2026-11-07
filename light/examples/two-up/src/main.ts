/**
 * The page: two instances of @yukibana/core, one per snippet, each with
 * its own language and only that language's providers (as its package
 * makes them), borrowing one host, so one runner pool for the page. C++
 * is edited in Monaco, loaded after the page; Python in a plain textarea
 * (@yukibana/editors/textarea). Nothing of Light's app is imported.
 *
 * The page keeps what it made in `globalThis.twoUp`, which the end-to-end
 * test (test.mjs) reads to check that neither instance knows the other's
 * language.
 */
import { createInstance, type Instance } from '@yukibana/core';
import { textareaEditor } from '@yukibana/editors/textarea';
import { LANGUAGES as CPP } from '@yukibana/lang-cpp';
import { LANGUAGES as PYTHON } from '@yukibana/lang-python';
import { packLanguage, run, type PackHost } from '@yukibana/std';
import { PageHost } from './host.ts';
import { mountSnippet, part } from './snippet.ts';

/** What the page made, for the end-to-end test. */
interface TwoUp {
	/** The one host both instances borrow. */
	readonly host: PageHost;
	/** The C++ snippet's instance: C++ alone, with lang-cpp's providers. */
	readonly cpp: Instance<PackHost>;
	/** The Python snippet's instance: Python alone, with lang-python's providers. */
	readonly python: Instance<PackHost>;
	/** std's `run`, which the test asks each instance about. */
	readonly run: typeof run;
}

declare global {
	/** The page's host and instances (main.ts). */
	var twoUp: TwoUp | undefined;
}

const host = new PageHost(new URL('packs/', document.baseURI));

// Each language's body (its sample project, its server's settings) is
// loaded only if something asks for it, which nothing on this page does.
const cpp = packLanguage(CPP.cpp.spec, () => import('@yukibana/lang-cpp/body').then((body) => body.BODIES.cpp));
const python = packLanguage(PYTHON.python.spec, () => import('@yukibana/lang-python/body').then((body) => body.BODIES.python));

const instances: TwoUp = {
	host,
	cpp: createInstance<PackHost>({ languages: [cpp], providers: CPP.cpp.providers(cpp), host }),
	python: createInstance<PackHost>({ languages: [python], providers: PYTHON.python.providers(python), host }),
	run,
};
globalThis.twoUp = instances;

const pythonSection = part<HTMLElement>(document.body, '#python');
mountSnippet(pythonSection, instances.python, python, textareaEditor(part<HTMLTextAreaElement>(pythonSection, '.code'), python.entry));

const cppSection = part<HTMLElement>(document.body, '#cpp');
const cppText = part<HTMLTemplateElement>(cppSection, 'template.code').content.textContent ?? '';
import('./cpp-editor.ts').then(
	({ cppEditor }) => {
		mountSnippet(cppSection, instances.cpp, cpp, cppEditor(part<HTMLElement>(cppSection, '.editor'), cpp.entry, cppText));
		cppSection.dataset['editor'] = 'ready';
	},
	(error: unknown) => {
		part<HTMLElement>(cppSection, '.status').textContent = `The editor did not load: ${error instanceof Error ? error.message : String(error)}`;
	},
);
