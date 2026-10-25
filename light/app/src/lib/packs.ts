/**
 * Where the app's packs are: beside the page, under `packs/`, unpinned,
 * since Light's service worker keeps the whole app, packs included, on one
 * build. Every worker the app starts asks this locator for its URL, so no
 * module of the app spells out `packs/<pack>/` for itself, and the session
 * code that will take any locator (@yukibana/runtime) is handed this one.
 */
import { PROTOCOL_MAJOR, type Requires } from '@yukibana/protocol';
import { packIdOf, PackLocator, type PackId, type SessionSource, type UnpinnedPackLocator } from '@yukibana/runtime';
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

/**
 * What the app's runners need, stated by the app itself until each pack
 * ships its needs in a pack.json (M1b-data and PM1 in the architecture
 * plan): the most any of them asks today. Standard input needs a
 * cross-origin isolated page and is the only thing that does without it;
 * C++'s Linux target and JavaScript's mutation testing start workers from
 * their pack's URL. Light's page is isolated and serves its packs beside
 * it, so it always meets this; a page that is not isolated is told that
 * programs cannot read input, as before.
 */
const APP_RUNNER_NEEDS: Requires = { runner: { default: { crossOriginIsolated: 'optional-stdin', sameOriginPacks: true } } };

/**
 * What a language's runs start from: its pack (packOf), found through
 * the app's locator, under the language's name. Languages that share a
 * pack share its runner (the page's RunnerPool keys runners by where the
 * pack is, not by this object).
 */
export function runnerSourceOf(language: Language): SessionSource {
	return {
		pack: { id: packOf(language), name: language.label, protocol: PROTOCOL_MAJOR, build: null, requires: APP_RUNNER_NEEDS },
		locator: appPacks(),
	};
}
