/**
 * @yukibana/lang-javascript/download: the providers of a download of a
 * project of the package's languages, for an IDE: npm for JavaScript and
 * TypeScript, Vite for the web languages. Cheap to import: each build
 * system's key, label and availability; what writes the files (export.ts)
 * loads on a first download.
 */
import { always, exportProviders, type ExportBuildSpec, type LanguageDownloads } from '../std/index.ts';

/** Returns what writes the package's downloads, loading it on a first download. */
const body = async () => (await import('./export.ts')).EXPORTS;

/** A language that runs as a script: npm. */
const SCRIPT = [{ key: 'npm', label: 'npm', available: always }] as const satisfies readonly ExportBuildSpec[];
/** A web language: Vite. */
const PAGE = [{ key: 'vite', label: 'Vite', available: always }] as const satisfies readonly ExportBuildSpec[];

/**
 * The package's languages' download providers, by key. Each build system's
 * key is one of its body's `builds`, which `exportProviders` checks.
 */
export const DOWNLOADS = {
	javascript: exportProviders(SCRIPT, async () => (await body()).javascript),
	typescript: exportProviders(SCRIPT, async () => (await body()).typescript),
	web: exportProviders(PAGE, async () => (await body()).web),
	p5: exportProviders(PAGE, async () => (await body()).p5),
	'p5-global': exportProviders(PAGE, async () => (await body())['p5-global']),
} as const satisfies Readonly<Record<string, LanguageDownloads>>;
