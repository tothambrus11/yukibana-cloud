/**
 * The article's languages, each made once and shared by the widgets that
 * offer it. Each language's body (its sample project, server settings and
 * build settings model) is an `import()` that nothing in the article asks
 * for: the widgets bring their own sources and read the settings they show
 * by name (`./settings.ts`).
 */
import { LANGUAGES as CPP_PACKAGE } from '@yukibana/lang-cpp';
import { LANGUAGES as JAVASCRIPT_PACKAGE } from '@yukibana/lang-javascript';
import { LANGUAGES as PYTHON_PACKAGE } from '@yukibana/lang-python';
import { LANGUAGES as RUST_PACKAGE } from '@yukibana/lang-rust';
import { LANGUAGES as SWIFT_PACKAGE } from '@yukibana/lang-swift';
import { defineLanguage, type LanguageDef } from '../yukibana/language.ts';

/** C++: Run, Debug, the LLVM IR and assembly views (lang-cpp). */
export const CPP: LanguageDef = defineLanguage(CPP_PACKAGE.cpp, () => import('@yukibana/lang-cpp/body').then((b) => b.BODIES.cpp), 'cpp');

/** Rust: Run and the MIR, LLVM IR and assembly views (lang-rust). */
export const RUST: LanguageDef = defineLanguage(RUST_PACKAGE.rust, () => import('@yukibana/lang-rust/body').then((b) => b.BODIES.rust), 'rust');

/** Swift: Run, Debug and the SIL, LLVM IR and assembly views (lang-swift); its pack may not be installed. */
export const SWIFT: LanguageDef = defineLanguage(SWIFT_PACKAGE.swift, () => import('@yukibana/lang-swift/body').then((b) => b.BODIES.swift), 'swift');

/** Python: Run and the bytecode view (lang-python). */
export const PYTHON: LanguageDef = defineLanguage(PYTHON_PACKAGE.python, () => import('@yukibana/lang-python/body').then((b) => b.BODIES.python), 'python');

/** JavaScript: Run; no compiler output views, which the comparison says (lang-javascript). */
export const JAVASCRIPT: LanguageDef = defineLanguage(JAVASCRIPT_PACKAGE.javascript, () => import('@yukibana/lang-javascript/body').then((b) => b.BODIES.javascript), 'javascript');
