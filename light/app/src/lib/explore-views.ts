/**
 * The compiler output views each language has (packs/CONTRACT.md, "Showing
 * compiler output"): what each view is called, which files it can show,
 * what compiles them, and the toggles its header offers. The views' client
 * (explorer.svelte.ts), their panels (dock.ts, compiler-view.ts) and the top
 * bar read it from here, so a language gains a view by an entry below and
 * its pack's explorer.js, and nothing else in the app knows which language
 * it is.
 *
 * A kind is the same view in every language that has it (`asm` is the
 * assembly of C++, Swift and Haskell alike), so its panel and its title are
 * the kind's; what changes with the language is the compiler and the
 * toggles.
 *
 * Imports nothing, so `node` can load this file directly (tests/unit/explore-views.test.mjs).
 */

/** A compiler output view: the form of the active source it shows. */
export type ExploreKind = 'typed' | 'lowered' | 'llvm-ir' | 'asm' | 'sil' | 'mir' | 'core' | 'stg' | 'cmm' | 'bytecode';

/** What a kind is called, in every language. */
export interface ExploreKindInfo {
	/** The panel's tab and the top bar's button (`LLVM IR`). */
	readonly title: string;
	/** Its short form, for a narrow top bar and a folded tab (`IR`). */
	readonly short: string;
	/** The output in a sentence's words, after "the" (`LLVM IR`, `assembly`). */
	readonly noun: string;
}

/** Every kind, in the order a language lists its views. */
export const KINDS: Readonly<Record<ExploreKind, ExploreKindInfo>> = {
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
};

/** Every kind, as a list. */
export const ALL_KINDS = Object.keys(KINDS) as ExploreKind[];

/**
 * One of a view's toggles: an option the explorer is sent
 * (`options[key]`, a boolean), with what the header shows for it.
 */
export interface ExploreToggle {
	/** The option's name in the protocol. */
	readonly key: string;
	/** Its label in the toggle strip. */
	readonly label: string;
	/** Its full name in Options. */
	readonly name: string;
	/** What it does: the strip button's title, and its line in Options. */
	readonly does: string;
	/** Whether it is on in a new session. */
	readonly on: boolean;
	/** Offered only while the output is x86-64 assembly (Intel syntax). */
	readonly x86Only?: true;
	/**
	 * Set in every view of the language at once: an option that changes the
	 * compile itself (Haskell's `-O`, which all four views come from), so the
	 * views never show two different programs, and a pack that compiles once
	 * for all of them is not made to compile twice.
	 */
	readonly shared?: true;
}

/** A view of one language. */
export interface ExploreView {
	readonly kind: ExploreKind;
	/** The Monaco language of its text (asm-languages.ts); `asm` follows the target instead (asmLanguageOf). */
	readonly monaco: string;
	readonly toggles: readonly ExploreToggle[];
}

/** What a language's views have in common. */
export interface LanguageViews {
	/** The compiler, as the header names it (`✗ clang failed`, the full command). */
	readonly compiler: string;
	/** Whether a project file is one the views can show (a C++ source, not a header). */
	readonly isSource: (path: string) => boolean;
	/** The files they show, for "Open a .c or .cpp file to see its …". */
	readonly sources: string;
	/** Whether Options offers "Change build settings…" (the language's target and flags are chosen there). */
	readonly buildSettings: boolean;
	readonly views: readonly ExploreView[];
}

const demangle = (on: boolean, how: string): ExploreToggle => ({ key: 'demangle', label: 'Demangle', name: 'Demangle', does: `Show names as written (${how}) instead of their mangled symbols`, on });
const directives: ExploreToggle = { key: 'directives', label: 'Directives', name: 'Directives', does: 'Keep the assembler directives (.section, .p2align, …) and labels nothing uses', on: false };
const library = (what: string): ExploreToggle => ({ key: 'library', label: 'Library', name: 'Library functions', does: what, on: false });
const optimize = (flag: string): ExploreToggle => ({ key: 'optimize', label: '-O', name: `Optimised (${flag})`, does: `What the optimiser makes of the code (${flag}); off, the code as compiled without optimisation`, on: false, shared: true });

const CPP_LIBRARY = library("Keep functions that come only from headers outside the project, such as the standard library's");
const SWIFT_LIBRARY = library('Keep functions the file does not define: the standard library’s and other files’, which the compiler copies in to inline or specialise');
const GHC_TICKS: ExploreToggle = { key: 'ticks', label: 'Source notes', name: 'Source notes', does: 'Keep GHC’s source notes (src<Main.hs:6:12>) in the text; the colours show the same', on: false };
const GHC_DETAILS: ExploreToggle = { key: 'details', label: 'Details', name: 'Details', does: 'Keep the binders’ IdInfo, the coercions, the module prefixes and the size reports', on: false, shared: true };

/** The languages with views, by language id (languages.ts). */
export const LANGUAGE_VIEWS: Readonly<Record<string, LanguageViews>> = {
	cpp: {
		compiler: 'clang',
		isSource: (path) => /\.(c|cc|cpp|cxx|c\+\+|C)$/.test(path),
		sources: 'a .c or .cpp file',
		buildSettings: true,
		views: [
			{ kind: 'llvm-ir', monaco: 'llvm-ir', toggles: [demangle(false, "LLVM's demangler"), directives, CPP_LIBRARY] },
			{
				kind: 'asm',
				monaco: 'asm',
				toggles: [demangle(true, "LLVM's demangler"), { key: 'intel', label: 'Intel syntax', name: 'Intel syntax', does: 'x86-64 assembly in Intel syntax (-masm=intel) instead of AT&T', on: false, x86Only: true }, directives, CPP_LIBRARY],
			},
		],
	},
	swift: {
		compiler: 'swift-frontend',
		isSource: (path) => path.endsWith('.swift'),
		sources: 'a .swift file',
		buildSettings: false,
		views: [
			{
				kind: 'sil',
				monaco: 'sil',
				toggles: [
					{ key: 'raw', label: 'Raw SIL', name: 'Raw SIL', does: 'SIL as SILGen made it (-emit-silgen), before the mandatory passes and the optimiser', on: false },
					{ key: 'details', label: 'Details', name: 'Details', does: 'Keep the debug_value instructions, the scopes and the ids and users of each value', on: false },
					SWIFT_LIBRARY,
				],
			},
			{ kind: 'llvm-ir', monaco: 'llvm-ir', toggles: [demangle(false, 'the names SIL gives them'), directives, SWIFT_LIBRARY] },
			{ kind: 'asm', monaco: 'asm', toggles: [demangle(true, 'the names SIL gives them'), directives, SWIFT_LIBRARY] },
		],
	},
	rust: {
		compiler: 'rustc',
		isSource: (path) => path.endsWith('.rs'),
		sources: 'a .rs file',
		buildSettings: false,
		views: [{ kind: 'mir', monaco: 'mir', toggles: [optimize('-C opt-level=3'), library('Keep the items none of whose code comes from the project')] }],
	},
	java: {
		compiler: 'javap',
		isSource: (path) => path.endsWith('.java'),
		sources: 'a .java file',
		buildSettings: false,
		views: [{ kind: 'bytecode', monaco: 'jvm-bytecode', toggles: [{ key: 'details', label: 'Details', name: 'Details', does: 'Constant pool indices as javap prints them, each method’s stack and locals, and the methods javac makes up (bridges, accessors)', on: false }] }],
	},
	python: {
		compiler: 'python',
		isSource: (path) => path.endsWith('.py'),
		sources: 'a .py file',
		buildSettings: false,
		views: [{ kind: 'bytecode', monaco: 'py-bytecode', toggles: [{ key: 'offsets', label: 'Offsets', name: 'Byte offsets', does: 'Show where each instruction starts in its code object, as dis does', on: false }] }],
	},
	scala: {
		compiler: 'scalac',
		isSource: (path) => path.endsWith('.scala'),
		sources: 'a .scala file',
		buildSettings: false,
		views: [
			{ kind: 'typed', monaco: 'scala', toggles: [] },
			{ kind: 'lowered', monaco: 'scala', toggles: [] },
		],
	},
	haskell: {
		compiler: 'GHC',
		isSource: (path) => path.endsWith('.hs'),
		sources: 'a .hs module',
		buildSettings: false,
		views: [
			{ kind: 'core', monaco: 'ghc-core', toggles: [optimize('-O'), GHC_TICKS, GHC_DETAILS] },
			{ kind: 'stg', monaco: 'ghc-core', toggles: [optimize('-O'), GHC_TICKS, GHC_DETAILS] },
			{ kind: 'cmm', monaco: 'cmm', toggles: [optimize('-O'), { ...GHC_TICKS, does: 'Keep the //tick lines that carry the source notes; the colours show the same' }, GHC_DETAILS] },
			{ kind: 'asm', monaco: 'asm', toggles: [optimize('-O'), demangle(true, 'Z-decoded'), directives] },
		],
	},
};

/** The views of language `id`, or null when it has none. */
export function viewsOf(id: string): LanguageViews | null {
	return LANGUAGE_VIEWS[id] ?? null;
}

/** View `kind` of language `id`, or null when the language has no such view. */
export function viewOf(id: string, kind: ExploreKind): ExploreView | null {
	return viewsOf(id)?.views.find((v) => v.kind === kind) ?? null;
}

/** The options view `kind` of language `id` starts with: each toggle's `on`. */
export function defaultOptions(id: string, kind: ExploreKind): Record<string, boolean> {
	return Object.fromEntries((viewOf(id, kind)?.toggles ?? []).map((t) => [t.key, t.on]));
}
