/**
 * Zig for Monaco, which has no grammar of its own for it: the language id
 * `zig` for `.zig` and `.zon` files, the bracket, comment and indentation
 * rules, and a Monarch tokenizer (grammar.ts), loaded when the first Zig
 * model appears. Everything that needs ZLS or the compiler (errors, hover,
 * completion, semantic colours) comes from the Zig pack's server; this is
 * only what colours text before it answers and what Enter and the comment
 * commands do. Importing it registers nothing: a host calls `registerZig`
 * with its Monaco, which is injected, never bundled (`import type` only).
 */
import type * as Monaco from 'monaco-editor';

/**
 * What Monaco needs of Zig: the Monaco languages whose editor features
 * the pack's language server answers, by language key, the language's own
 * first.
 */
export const MONACO_LANGUAGES: { readonly zig: readonly string[] } = { zig: ['zig'] };

/**
 * Registers the language `zig` with `monaco`, the host's Monaco, and its
 * rules; its tokenizer is loaded when the first Zig model appears, and a
 * failure to load it goes to `report`, and the text stays uncoloured (Monaco
 * asks for a language once a page).
 *
 * - Requires: Monaco's services have started, and `zig` was not registered
 *   before: a second call would register the language twice.
 */
export function registerZig(monaco: typeof Monaco, report: (error: unknown) => void): void {
	monaco.languages.register({ id: 'zig', extensions: ['.zig', '.zon'], aliases: ['Zig', 'zig'] });
	// The bracket, comment and indentation rules are set now, the tokenizer
	// when the first Zig model appears. Set from onLanguage as well, the
	// rules sometimes never reached the editor: braces were not closed and
	// Enter did not indent, in one session in two (tests/e2e.mjs, whose
	// member access then had no completion). They are a few objects, and the
	// services have started by now (startEditor calls this after them).
	monaco.languages.setLanguageConfiguration('zig', {
		comments: { lineComment: '//' },
		brackets: [
			['(', ')'],
			['[', ']'],
			['{', '}'],
		],
		autoClosingPairs: [
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
			{ open: '"', close: '"', notIn: ['string', 'comment'] },
			{ open: "'", close: "'", notIn: ['string', 'comment'] },
		],
		surroundingPairs: [
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
			{ open: '"', close: '"' },
		],
		// @"quoted identifiers" and builtins are one word each.
		wordPattern: /@"(?:[^"\\]|\\.)*"|@?[A-Za-z_]\w*|-?\d[\w.]*/,
		indentationRules: {
			increaseIndentPattern: /[{([]\s*(\/\/.*)?$/,
			decreaseIndentPattern: /^\s*[})\]]/,
		},
	});
	// The tokenizer is loaded when the first Zig model appears, as
	// registerHaskell's is and for the same reason.
	monaco.languages.onLanguage('zig', () => {
		import('./grammar.ts').then((grammar) => monaco.languages.setMonarchTokensProvider('zig', grammar.ZIG_TOKENS), report);
	});
}
