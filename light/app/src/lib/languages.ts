/**
 * The languages the app offers: the language packages it installs
 * (light/modules/lang-<pack>), each language's description, providers,
 * body, download and Monaco languages read from its package, in the
 * order the packages are listed here. Each one names its pack (the directory under
 * `static/packs/` its server comes from), the Monaco languages that server
 * answers for, and the sample project a first visit starts with.
 *
 * Light imports every language's body with the page, the current
 * language's and the others' alike: a project is made from a sample, and
 * a language is switched to, at once (DESIGN.md N9: Light's eager set).
 * An embed imports a package's `/body` when its language is first used.
 */
import type { JsonValue, PropertyModel } from '@yukibana/core';
import { LANGUAGES as CPP } from '@yukibana/lang-cpp';
import { BODIES as CPP_BODIES } from '@yukibana/lang-cpp/body';
import { DOWNLOADS as CPP_DOWNLOADS } from '@yukibana/lang-cpp/download';
import { SINGLE_TEST as CPP_SINGLE_TEST } from '@yukibana/lang-cpp/single-test';
import { MONACO_LANGUAGES as CPP_MONACO } from '@yukibana/lang-cpp/monaco';
import { LANGUAGES as GO } from '@yukibana/lang-go';
import { BODIES as GO_BODIES } from '@yukibana/lang-go/body';
import { DOWNLOADS as GO_DOWNLOADS } from '@yukibana/lang-go/download';
import { MONACO_LANGUAGES as GO_MONACO } from '@yukibana/lang-go/monaco';
import { LANGUAGES as HASKELL } from '@yukibana/lang-haskell';
import { BODIES as HASKELL_BODIES } from '@yukibana/lang-haskell/body';
import { DOWNLOADS as HASKELL_DOWNLOADS } from '@yukibana/lang-haskell/download';
import { MONACO_LANGUAGES as HASKELL_MONACO } from '@yukibana/lang-haskell/monaco';
import { LANGUAGES as JAVA } from '@yukibana/lang-java';
import { BODIES as JAVA_BODIES } from '@yukibana/lang-java/body';
import { DOWNLOADS as JAVA_DOWNLOADS } from '@yukibana/lang-java/download';
import { MONACO_LANGUAGES as JAVA_MONACO } from '@yukibana/lang-java/monaco';
import { LANGUAGES as JAVASCRIPT } from '@yukibana/lang-javascript';
import { BODIES as JAVASCRIPT_BODIES } from '@yukibana/lang-javascript/body';
import { DOWNLOADS as JAVASCRIPT_DOWNLOADS } from '@yukibana/lang-javascript/download';
import { MONACO_LANGUAGES as JAVASCRIPT_MONACO } from '@yukibana/lang-javascript/monaco';
import { LANGUAGES as KOTLIN } from '@yukibana/lang-kotlin';
import { BODIES as KOTLIN_BODIES } from '@yukibana/lang-kotlin/body';
import { DOWNLOADS as KOTLIN_DOWNLOADS } from '@yukibana/lang-kotlin/download';
import { MONACO_LANGUAGES as KOTLIN_MONACO } from '@yukibana/lang-kotlin/monaco';
import { LANGUAGES as PHP } from '@yukibana/lang-php';
import { BODIES as PHP_BODIES } from '@yukibana/lang-php/body';
import { DOWNLOADS as PHP_DOWNLOADS } from '@yukibana/lang-php/download';
import { MONACO_LANGUAGES as PHP_MONACO } from '@yukibana/lang-php/monaco';
import { LANGUAGES as PYTHON } from '@yukibana/lang-python';
import { BODIES as PYTHON_BODIES } from '@yukibana/lang-python/body';
import { DOWNLOADS as PYTHON_DOWNLOADS } from '@yukibana/lang-python/download';
import { MONACO_LANGUAGES as PYTHON_MONACO } from '@yukibana/lang-python/monaco';
import { LANGUAGES as RUST } from '@yukibana/lang-rust';
import { BODIES as RUST_BODIES } from '@yukibana/lang-rust/body';
import { DOWNLOADS as RUST_DOWNLOADS } from '@yukibana/lang-rust/download';
import { MONACO_LANGUAGES as RUST_MONACO } from '@yukibana/lang-rust/monaco';
import { LANGUAGES as SCALA } from '@yukibana/lang-scala';
import { BODIES as SCALA_BODIES } from '@yukibana/lang-scala/body';
import { DOWNLOADS as SCALA_DOWNLOADS } from '@yukibana/lang-scala/download';
import { MONACO_LANGUAGES as SCALA_MONACO } from '@yukibana/lang-scala/monaco';
import { LANGUAGES as SWIFT } from '@yukibana/lang-swift';
import { BODIES as SWIFT_BODIES } from '@yukibana/lang-swift/body';
import { DOWNLOADS as SWIFT_DOWNLOADS } from '@yukibana/lang-swift/download';
import { MONACO_LANGUAGES as SWIFT_MONACO } from '@yukibana/lang-swift/monaco';
import { LANGUAGES as ZIG } from '@yukibana/lang-zig';
import { BODIES as ZIG_BODIES } from '@yukibana/lang-zig/body';
import { DOWNLOADS as ZIG_DOWNLOADS } from '@yukibana/lang-zig/download';
import { MONACO_LANGUAGES as ZIG_MONACO } from '@yukibana/lang-zig/monaco';
import type { LanguageDownloads, LanguageSingleTest, PackageLanguage, PackHost, PackLanguageBody } from '@yukibana/std';

/** The installed languages, by key, in the order the app lists them before the picker sorts them. */
const INSTALLED = { ...PYTHON, ...JAVASCRIPT, ...CPP, ...SWIFT, ...SCALA, ...RUST, ...PHP, ...JAVA, ...KOTLIN, ...HASKELL, ...GO, ...ZIG };

/** Identifies a language, and with it a pack and a saved project: the key of an installed language. */
export type LanguageId = keyof typeof INSTALLED;

/** Every installed language's body, by key: one for each, the compiler checks. */
const BODIES: Readonly<Record<LanguageId, PackLanguageBody>> = {
	...PYTHON_BODIES,
	...JAVASCRIPT_BODIES,
	...CPP_BODIES,
	...SWIFT_BODIES,
	...SCALA_BODIES,
	...RUST_BODIES,
	...PHP_BODIES,
	...JAVA_BODIES,
	...KOTLIN_BODIES,
	...HASKELL_BODIES,
	...GO_BODIES,
	...ZIG_BODIES,
};

/** Every installed language's download providers (its package's `/download`), by key. */
const DOWNLOADS: Readonly<Record<LanguageId, LanguageDownloads>> = {
	...PYTHON_DOWNLOADS,
	...JAVASCRIPT_DOWNLOADS,
	...CPP_DOWNLOADS,
	...SWIFT_DOWNLOADS,
	...SCALA_DOWNLOADS,
	...RUST_DOWNLOADS,
	...PHP_DOWNLOADS,
	...JAVA_DOWNLOADS,
	...KOTLIN_DOWNLOADS,
	...HASKELL_DOWNLOADS,
	...GO_DOWNLOADS,
	...ZIG_DOWNLOADS,
};

/** The providers of one test (a package's `/single-test`), by key, of the languages whose runner selects a test. */
const SINGLE_TEST: Partial<Readonly<Record<LanguageId, LanguageSingleTest>>> = { ...CPP_SINGLE_TEST };

/** Every installed language's Monaco languages, by key. */
const MONACO: Readonly<Record<LanguageId, readonly string[]>> = {
	...PYTHON_MONACO,
	...JAVASCRIPT_MONACO,
	...CPP_MONACO,
	...SWIFT_MONACO,
	...SCALA_MONACO,
	...RUST_MONACO,
	...PHP_MONACO,
	...JAVA_MONACO,
	...KOTLIN_MONACO,
	...HASKELL_MONACO,
	...GO_MONACO,
	...ZIG_MONACO,
};

/** Project files by path relative to the workspace root, `/`-separated. */
export type Files = Record<string, string>;

export interface Language {
	id: LanguageId;
	/** Its full name, as the language picker's list, the Offline dialog and an exported project's README name it. */
	label: string;
	/**
	 * A short name for a narrow top bar, where the picker shows the chosen
	 * language in a word ("Web" for "Web (HTML, CSS, TypeScript)"); absent
	 * when `label` is already short. Read it through `shortLabel`.
	 */
	short?: string;
	/** Monaco language ids whose editor features the pack's server answers (its package's `/monaco`). */
	monacoLanguages: readonly string[];
	/** Answers to the server's `workspace/configuration` requests, by section. */
	settings: Readonly<Record<string, JsonValue>>;
	/** The file the editor opens first. */
	entry: string;
	/** What a fresh project contains. Files refer to each other on purpose. */
	sample: Files;
	/** Extension suggested for a new file. */
	extension: string;
	/*
	 * Whether the pack's runner runs the project, its tests or a mutation
	 * test of it is not said here: those are the language's providers of
	 * Run, Test and Mutate, which the app asks through its instance
	 * (yukibana.ts); nor whether a runner is kept warm ahead of a run (its
	 * provider of `warm`), nor whether it runs the program or its tests
	 * under the debugger (Debug and Debug tests), nor which page a web
	 * project's Run previews (Preview), nor its compiler output views
	 * (explore). Each is a provider its package makes (`providers`).
	 */
	/**
	 * The directory under `static/packs/` whose server and runner serve this
	 * language: its id, or another language's pack (TypeScript and web
	 * projects use the JavaScript pack's).
	 */
	pack: string;
	/**
	 * The other packs its runner imports, which "Save offline" downloads
	 * with its own: `linux`, the emulator a program built for a Linux
	 * target runs on (packs/linux/README.md), for the languages that build
	 * for one. A language works without them on its default target.
	 */
	uses: readonly string[];
	/**
	 * The names of the project's configuration files, which the explorer
	 * hides until "Show configuration files" is on: a file of one of these
	 * names, in any folder, is one. They are the files the app's own
	 * controls edit (Build settings rewrites compile_flags.txt, the
	 * clang-tidy rules .clang-tidy), so a beginner never needs to open them;
	 * they stay in the project, the server reads them, Download includes
	 * them, and a tab open on one still shows. Empty for a language with
	 * none.
	 */
	configFiles: readonly string[];
	/** Its build settings, the model its body carries (properties/index.ts holds them by role). */
	properties: PropertyModel;
	/** Returns its providers, made for the language as the instance knows it (yukibana.ts): its package's root's, then its download's. */
	providers: PackageLanguage<PackHost>['providers'];
}

/** A language's short name: `short` when it has one, else its label. */
export const shortLabel = (language: Language): string => language.short ?? language.label;

/** Whether a language is C or C++: both are the C++ pack's, and build with compile_flags.txt (lang-cpp/targets.ts and its siblings). */
export function isCFamily(language: string): language is 'c' | 'cpp' {
	return language === 'c' || language === 'cpp';
}


/**
 * Returns language `id` as the app reads it, from its package's spec,
 * body and Monaco languages.
 *
 * - Requires: the package files the language under its own key (`spec.key`
 *   is `id`), which languages.test.mjs checks of every language.
 */
function languageFrom(id: LanguageId, language: PackageLanguage<PackHost>): Language {
	const { spec } = language;
	const body = BODIES[id];
	return {
		id,
		label: spec.label,
		...(spec.short === null ? {} : { short: spec.short }),
		monacoLanguages: MONACO[id],
		settings: body.serverSettings,
		entry: spec.entry,
		sample: { ...body.sample },
		extension: spec.extension,
		pack: spec.pack,
		uses: spec.uses,
		configFiles: body.configFiles,
		properties: body.properties,
		providers: (meta) => [...language.providers(meta), ...DOWNLOADS[id]<PackHost>(meta), ...(SINGLE_TEST[id]?.(meta) ?? [])],
	};
}

/** Every language, in the order `INSTALLED` lists them. */
export const LANGUAGES: readonly Language[] = (Object.keys(INSTALLED) as LanguageId[]).map((id) => languageFrom(id, INSTALLED[id]));

/** The language with this id; the ids are a closed set, so it always exists. */
export function languageOf(id: LanguageId): Language {
	const language = LANGUAGES.find((l) => l.id === id);
	if (!language) throw new Error(`unknown language ${id}`);
	return language;
}

/** Narrows a stored or typed string to a language id. */
export function isLanguageId(value: unknown): value is LanguageId {
	return LANGUAGES.some((l) => l.id === value);
}

/**
 * The languages as the picker lists them: one plain list, by name. It once
 * had sections (Scripting, Web, Compiled, JVM, Functional), which Ambrus
 * asked to remove; a name is found by its first letter. A function, so
 * importing this module sorts nothing (editor-start.test.mjs).
 */
export function pickerLanguages(): Language[] {
	return [...LANGUAGES].sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}
