/**
 * What Monaco needs of Kotlin: the Monaco languages whose editor features
 * the pack's language server answers, by language key, the language's own
 * first. Monaco has a grammar of its own for each, so nothing is
 * registered here.
 */
export const MONACO_LANGUAGES: { readonly kotlin: readonly string[] } = { kotlin: ['kotlin'] };
