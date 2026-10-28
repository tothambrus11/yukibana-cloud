/**
 * Zig for Monaco, which has no grammar of its own for it: the language id
 * `zig` for `.zig` and `.zon` files, a Monarch tokenizer and the bracket,
 * comment and indentation rules. Everything that needs ZLS or the compiler
 * (errors, hover, completion, semantic colours) comes from the Zig pack's
 * server; this is only what colours text before it answers and what Enter
 * and the comment commands do. Importing it registers nothing:
 * `startEditor` (monaco.ts) calls `registerZig`.
 */
import * as monaco from 'monaco-editor/editor/editor.api';

/**
 * Registers the language `zig` with the page's Monaco. Call it once, after
 * Monaco's services have started (`startEditor` does both, in that order):
 * a second call would register the language twice.
 */
export function registerZig(): void {
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
	// The tokenizer is built when the first Zig model appears, as
	// registerHaskell does and for the same reason.
	monaco.languages.onLanguage('zig', () => {
		monaco.languages.setMonarchTokensProvider('zig', {
			defaultToken: '',
			tokenPostfix: '.zig',
			keywords: [
				'addrspace', 'align', 'allowzero', 'and', 'anyframe', 'anytype', 'asm', 'break', 'callconv', 'catch',
				'comptime', 'const', 'continue', 'defer', 'else', 'enum', 'errdefer', 'error', 'export', 'extern', 'fn',
				'for', 'if', 'inline', 'linksection', 'noalias', 'noinline', 'nosuspend', 'opaque', 'or', 'orelse',
				'packed', 'pub', 'resume', 'return', 'struct', 'suspend', 'switch', 'test', 'threadlocal', 'try',
				'union', 'unreachable', 'var', 'volatile', 'while',
			],
			constants: ['true', 'false', 'null', 'undefined'],
			// The primitive types; iN and uN are matched by a rule of their own.
			types: [
				'isize', 'usize', 'c_char', 'c_short', 'c_ushort', 'c_int', 'c_uint', 'c_long', 'c_ulong', 'c_longlong',
				'c_ulonglong', 'c_longdouble', 'f16', 'f32', 'f64', 'f80', 'f128', 'bool', 'anyopaque', 'void',
				'noreturn', 'type', 'anyerror', 'comptime_int', 'comptime_float',
			],
			symbols: /[=><!~?:&|+\-*/^%.]+/,
			escapes: /\\(?:[nrt\\'"]|x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\})/,
			tokenizer: {
				root: [
					[/\/\/[/!].*$/, 'comment.doc'],
					[/\/\/.*$/, 'comment'],
					// A multiline string literal: each line starts with \\.
					[/\\\\.*$/, 'string'],
					[/@"/, 'identifier', '@quotedIdentifier'],
					[/@[A-Za-z_]\w*/, 'predefined'],
					[/[iu]\d+\b/, 'type'],
					[/[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '@constants': 'constant', '@types': 'type', '@default': 'identifier' } }],
					[/0x[0-9a-fA-F_]+(\.[0-9a-fA-F_]+)?([pP][-+]?\d+)?/, 'number.hex'],
					[/0o[0-7_]+/, 'number.octal'],
					[/0b[01_]+/, 'number.binary'],
					[/\d[\d_]*(\.\d[\d_]*)?([eE][-+]?\d+)?/, 'number'],
					[/"/, 'string', '@string'],
					[/'(?:[^\\']|@escapes)'/, 'string'],
					[/[()[\]{}]/, '@brackets'],
					[/[,;]/, 'delimiter'],
					[/@symbols/, 'operator'],
					[/\s+/, 'white'],
				],
				string: [
					[/[^\\"]+/, 'string'],
					[/@escapes/, 'string.escape'],
					[/\\./, 'string.escape.invalid'],
					[/"/, 'string', '@pop'],
				],
				quotedIdentifier: [
					[/[^\\"]+/, 'identifier'],
					[/@escapes/, 'string.escape'],
					[/"/, 'identifier', '@pop'],
				],
			},
		});
	});
}
