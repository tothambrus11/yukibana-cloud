/**
 * Preview for the web languages, as providers of @yukibana/std's
 * `preview`: the page a web project's Run shows in the Preview panel,
 * built by the JavaScript pack's runner (`type: 'preview'`, see
 * packs/javascript/README.md, "Preview"), a worker kept for as long as the
 * session lasts, so TypeScript is loaded once (preview-session.ts, loaded
 * at the first preview). Showing the page, and when to rebuild it, are
 * preview.ts's.
 *
 * Temporary and app-side: step 6 of light/modules/DESIGN.md moves each
 * language's providers into its own package, unchanged.
 */
import { AVAILABLE, pathOf, type AnyProvider, type Path, type Provider } from '@yukibana/core';
import { preview, run, type PackLanguage, type PreviewInput, type PreviewSession, type RunHost } from '@yukibana/std';
import type { LanguageId } from '../languages';

/** The page each web language previews, by language; a language not listed has no preview. */
export const PREVIEWS: Readonly<Partial<Record<LanguageId, string>>> = {
	web: 'index.html',
	p5: 'index.html',
	'p5-global': 'index.html',
};

/**
 * Returns the provider of `preview` for `language`, previewing `page`:
 * available wherever its Run is (it requires `run`), opening a session
 * whose builds go to its pack's runner. Its body is lazy
 * (preview-session.ts).
 */
export function previewProvider(language: PackLanguage, page: Path): Provider<PreviewInput, PreviewSession, RunHost, 'one'> {
	return {
		token: preview,
		subject: { kind: 'language', id: language.key },
		entry: { kind: 'one' },
		requires: [run],
		available: () => AVAILABLE,
		body: {
			kind: 'lazy',
			load: async () => {
				const { sessionOf } = await import('./preview-session.ts');
				return (input, { host }) => sessionOf(language, page, host, input.report);
			},
		},
	};
}

/**
 * Returns the preview providers of the language `id`, whose metadata is
 * `language`: one where `PREVIEWS` names its page, else none.
 *
 * - Requires: `language.key` is `id`.
 */
export function previewProvidersOf(id: LanguageId, language: PackLanguage): AnyProvider<RunHost>[] {
	if (language.key !== id) throw new RangeError(`The metadata of ${language.key} was given for ${id}.`);
	const page = PREVIEWS[id];
	return page === undefined ? [] : [previewProvider(language, pathOf(page))];
}
