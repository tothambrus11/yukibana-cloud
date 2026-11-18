/**
 * `useInstance`: an instance of @yukibana/core for a widget, knowing only
 * the languages it is given and borrowing the page's host.
 */
import { createInstance, type Instance } from '@yukibana/core';
import type { PackHost } from '@yukibana/std';
import { useState } from 'react';
import { useHost } from './context.tsx';
import type { LanguageDef } from './language.ts';

/** A widget's instance and what it was made of. */
export interface Yukibana {
	/** The instance: `availability`, `perform` and `has` of its languages only. */
	readonly instance: Instance<PackHost>;
	/** The page's host, which every instance shares. */
	readonly host: PackHost;
	/** Its languages, in the order given. */
	readonly languages: readonly LanguageDef[];
}

/**
 * Returns an instance of `languages` with their providers, made at the
 * first render and kept for the component's life; it holds no worker of
 * its own (the host's pool and explorers do), so nothing needs disposing.
 *
 * - Requires: `languages` is the same list on every render (a module-scope
 *   constant): a later list is ignored, never a reason for a second
 *   instance.
 * - Throws `Incoherent` (core) at the first render when two languages share
 *   a key, or two providers of one token serve one language.
 */
export function useInstance(languages: readonly LanguageDef[]): Yukibana {
	const host = useHost();
	const [made] = useState<Yukibana>(() => ({
		instance: createInstance<PackHost>({ languages: languages.map((d) => d.language), providers: languages.flatMap((d) => d.providers), host }),
		host,
		languages,
	}));
	return made;
}
