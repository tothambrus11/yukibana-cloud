/**
 * @yukibana/lang-javascript/download: the providers of a download of a
 * project of the package's languages, for an IDE: npm for JavaScript and
 * TypeScript, Vite for the web languages. Cheap to import: each build
 * system's key, label and availability; what writes the files (export.ts)
 * loads on a first download.
 */
import type { LanguageMeta } from '../core/index.ts';
import { always, exportProviders, type ExportBuildSpec, type LanguageDownloads } from '../std/index.ts';

/** Returns the package's downloads, loading what writes them. */
const load = async () => (await import('./export.ts')).EXPORTS;

/** Returns the download providers of a language built with `build` alone. */
const only = (build: ExportBuildSpec): LanguageDownloads => <H,>(language: LanguageMeta) => exportProviders<H>(language, [build], load);

/** A language that runs as a script: npm. */
const scripted = only({ key: 'npm', label: 'npm', available: always });
/** A web language: Vite. */
const page = only({ key: 'vite', label: 'Vite', available: always });

/** The package's languages' download providers, by key. */
export const DOWNLOADS = { javascript: scripted, typescript: scripted, web: page, p5: page, 'p5-global': page } as const satisfies Readonly<Record<string, LanguageDownloads>>;
