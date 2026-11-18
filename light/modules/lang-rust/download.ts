/**
 * @yukibana/lang-rust/download: the providers of a download of a Rust
 * project, for an IDE: Cargo. Cheap to import: each build system's key,
 * label and availability; what writes the files (export.ts) loads on a
 * first download.
 */
import { always, exportProviders, type ExportBuildSpec, type LanguageDownloads } from '../std/index.ts';

/** The build systems a download offers, the usual one first. */
const BUILDS = [{ key: 'cargo', label: 'Cargo', available: always }] as const satisfies readonly ExportBuildSpec[];

/** Returns what writes the package's downloads, loading it on a first download. */
const body = async () => (await import('./export.ts')).EXPORTS;

/**
 * The package's languages' download providers, by key. Each build system's
 * key is one of its body's `builds`, which `exportProviders` checks.
 */
export const DOWNLOADS = { rust: exportProviders(BUILDS, async () => (await body()).rust) } as const satisfies Readonly<Record<string, LanguageDownloads>>;
