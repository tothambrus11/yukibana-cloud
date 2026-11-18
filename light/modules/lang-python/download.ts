/**
 * @yukibana/lang-python/download: the providers of a download of a Python
 * project, for an IDE: a pyproject.toml, which pip and uv both read. Cheap
 * to import: each build system's key, label and availability; what writes
 * the files (export.ts) loads on a first download.
 */
import { always, exportProviders, type ExportBuildSpec, type LanguageDownloads } from '../std/index.ts';

/** The build systems a download offers, the usual one first. */
const BUILDS = [{ key: 'pyproject', label: 'pyproject.toml (pip or uv)', available: always }] as const satisfies readonly ExportBuildSpec[];

/** Returns what writes the package's downloads, loading it on a first download. */
const body = async () => (await import('./export.ts')).EXPORTS;

/**
 * The package's languages' download providers, by key. Each build system's
 * key is one of its body's `builds`, which `exportProviders` checks.
 */
export const DOWNLOADS = { python: exportProviders(BUILDS, async () => (await body()).python) } as const satisfies Readonly<Record<string, LanguageDownloads>>;
