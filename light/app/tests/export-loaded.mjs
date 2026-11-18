// Download as the app makes it, for the tests that ask for it as a function
// of a language and its files: every language's export is loaded once,
// through the app's instance (src/lib/yukibana.ts, its packages' providers
// of std's exportBuild and exportTooling), for its sample, and each call
// then asks the instance which build systems can build the files it is
// given, as the Download dialog does when it opens (workspace.downloadable),
// and composes them with the app's own src/lib/export.ts and
// src/lib/export-tooling.ts.
//
//   const { buildSystems, exportProject, jobsFor } = await import('./export-loaded.mjs');
import './modules-hook.mjs';

const { snapshotOf } = await import('@yukibana/core');
const { exportBuild } = await import('@yukibana/std');
const { LANGUAGES } = await import('../src/lib/languages.ts');
const { subjectOf, yukibana } = await import('../src/lib/yukibana.ts');
const app = await import('../src/lib/export.ts');
const tooling = await import('../src/lib/export-tooling.ts');

export const { CI_SERVICES, imageSetup } = tooling;

/** Each language's download, by id, loaded for its sample: every build system of it, since each can build its sample. */
const LOADED = new Map();
for (const language of LANGUAGES) {
	const subject = subjectOf(language.id);
	const download = await app.downloadOf(yukibana(), subject, snapshotOf(language.sample), new AbortController().signal);
	if (download === null) throw new Error(`${language.id} has no download`);
	const offered = yukibana().entries(subject, exportBuild).map((entry) => entry.key);
	if (download.builds.map((b) => b.id).join() !== offered.join()) throw new Error(`${language.id}: a build system cannot build the sample (${offered})`);
	LOADED.set(language.id, download);
}

/** Returns the build systems that can build `files` of `language` (the app's), its usual one first, as the instance says. */
export function buildSystems(language, files) {
	const snapshot = snapshotOf(files);
	return LOADED.get(language.id).builds.filter((b) => yukibana().availabilityOf(subjectOf(language.id), exportBuild, b.id, snapshot).kind === 'available');
}

/** Returns the project Download makes of `files` of `language` (the app's) with `options`, as the app's export.ts does. */
export function exportProject(language, files, optimization = null, options = {}) {
	return app.exportProject({ ...LOADED.get(language.id), builds: buildSystems(language, files) }, files, optimization, options);
}

/** Returns the CI jobs of a project of language `id` whose build system's CI is `ci`, as export-tooling.ts makes them. */
export function jobsFor(id, ci, files) {
	return tooling.jobsFor(LOADED.get(id).tooling, ci, files);
}
