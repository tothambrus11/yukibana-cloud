/**
 * Zig's Monarch tokenizer, which colours its text before the
 * language server answers: loaded when the first model of the language
 * appears (monaco.ts `registerZig`), so a session in another language
 * never downloads it. Plain data: it registers nothing.
 */
import type * as Monaco from 'monaco-editor';

/** Zig's tokens, as `setMonarchTokensProvider` takes them. */
export const ZIG_TOKENS: Monaco.languages.IMonarchLanguage = {
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
};
