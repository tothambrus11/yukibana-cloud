/**
 * @yukibana/lang-kotlin/download: the providers of a download of a Kotlin
 * project, for an IDE: Gradle, the usual one, and Maven, for a project in
 * Maven's layout only (layout.ts). Cheap to import: each build system's
 * key, label and availability; what writes the files (export.ts) loads on
 * a first download.
 */
import type { LanguageMeta } from '../core/index.ts';
import { always, exportProviders, type ExportBuildSpec, type LanguageDownloads } from '../std/index.ts';
import { mavenLayout } from './layout.ts';

/** The build systems a download offers, the usual one first. */
const BUILDS: readonly ExportBuildSpec[] = [
	{ key: 'gradle', label: 'Gradle', available: always },
	{ key: 'maven', label: 'Maven', available: mavenLayout },
];

/** Returns the package's downloads, loading what writes them. */
const load = async () => (await import('./export.ts')).EXPORTS;

/** Returns a language's download providers. */
const downloads: LanguageDownloads = <H,>(language: LanguageMeta) => exportProviders<H>(language, BUILDS, load);

/** The package's languages' download providers, by key. */
export const DOWNLOADS = { kotlin: downloads } as const satisfies Readonly<Record<string, LanguageDownloads>>;
