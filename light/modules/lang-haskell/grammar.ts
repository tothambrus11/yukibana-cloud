/**
 * Haskell's Monarch tokenizer, which colours its text before the
 * language server answers: loaded when the first model of the language
 * appears (monaco.ts `registerHaskell`), so a session in another language
 * never downloads it. Plain data: it registers nothing.
 */
import type * as Monaco from 'monaco-editor';

/** Haskell's tokens, as `setMonarchTokensProvider` takes them. */
export const HASKELL_TOKENS: Monaco.languages.IMonarchLanguage = {
	defaultToken: '',
	tokenPostfix: '.hs',
	keywords: [
		'case', 'class', 'data', 'default', 'deriving', 'do', 'else', 'forall', 'foreign', 'if', 'import', 'in',
		'infix', 'infixl', 'infixr', 'instance', 'let', 'mdo', 'module', 'newtype', 'of', 'pattern', 'proc',
		'qualified', 'rec', 'then', 'type', 'where', 'family', 'stock', 'anyclass', 'via',
	],
	// Reserved operators: punctuation of the language, not functions.
	reservedOps: ['..', ':', '::', '=', '\\', '|', '<-', '->', '@', '~', '=>'],
	symbols: /[-!#$%&*+./<=>?@\\^|~:]+/,
	escapes: /\\(?:[abfnrtv\\"'&]|\^[A-Z@[\\\]^_]|NUL|SOH|STX|ETX|EOT|ENQ|ACK|BEL|BS|HT|LF|VT|FF|CR|SO|SI|DLE|DC[1-4]|NAK|SYN|ETB|CAN|EM|SUB|ESC|FS|GS|RS|US|SP|DEL|\d+|o[0-7]+|x[0-9A-Fa-f]+)/,
	tokenizer: {
		root: [
			[/\{-#/, 'annotation', '@pragma'],
			[/\{-/, 'comment', '@comment'],
			// `--` starts a comment only when the dashes are not part of a longer
			// operator: `-->` is an operator, `---` a comment.
			[/--+(?![!#$%&*+./<=>?@\\^|~:]).*$/, 'comment'],
			// Qualified names: the module part is a namespace, then a name, a
			// constructor or an operator.
			[/(?:[A-Z][\w']*\.)+[a-z_][\w']*/, 'identifier'],
			[/(?:[A-Z][\w']*\.)*[A-Z][\w']*/, 'type.identifier'],
			[/[a-z_][\w']*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
			[/0[xX][0-9a-fA-F_]+/, 'number.hex'],
			[/0[oO][0-7_]+/, 'number.octal'],
			[/0[bB][01_]+/, 'number.binary'],
			[/\d[\d_]*(\.\d[\d_]*)?([eE][-+]?\d+)?/, 'number'],
			[/"/, 'string', '@string'],
			// A character literal, not a prime: the quote follows no name here,
			// since the name rules above take their primes with them.
			[/'(?:[^\\']|@escapes)'/, 'string'],
			[/`[A-Za-z_][\w'.]*`/, 'operator'],
			// Only brackets may be @brackets: Monarch gives up on the rest of the
			// line at a comma that is.
			[/[()[\]{}]/, '@brackets'],
			[/[,;]/, 'delimiter'],
			[/@symbols/, { cases: { '@reservedOps': 'keyword.operator', '@default': 'operator' } }],
			[/\s+/, 'white'],
		],
		// Block comments nest in Haskell.
		comment: [
			[/[^{-]+/, 'comment'],
			[/\{-/, 'comment', '@push'],
			[/-\}/, 'comment', '@pop'],
			[/[{-]/, 'comment'],
		],
		pragma: [
			[/[^#]+/, 'annotation'],
			[/#-\}/, 'annotation', '@pop'],
			[/#/, 'annotation'],
		],
		string: [
			[/[^\\"]+/, 'string'],
			[/@escapes/, 'string.escape'],
			// A gap: a backslash, white space (newlines included), a backslash.
			[/\\\s*$/, 'string.escape', '@gap'],
			[/\\./, 'string.escape.invalid'],
			[/"/, 'string', '@pop'],
		],
		gap: [
			[/\s*\\/, 'string.escape', '@pop'],
			[/\s+$/, 'string.escape'],
			[/.*/, 'string.escape.invalid', '@pop'],
		],
	},
};
