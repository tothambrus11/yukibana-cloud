/**
 * @yukibana/lang-go/download: the providers of a download of a Go project,
 * for an IDE: Go modules. Cheap to import: each build system's key, label
 * and availability; what writes the files (export.ts) loads on a first
 * download.
 */
import type { LanguageMeta } from '../core/index.ts';
import { always, exportProviders, type ExportBuildSpec, type LanguageDownloads } from '../std/index.ts';

/** The build systems a download offers, the usual one first. */
const BUILDS: readonly ExportBuildSpec[] = [{ key: 'go', label: 'Go modules', available: always }];

/** Returns the package's downloads, loading what writes them. */
const load = async () => (await import('./export.ts')).EXPORTS;

/** Returns a language's download providers. */
const downloads: LanguageDownloads = <H,>(language: LanguageMeta) => exportProviders<H>(language, BUILDS, load);

/** The package's languages' download providers, by key. */
export const DOWNLOADS = { go: downloads } as const satisfies Readonly<Record<string, LanguageDownloads>>;
