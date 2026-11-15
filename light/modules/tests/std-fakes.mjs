// Stand-ins for std's tests: a language of a pack whose body has nothing in
// it, a provider always available, and an instance over a fake runner pool.
// Shared by std-run, std-debug, std-test-case and std-explore's tests.
import { AVAILABLE, createInstance, languageKey, pathOf } from '../core/index.ts';
import { packIdOf } from '../runtime/packs.ts';
import { RunnerPool } from '../runtime/run-pool.ts';
import { fakeClock, fakeTransport, OPTIONAL_STDIN, served } from './run-fakes.mjs';

/** A language `key` of pack `pack`, entry main.x, with an empty body. */
export const languageOf = (key, pack = key) => ({
	key: languageKey(key),
	label: key.toUpperCase(),
	short: null,
	pack: packIdOf(pack),
	uses: [],
	entry: pathOf('main.x'),
	extension: 'x',
	body: async () => ({ sample: {}, serverSettings: {}, properties: { properties: [], summary: () => '' } }),
});

/** A provider's availability that needs nothing and is always available. */
export const always = { requires: [], available: () => AVAILABLE };

/** An instance of `languages` and `providers` whose host has a pool over runners the test drives by hand (`runners`), and served packs. */
export function instanceOf(languages, providers) {
	const clock = fakeClock();
	const { transport, runners } = fakeTransport();
	const pool = new RunnerPool({ transport, timers: clock.timers, now: clock.now });
	const { locator } = served();
	const host = { pool, packs: locator, requires: OPTIONAL_STDIN };
	return { instance: createInstance({ languages, providers, host }), pool, runners, host };
}
