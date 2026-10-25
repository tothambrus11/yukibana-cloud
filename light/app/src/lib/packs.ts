/**
 * Where the app's packs are: beside the page, under `packs/`, unpinned,
 * since Light's service worker keeps the whole app, packs included, on one
 * build. Every worker the app starts asks this locator for its URL, so no
 * module of the app spells out `packs/<pack>/` for itself, and the session
 * code that will take any locator (@yukibana/runtime) is handed this one.
 */
import { packIdOf, PackLocator, type PackId, type UnpinnedPackLocator } from '@yukibana/runtime';
import type { Language } from './languages';

let packs: UnpinnedPackLocator | null = null;

/**
 * The app's pack locator, made on first use: relative to the page's base,
 * so the app works from any folder of a static host, and not at import,
 * where a prerendered page has no document.
 */
export function appPacks(): UnpinnedPackLocator {
	packs ??= PackLocator.unpinned(new URL('packs/', document.baseURI));
	return packs;
}

/**
 * The pack directory of a language: its `pack`, or its id when it has
 * none (TypeScript and web projects use the JavaScript pack's). Throws for
 * one that is not a pack id ({@link packIdOf}): the languages table is the
 * app's own, so a wrong entry is a mistake for the first page that uses it
 * to show, not a value to pass on. It lives here, not in languages.ts,
 * which the Node-run tests load without the modules' package names.
 */
export function packOf(language: Language): PackId {
	const name = language.pack ?? language.id;
	const pack = packIdOf(name);
	if (pack === null) throw new RangeError(`${JSON.stringify(name)}, the pack of ${language.label}, is not a pack id`);
	return pack;
}
