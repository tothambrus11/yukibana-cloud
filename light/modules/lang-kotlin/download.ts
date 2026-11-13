/**
 * @yukibana/lang-kotlin/download: the providers of a download of a Kotlin
 * project, for an IDE: Gradle, the usual one, and Maven, for a project in
 * Maven's layout only (layout.ts). Cheap to import: each build system's
 * key, label and availability; what writes the files (export.ts) loads on
 * a first download.
 */
import { always, exportProviders, type ExportBuildSpec, type LanguageDownloads } from '../std/index.ts';
import { mavenLayout } from './layout.ts';

/** The build systems a download offers, the usual one first. */
const BUILDS = [
	{ key: 'gradle', label: 'Gradle', available: always },
	{ key: 'maven', label: 'Maven', available: mavenLayout },
] as const satisfies readonly ExportBuildSpec[];

/** Returns what writes the package's downloads, loading it on a first download. */
const body = async () => (await import('./export.ts')).EXPORTS;

/**
 * The package's languages' download providers, by key. Each build system's
 * key is one of its body's `builds`, which `exportProviders` checks.
 */
export const DOWNLOADS = { kotlin: exportProviders(BUILDS, async () => (await body()).kotlin) } as const satisfies Readonly<Record<string, LanguageDownloads>>;
