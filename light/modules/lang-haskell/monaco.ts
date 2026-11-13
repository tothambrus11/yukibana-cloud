/**
 * Haskell for Monaco, which has no grammar of its own for it: the language
 * id `haskell` for `.hs` files, the bracket, comment and indentation rules,
 * and a Monarch tokenizer (grammar.ts), loaded when the first Haskell model
 * appears. Everything that needs the type checker (errors, hover,
 * completion) comes from the Haskell pack's server; this is only what
 * colours text and what Enter and the comment commands do. Importing it
 * registers nothing: a host calls `registerHaskell` with its Monaco, which
 * is injected, never bundled (`import type` only).
 */
import type * as Monaco from 'monaco-editor';

/**
 * What Monaco needs of Haskell: the Monaco languages whose editor features
 * the pack's language server answers, by language key, the language's own
 * first.
 */
export const MONACO_LANGUAGES: { readonly haskell: readonly string[] } = { haskell: ['haskell'] };

/**
 * Registers the language `haskell` with `monaco`, the host's Monaco, and
 * its rules; its tokenizer is loaded when the first Haskell model appears,
 * and a failure to load it goes to `report`, and the text stays uncoloured
 * (Monaco asks for a language once a page).
 *
 * - Requires: Monaco's services have started, and `haskell` was not
 *   registered before: a second call would register the language twice.
 */
export function registerHaskell(monaco: typeof Monaco, report: (error: unknown) => void): void {
	monaco.languages.register({ id: 'haskell', extensions: ['.hs'], aliases: ['Haskell', 'haskell'] });
	// The rules are set now, the tokenizer when the first Haskell model
	// appears, as Monaco's own language registrations load theirs, so a
	// session in another language never downloads it. The rules were set
	// there too while the tokenizer was bundled with the page; set from a
	// module that arrives later, Zig's sometimes never reached the editor
	// (see registerZig), so they are not left to wait for it. (Setting them
	// when this module was imported, as it once was, started Monaco's
	// services before the host gave them its overrides, which then never
	// applied.)
	monaco.languages.setLanguageConfiguration('haskell', {
		comments: { lineComment: '--', blockComment: ['{-', '-}'] },
		brackets: [
			['(', ')'],
			['[', ']'],
			['{', '}'],
		],
		// No auto-closing quote after a letter: `x'` and `f''` are names.
		autoClosingPairs: [
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
			{ open: '"', close: '"', notIn: ['string', 'comment'] },
		],
		surroundingPairs: [
			{ open: '(', close: ')' },
			{ open: '[', close: ']' },
			{ open: '{', close: '}' },
			{ open: '"', close: '"' },
		],
		// Names may hold primes, which the default word pattern splits on: the
		// word under the cursor is what hover and rename are asked about.
		wordPattern: /[A-Za-z_][\w']*|[-!#$%&*+./<=>?@\\^|~:]+/,
		// Layout: after a line ending in a block keyword or `=` the next line
		// is indented, as every Haskell editor does.
		onEnterRules: [
			{
				beforeText: /(\b(where|do|of|let|in|then|else|mdo|rec|\\case)|=|->|::)\s*(--.*)?$/,
				action: { indentAction: monaco.languages.IndentAction.Indent },
			},
		],
		indentationRules: {
			increaseIndentPattern: /(\b(where|do|of|let|mdo)|=)\s*$/,
			decreaseIndentPattern: /^\s*$/,
		},
	});
	monaco.languages.onLanguage('haskell', () => {
		import('./grammar.ts').then((grammar) => monaco.languages.setMonarchTokensProvider('haskell', grammar.HASKELL_TOKENS), report);
	});
}
