/**
 * What Monaco needs of JavaScript, TypeScript and the web languages: the
 * Monaco languages whose editor features the pack's language server
 * answers, by language key, the language's own first (a web project's is
 * TypeScript). Monaco has a grammar of its own for each, so nothing is
 * registered here.
 */
export const MONACO_LANGUAGES: { readonly javascript: readonly string[]; readonly typescript: readonly string[]; readonly web: readonly string[]; readonly p5: readonly string[]; readonly 'p5-global': readonly string[] } = { javascript: ['javascript', 'typescript'], typescript: ['typescript', 'javascript'], web: ['typescript', 'javascript'], p5: ['typescript', 'javascript'], 'p5-global': ['typescript', 'javascript'] };
