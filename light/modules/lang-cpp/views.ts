/**
 * The compiler output views of C and C++ (packs/CONTRACT.md, "Showing
 * compiler output"), as their providers of @yukibana/std's `explore`
 * carry them (index.ts): what compiles them (clang), which files they can
 * show, and the toggles each view's header offers. What each kind is
 * called is std's (explore-views.ts); the kinds' strings are the ones they
 * always were.
 */
import { DIRECTIVES_TOGGLE, demangleToggle, exploreToggle, exploreView, libraryToggle, type ExploreToggle, type LanguageViews } from '../std/index.ts';

const CPP_LIBRARY: ExploreToggle = libraryToggle("Keep functions that come only from headers outside the project, such as the standard library's");

/** C's and C++'s views: one pack, compiler and set of sources; C's provider of `explore` carries the same object as C++'s. */
export const CPP_VIEWS: LanguageViews = {
	compiler: 'clang',
	isSource: (path) => /\.(c|cc|cpp|cxx|c\+\+|C)$/.test(path),
	sources: 'a .c or .cpp file',
	buildSettings: true,
	chosenFlags: 'clang',
	views: [
		exploreView('llvm-ir', 'llvm-ir', [demangleToggle(false, "LLVM's demangler"), DIRECTIVES_TOGGLE, CPP_LIBRARY]),
		exploreView('asm', 'asm', [
			demangleToggle(true, "LLVM's demangler"),
			exploreToggle({ key: 'intel', label: 'Intel syntax', name: 'Intel syntax', does: 'x86-64 assembly in Intel syntax (-masm=intel) instead of AT&T', on: false, offered: 'x86' }),
			DIRECTIVES_TOGGLE,
			CPP_LIBRARY,
		]),
	],
};
