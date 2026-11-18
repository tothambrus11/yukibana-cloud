/**
 * What Monaco needs of PHP: the Monaco languages whose editor features
 * the pack's language server answers, by language key, the language's own
 * first. Monaco has a grammar of its own for each, so nothing is
 * registered here.
 */
export const MONACO_LANGUAGES: { readonly php: readonly string[] } = { php: ['php'] };
