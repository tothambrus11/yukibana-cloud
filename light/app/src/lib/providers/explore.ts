/**
 * The compiler output views each language has (packs/CONTRACT.md, "Showing
 * compiler output"), as data and as providers of @yukibana/std's
 * `explore`: what each view is called, which files it can show, what
 * compiles them, and the toggles its header offers. The views' client
 * (explorer.svelte.ts), their panels (dock.ts, compiler-view.ts) and the top
 * bar read a language's views from here (`viewsOf`), and ask the instance
 * for them (`explore`), so a language gains a view by an entry below and
 * its pack's explorer.js, and nothing else in the app knows which language
 * it is.
 *
 * A kind is the same view in every language that has it (`asm` is the
 * assembly of C++, Swift and Haskell alike), so its title is the kind's;
 * what changes with the language is the compiler and the toggles. The
 * kinds' strings are the ones they always were: the dock files a view's
 * panel as `view:<kind>`.
 *
 * Temporary and app-side: step 6 of light/modules/DESIGN.md moves each
 * language's views and provider into its own package, unchanged.
 */
import type { AnyProvider } from '@yukibana/core';
import { explorerProvider, viewIn, viewKind, type ExploreHost, type ExploreToggle, type ExploreView, type LanguageViews, type PackLanguage, type ViewKind } from '@yukibana/std';
import type { LanguageId } from '../languages';

/** What a kind is called, in every language: its title, short form and noun (see `ExploreView`). */
const KINDS = {
	typed: { title: 'Typed tree', short: 'Typed', noun: 'typed tree' },
	lowered: { title: 'Lowered tree', short: 'Lowered', noun: 'lowered tree' },
	sil: { title: 'SIL', short: 'SIL', noun: 'SIL' },
	mir: { title: 'MIR', short: 'MIR', noun: 'MIR' },
	core: { title: 'Core', short: 'Core', noun: 'GHC Core' },
	stg: { title: 'STG', short: 'STG', noun: 'STG' },
	cmm: { title: 'Cmm', short: 'Cmm', noun: 'Cmm' },
	'llvm-ir': { title: 'LLVM IR', short: 'IR', noun: 'LLVM IR' },
	asm: { title: 'Assembly', short: 'Asm', noun: 'assembly' },
	bytecode: { title: 'Bytecode', short: 'Bytecode', noun: 'bytecode' },
} as const;

/** Returns view `kind`, called as every language calls it, in Monaco language `monaco`, with `toggles`. */
const view = (kind: keyof typeof KINDS, monaco: string, toggles: readonly ExploreToggle[]): ExploreView => ({ kind: viewKind(kind), ...KINDS[kind], monaco, toggles });

/** Returns the toggle `fields` describe, offered always and setting its view's option alone unless they say otherwise. */
const toggle = (fields: Omit<ExploreToggle, 'offered' | 'sets'> & Partial<Pick<ExploreToggle, 'offered' | 'sets'>>): ExploreToggle => ({ offered: 'always', sets: 'view', ...fields });

const demangle = (on: boolean, how: string): ExploreToggle => toggle({ key: 'demangle', label: 'Demangle', name: 'Demangle', does: `Show names as written (${how}) instead of their mangled symbols`, on });
const directives = toggle({ key: 'directives', label: 'Directives', name: 'Directives', does: 'Keep the assembler directives (.section, .p2align, …) and labels nothing uses', on: false });
const library = (what: string): ExploreToggle => toggle({ key: 'library', label: 'Library', name: 'Library functions', does: what, on: false });
const optimize = (flag: string): ExploreToggle =>
	toggle({ key: 'optimize', label: '-O', name: `Optimised (${flag})`, does: `What the optimiser makes of the code (${flag}); off, the code as compiled without optimisation`, on: false, sets: 'language' });

const CPP_LIBRARY = library("Keep functions that come only from headers outside the project, such as the standard library's");
const SWIFT_LIBRARY = library('Keep functions the file does not define: the standard library’s and other files’, which the compiler copies in to inline or specialise');
const RUST_LIBRARY = library('Keep functions none of whose code comes from the project: the standard library’s and the crates’, which rustc instantiates or inlines here');
const GHC_TICKS = toggle({ key: 'ticks', label: 'Source notes', name: 'Source notes', does: 'Keep GHC’s source notes (src<Main.hs:6:12>) in the text; the colours show the same', on: false });
const GHC_DETAILS = toggle({ key: 'details', label: 'Details', name: 'Details', does: 'Keep the binders’ IdInfo, the coercions, the module prefixes and the size reports', on: false, sets: 'language' });

/** The languages with views, by language id (languages.ts); C has C++'s (`viewsOf`). */
export const LANGUAGE_VIEWS: Readonly<Partial<Record<LanguageId, LanguageViews>>> = {
	cpp: {
		compiler: 'clang',
		isSource: (path) => /\.(c|cc|cpp|cxx|c\+\+|C)$/.test(path),
		sources: 'a .c or .cpp file',
		buildSettings: true,
		views: [
			view('llvm-ir', 'llvm-ir', [demangle(false, "LLVM's demangler"), directives, CPP_LIBRARY]),
			view('asm', 'asm', [
				demangle(true, "LLVM's demangler"),
				toggle({ key: 'intel', label: 'Intel syntax', name: 'Intel syntax', does: 'x86-64 assembly in Intel syntax (-masm=intel) instead of AT&T', on: false, offered: 'x86' }),
				directives,
				CPP_LIBRARY,
			]),
		],
	},
	swift: {
		compiler: 'swift-frontend',
		isSource: (path) => path.endsWith('.swift'),
		sources: 'a .swift file',
		buildSettings: false,
		views: [
			view('sil', 'sil', [
				toggle({ key: 'raw', label: 'Raw SIL', name: 'Raw SIL', does: 'SIL as SILGen made it (-emit-silgen), before the mandatory passes and the optimiser', on: false }),
				toggle({ key: 'details', label: 'Details', name: 'Details', does: 'Keep the debug_value instructions, the scopes and the ids and users of each value', on: false }),
				SWIFT_LIBRARY,
			]),
			view('llvm-ir', 'llvm-ir', [demangle(false, 'the names SIL gives them'), directives, SWIFT_LIBRARY]),
			view('asm', 'asm', [demangle(true, 'the names SIL gives them'), directives, SWIFT_LIBRARY]),
		],
	},
	rust: {
		compiler: 'rustc',
		isSource: (path) => path.endsWith('.rs'),
		sources: 'a .rs file',
		buildSettings: true,
		// The project's target and optimisation level (Build settings), as Run compiles it.
		views: [
			view('mir', 'mir', [library('Keep the items none of whose code comes from the project')]),
			view('llvm-ir', 'llvm-ir', [demangle(true, 'Rust paths, without the hash'), directives, RUST_LIBRARY]),
			view('asm', 'asm', [demangle(true, 'Rust paths, without the hash'), directives, RUST_LIBRARY]),
		],
	},
	java: {
		compiler: 'javap',
		isSource: (path) => path.endsWith('.java'),
		sources: 'a .java file',
		buildSettings: false,
		views: [
			view('bytecode', 'jvm-bytecode', [
				toggle({ key: 'details', label: 'Details', name: 'Details', does: 'Constant pool indices as javap prints them, each method’s stack and locals, and the methods javac makes up (bridges, accessors)', on: false }),
			]),
		],
	},
	python: {
		compiler: 'python',
		isSource: (path) => path.endsWith('.py'),
		sources: 'a .py file',
		buildSettings: false,
		views: [view('bytecode', 'py-bytecode', [toggle({ key: 'offsets', label: 'Offsets', name: 'Byte offsets', does: 'Show where each instruction starts in its code object, as dis does', on: false })])],
	},
	scala: {
		compiler: 'scalac',
		isSource: (path) => path.endsWith('.scala'),
		sources: 'a .scala file',
		buildSettings: false,
		views: [view('typed', 'scala', []), view('lowered', 'scala', [])],
	},
	haskell: {
		compiler: 'GHC',
		isSource: (path) => path.endsWith('.hs'),
		sources: 'a .hs module',
		buildSettings: false,
		views: [
			view('core', 'ghc-core', [optimize('-O'), GHC_TICKS, GHC_DETAILS]),
			view('stg', 'ghc-core', [optimize('-O'), GHC_TICKS, GHC_DETAILS]),
			view('cmm', 'cmm', [optimize('-O'), { ...GHC_TICKS, does: 'Keep the //tick lines that carry the source notes; the colours show the same' }, GHC_DETAILS]),
			view('asm', 'asm', [optimize('-O'), demangle(true, 'Z-decoded'), directives]),
		],
	},
};

/** Returns the views of language `id`, or null when it has none. */
export function viewsOf(id: string): LanguageViews | null {
	// A C project's are C++'s: the same pack, compiler and sources.
	const key = id === 'c' ? 'cpp' : id;
	return Object.entries(LANGUAGE_VIEWS).find(([language]) => language === key)?.[1] ?? null;
}

/** Returns view `kind` of language `id`, or null when the language has no such view. */
export function viewOf(id: string, kind: ViewKind): ExploreView | null {
	return viewIn(viewsOf(id), kind);
}

/**
 * Returns the explore providers of the language `id`, whose metadata is
 * `language`: one where `viewsOf` has views, else none.
 *
 * - Requires: `language.key` is `id`.
 */
export function exploreProvidersOf(id: LanguageId, language: PackLanguage): AnyProvider<ExploreHost>[] {
	if (language.key !== id) throw new RangeError(`The metadata of ${language.key} was given for ${id}.`);
	const views = viewsOf(id);
	return views === null ? [] : [explorerProvider(language, views)];
}
