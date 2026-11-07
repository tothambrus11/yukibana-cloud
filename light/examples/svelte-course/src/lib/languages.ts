/**
 * The languages a course may use: each one's package (its spec and
 * providers, cheap to import), its body (loaded by `import()` only if
 * something asks for it, which nothing on this page does), the Monaco
 * grammar its editor highlights with, and the framework its test reports
 * come from.
 *
 * Adding a language is a row here and a `file:` link in package.json.
 */
import type { AnyProvider } from '@yukibana/core';
import { LANGUAGES as CPP } from '@yukibana/lang-cpp';
import { LANGUAGES as JAVASCRIPT } from '@yukibana/lang-javascript';
import { LANGUAGES as PYTHON } from '@yukibana/lang-python';
import { LANGUAGES as RUST } from '@yukibana/lang-rust';
import { LANGUAGES as SWIFT } from '@yukibana/lang-swift';
import { packLanguage, type PackHost, type PackLanguage, type PackLanguageBody, type PackLanguageSpec } from '@yukibana/std';
import type { ReportFormat } from './report.ts';

/** A language a course may use, by its key in its package. */
export type CourseLanguage = 'python' | 'javascript' | 'rust' | 'cpp' | 'swift';

/** What the course needs of one language. */
export interface LanguageRow {
	/** Its package's description of it. */
	readonly spec: PackLanguageSpec;
	/** Its package's providers for the language made of `spec`. */
	readonly providers: (language: PackLanguage) => readonly AnyProvider<PackHost>[];
	/** Loads its body: an `import()` of the package's `/body`, made at most once by the instance. */
	readonly body: () => Promise<PackLanguageBody>;
	/** Monaco's language id for its grammar (`monaco-editor/languages/definitions/<id>`), which src/lib/monaco-editor.ts registers. */
	readonly monaco: string;
	/** The framework whose report a Check reads (report.ts). */
	readonly report: ReportFormat;
	/** A short tag for the exercise card, and the accent it is drawn in (a CSS custom property of page.css). */
	readonly tag: string;
}

/** Every language a course may use. */
export const LANGUAGE_ROWS: Readonly<Record<CourseLanguage, LanguageRow>> = {
	python: {
		spec: PYTHON.python.spec,
		providers: PYTHON.python.providers,
		body: () => import('@yukibana/lang-python/body').then((body) => body.BODIES.python),
		monaco: 'python',
		report: 'pytest',
		tag: 'py',
	},
	javascript: {
		spec: JAVASCRIPT.javascript.spec,
		providers: JAVASCRIPT.javascript.providers,
		body: () => import('@yukibana/lang-javascript/body').then((body) => body.BODIES.javascript),
		monaco: 'javascript',
		report: 'node-test',
		tag: 'js',
	},
	rust: {
		spec: RUST.rust.spec,
		providers: RUST.rust.providers,
		body: () => import('@yukibana/lang-rust/body').then((body) => body.BODIES.rust),
		monaco: 'rust',
		report: 'libtest',
		tag: 'rs',
	},
	cpp: {
		spec: CPP.cpp.spec,
		providers: CPP.cpp.providers,
		body: () => import('@yukibana/lang-cpp/body').then((body) => body.BODIES.cpp),
		monaco: 'cpp',
		report: 'gtest',
		tag: 'c++',
	},
	swift: {
		spec: SWIFT.swift.spec,
		providers: SWIFT.swift.providers,
		body: () => import('@yukibana/lang-swift/body').then((body) => body.BODIES.swift),
		monaco: 'swift',
		report: 'xctest',
		tag: 'swift',
	},
};

/** Returns the language of `row`, as std's `packLanguage` checks and makes it from the package's spec. */
export function languageOf(row: LanguageRow): PackLanguage {
	return packLanguage(row.spec, row.body);
}
