/**
 * Monaco languages for the compiler output views (compiler-view.ts): LLVM
 * IR (`llvm-ir`), the assembly of each target clang prints for
 * (`asm-x86_64` in AT&T or Intel syntax, `asm-aarch64`, `asm-riscv64`,
 * `asm-wasm32`, which Swift's and GHC's wasm assembly is too), Swift's SIL
 * (`sil`), Rust's MIR (`mir`), GHC's Core and STG (`ghc-core`), Cmm
 * (`cmm`), CPython's bytecode (`py-bytecode`) and the JVM's, as javap lists
 * it (`jvm-bytecode`). Monaco has none of them. Each is a Monarch tokenizer and a
 * language configuration (comments, brackets), and nothing else: the views
 * are read only and no server answers for them.
 *
 * The token names are the ones the app's themes colour (theme.svelte.ts,
 * and Monaco's own `vs`/`vs-dark` rules underneath), so both themes work:
 * `keyword` for mnemonics, `variable.predefined` for registers, `type` for
 * labels and types, `metatag` for directives, `annotation` for metadata and
 * attribute groups, and `comment`, `string`, `number`, `identifier`.
 *
 * Loaded by dynamic `import()` with compiler-view.ts, the first time a view
 * opens, so a session without one never downloads them. Monaco itself is
 * passed in (registerOutputLanguages) rather than imported: a lazy chunk
 * that imported the app's Monaco module would make the bundler split that
 * module out of the page's chunk into a shared one, and the app shell
 * would grow by the compression the split loses.
 */
import type { monaco as Monaco } from './monaco';
import type { AsmLanguage } from './cpp-targets';

type MonacoApi = typeof Monaco;
type Rule = Monaco.languages.IMonarchLanguageRule;

/** What tells one target's assembly from another's. */
interface AsmDialect {
	/** Rules for comments, tried first everywhere. */
	comments: Rule[];
	/** Registers, as one regular expression. */
	registers: RegExp;
	/** Immediates and other numbers. */
	numbers: Rule[];
	/** Rules for operands only this dialect has (size keywords, relocation operators). */
	extra?: Rule[];
	/** The language configuration's line comment. */
	lineComment: string;
}

/**
 * A Monarch tokenizer for one target's assembly as clang prints it: a line is
 * a label (anything up to a colon that ends it, demangled names with their
 * spaces and parentheses included), or a mnemonic or directive followed by
 * operands. A line always starts in `root`; the line feed (`includeLF`)
 * ends the operands, so an operand is never taken for a mnemonic.
 */
function asmTokenizer(d: AsmDialect): Monaco.languages.IMonarchLanguage {
	const operand: Rule[] = [
		[d.registers, 'variable.predefined'],
		...(d.extra ?? []),
		[/"(?:[^"\\]|\\.)*"/, 'string'],
		...d.numbers,
		[/[A-Za-z_.$?][\w.$?]*/, 'identifier'],
		[/@[\w]+/, 'predefined'],
		[/[()[\]{}<>]/, '@brackets'],
		[/[,:+\-*!&=|^~]/, 'delimiter'],
		[/[ \t]+/, 'white'],
	];
	return {
		defaultToken: '',
		includeLF: true,
		tokenizer: {
			root: [
				...d.comments,
				[/^[^\s#;/][^\n]*?:(?=[ \t]*(?:#|;|\/\/|\n|$))/, 'type'],
				[/[ \t]+/, 'white'],
				[/\.[\w.]+/, { token: 'metatag', next: '@operands' }],
				[/[A-Za-z_][\w.]*/, { token: 'keyword', next: '@operands' }],
				[/\n/, ''],
			],
			operands: [...d.comments, [/\n/, '', '@pop'], ...operand],
		},
	};
}

const HEX_OR_DEC = /-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/;

const DIALECTS: Record<AsmLanguage, AsmDialect> = {
	// AT&T (`%rax`, `$1`) and Intel (`rax`, `qword ptr [rsp + 8]`), whichever the toggle asked for.
	'asm-x86_64': {
		comments: [[/#.*/, 'comment']],
		registers: /%[a-z][a-z0-9]*|\b(?:[re]?(?:ax|bx|cx|dx|si|di|sp|bp|ip)|[abcd][lh]|(?:si|di|sp|bp)l|r(?:[89]|1[0-5])[dwb]?|[xyz]mm(?:[12]?\d|3[01])|[c-gs]s|k[0-7])\b/,
		numbers: [[/\$?-?(?:0x[0-9a-fA-F]+|\d+)\b/, 'number']],
		extra: [[/\b(?:byte|word|dword|qword|xmmword|ymmword|zmmword|tbyte|ptr|offset)\b/, 'type']],
		lineComment: '#',
	},
	'asm-aarch64': {
		// `#` is an immediate here (`#16`), not a comment.
		comments: [[/\/\/.*/, 'comment']],
		registers: /\b(?:[xw](?:[12]?\d|30)|[xw]zr|w?sp|lr|fp|pc|nzcv|[bhsdqv](?:[12]?\d|3[01])(?:\.\d*[bhsdq])?)\b/,
		numbers: [[/#?-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/, 'number']],
		extra: [
			[/:(?:lo12|got|got_lo12|tprel_lo12_nc|tprel_hi12|pg_hi21):/, 'predefined'],
			[/\b(?:lsl|lsr|asr|ror|uxt[bhwx]|sxt[bhwx]|eq|ne|cs|hs|cc|lo|mi|pl|vs|vc|hi|ls|ge|lt|gt|le|al)\b/, 'type'],
		],
		lineComment: '//',
	},
	'asm-riscv64': {
		comments: [[/#.*/, 'comment']],
		registers: /\b(?:zero|ra|sp|gp|tp|fp|t[0-6]|s(?:1[01]|\d)|a[0-7]|f[tsa]\d{1,2}|x(?:[12]?\d|3[01])|f(?:[12]?\d|3[01]))\b/,
		numbers: [[HEX_OR_DEC, 'number']],
		extra: [[/%(?:hi|lo|pcrel_hi|pcrel_lo|tprel_hi|tprel_lo|tprel_add|got_pcrel_hi)\b/, 'predefined']],
		lineComment: '#',
	},
	// Locals and globals are WebAssembly's registers: `local.get 0`.
	'asm-wasm32': {
		comments: [
			[/#.*/, 'comment'],
			[/;;.*/, 'comment'],
		],
		registers: /\b(?:local|global)\.(?:get|set|tee)\b/,
		numbers: [[HEX_OR_DEC, 'number']],
		extra: [[/\b(?:i32|i64|f32|f64|v128|funcref|externref|exnref)\b/, 'type']],
		lineComment: '#',
	},
};

/** WebAssembly's `local.get` and `global.set` start a line as an instruction too: coloured as registers there. */
function wasmTokenizer(): Monaco.languages.IMonarchLanguage {
	const base = asmTokenizer(DIALECTS['asm-wasm32']);
	const root = base.tokenizer['root'] ?? [];
	return { ...base, tokenizer: { ...base.tokenizer, root: [[/\b(?:local|global)\.(?:get|set|tee)\b/, { token: 'variable.predefined', next: '@operands' }], ...root] } };
}

/** LLVM IR's instructions, linkage and other words that are not types or attributes. */
const IR_KEYWORDS = [
	'define', 'declare', 'global', 'constant', 'private', 'internal', 'external', 'linkonce', 'linkonce_odr', 'weak', 'weak_odr', 'common', 'appending', 'extern_weak', 'available_externally',
	'dso_local', 'dso_preemptable', 'unnamed_addr', 'local_unnamed_addr', 'thread_local', 'hidden', 'protected', 'default', 'dllimport', 'dllexport', 'section', 'comdat', 'any', 'align', 'alignstack',
	'target', 'datalayout', 'triple', 'source_filename', 'attributes', 'personality', 'type', 'to', 'x', 'unwind', 'cleanup', 'catch', 'filter', 'within', 'from', 'caller',
	'ret', 'br', 'switch', 'indirectbr', 'invoke', 'resume', 'unreachable', 'callbr', 'landingpad', 'catchswitch', 'catchret', 'cleanupret', 'catchpad', 'cleanuppad',
	'fneg', 'add', 'fadd', 'sub', 'fsub', 'mul', 'fmul', 'udiv', 'sdiv', 'fdiv', 'urem', 'srem', 'frem', 'shl', 'lshr', 'ashr', 'and', 'or', 'xor',
	'extractelement', 'insertelement', 'shufflevector', 'extractvalue', 'insertvalue', 'alloca', 'load', 'store', 'fence', 'cmpxchg', 'atomicrmw', 'getelementptr',
	'trunc', 'zext', 'sext', 'fptrunc', 'fpext', 'fptoui', 'fptosi', 'uitofp', 'sitofp', 'ptrtoint', 'inttoptr', 'bitcast', 'addrspacecast',
	'icmp', 'fcmp', 'phi', 'select', 'freeze', 'call', 'tail', 'musttail', 'notail', 'va_arg',
	'eq', 'ne', 'ugt', 'uge', 'ult', 'ule', 'sgt', 'sge', 'slt', 'sle', 'oeq', 'ogt', 'oge', 'olt', 'ole', 'one', 'ord', 'ueq', 'une', 'uno',
	'nuw', 'nsw', 'exact', 'disjoint', 'nneg', 'inbounds', 'nusw', 'volatile', 'atomic', 'unordered', 'monotonic', 'acquire', 'release', 'acq_rel', 'seq_cst', 'syncscope',
	'fast', 'nnan', 'ninf', 'nsz', 'arcp', 'contract', 'afn', 'reassoc', 'true', 'false', 'null', 'undef', 'poison', 'zeroinitializer', 'none', 'blockaddress', 'dso_local_equivalent', 'no_cfi',
	'ccc', 'fastcc', 'coldcc', 'tailcc', 'swiftcc', 'cc', 'addrspace', 'vscale', 'asm', 'sideeffect', 'inteldialect',
];

/** Parameter, return and function attributes, as clang writes them. */
const IR_ATTRIBUTES = [
	'noundef', 'nonnull', 'nocapture', 'captures', 'readonly', 'readnone', 'writeonly', 'returned', 'signext', 'zeroext', 'inreg', 'byval', 'byref', 'sret', 'noalias', 'nofree', 'nest', 'swiftself', 'swifterror', 'immarg', 'noext',
	'dereferenceable', 'dereferenceable_or_null', 'allocalign', 'allocptr', 'initializes', 'range', 'nofpclass', 'writable', 'dead_on_unwind', 'inalloca', 'preallocated', 'elementtype', 'memory', 'argmem', 'inaccessiblemem', 'read', 'write', 'readwrite',
	'nounwind', 'mustprogress', 'noinline', 'alwaysinline', 'inlinehint', 'optnone', 'optsize', 'minsize', 'uwtable', 'norecurse', 'willreturn', 'nosync', 'noreturn', 'cold', 'hot', 'convergent', 'speculatable', 'nobuiltin', 'builtin',
	'ssp', 'sspstrong', 'sspreq', 'safestack', 'sanitize_address', 'sanitize_memory', 'sanitize_thread', 'nocallback', 'nomerge', 'noduplicate', 'returns_twice', 'strictfp', 'null_pointer_is_valid', 'noimplicitfloat', 'naked',
	'allockind', 'allocsize', 'local_unnamed_addr', 'nocf_check', 'shadowcallstack', 'mustprogress', 'noprofile', 'skipprofile', 'presplitcoroutine', 'fn_ret_thunk_extern', 'nonlazybind', 'jumptable', 'disable_sanitizer_instrumentation',
];

/** LLVM IR as clang prints it with `-S -emit-llvm`. */
function irTokenizer(): Monaco.languages.IMonarchLanguage {
	return {
		defaultToken: '',
		keywords: IR_KEYWORDS,
		attributes: IR_ATTRIBUTES,
		tokenizer: {
			root: [
				[/;.*$/, 'comment'],
				[/^[\w.$-]+:/, 'type'],
				[/c?"(?:[^"\\]|\\.)*"/, 'string'],
				[/@(?:"(?:[^"\\]|\\.)*"|[\w.$-]+)/, 'variable.predefined'],
				[/%(?:"(?:[^"\\]|\\.)*"|[\w.$-]+)/, 'variable'],
				[/!(?:[A-Za-z_.][\w.$-]*|\d+)?/, 'annotation'],
				[/#\d+/, 'annotation'],
				[/\b(?:i\d+|void|half|bfloat|float|double|fp128|x86_fp80|ppc_fp128|ptr|label|metadata|token|opaque|x86_amx)\b/, 'type'],
				[/-?0x[KLMHR]?[0-9A-Fa-f]+\b/, 'number'],
				[/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, 'number'],
				[/[A-Za-z_][\w.$-]*/, { cases: { '@keywords': 'keyword', '@attributes': 'attribute.name', '@default': 'identifier' } }],
				[/[()[\]{}<>]/, '@brackets'],
				[/[,=*:]/, 'delimiter'],
				[/[ \t]+/, 'white'],
			],
		},
	};
}

/**
 * The intermediate forms other than LLVM IR, coloured coarsely: what is a
 * keyword, a value, a type or a block's label, which is what a reader looks
 * for in them. `values`, `globals` and `types` are tried in that order after
 * comments and strings.
 */
interface FormTokens {
	lineComment: string;
	keywords: readonly string[];
	/** SSA values and locals (`%3`, `_2`, `x_sJW`). */
	values?: RegExp;
	/** Functions and globals (`@$s4main6squareyS2iF`, `Main.square`). */
	globals?: RegExp;
	/** Types (`$Int`, `i32`, `P32`). */
	types?: RegExp;
	/** A block's label at the start of a line (`bb0:`, `c1iS:`). */
	labels?: RegExp;
	/** Instructions named by a pattern rather than listed (CPython's opcodes). */
	mnemonics?: RegExp;
}

function formTokenizer(f: FormTokens): Monaco.languages.IMonarchLanguage {
	const comment = f.lineComment.replace(/[-/]/g, '\\$&');
	const rules: Rule[] = [
		[new RegExp(`${comment}.*$`), 'comment'],
		[/"(?:[^"\\]|\\.)*"/, 'string'],
		...(f.labels ? [[f.labels, 'type'] as Rule] : []),
		...(f.mnemonics ? [[f.mnemonics, 'keyword'] as Rule] : []),
		...(f.values ? [[f.values, 'variable'] as Rule] : []),
		...(f.globals ? [[f.globals, 'variable.predefined'] as Rule] : []),
		...(f.types ? [[f.types, 'type'] as Rule] : []),
		[/-?0x[0-9A-Fa-f]+\b/, 'number'],
		[/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?#*/, 'number'],
		[/[A-Za-z_][\w']*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
		[/[()[\]{}<>]/, '@brackets'],
		[/[ \t]+/, 'white'],
	];
	return { defaultToken: '', keywords: [...f.keywords], tokenizer: { root: rules } };
}

const SIL: FormTokens = {
	lineComment: '//',
	keywords: ['sil', 'sil_stage', 'sil_global', 'sil_vtable', 'sil_witness_table', 'sil_default_witness_table', 'sil_property', 'sil_scope', 'canonical', 'raw', 'hidden', 'private', 'shared', 'public', 'public_external', 'shared_external', 'import', 'class', 'struct', 'enum', 'protocol', 'func', 'var', 'let', 'init', 'deinit', 'case', 'extension', 'typealias', 'static', 'final', 'guaranteed', 'owned', 'unowned', 'inout', 'trivial', 'copy', 'take', 'assign', 'init', 'to', 'loc', 'scope', 'parent', 'inlined_at', 'apply', 'partial_apply', 'try_apply', 'begin_apply', 'function_ref', 'witness_method', 'class_method', 'struct_extract', 'struct_element_addr', 'tuple', 'struct', 'enum', 'load', 'store', 'alloc_stack', 'dealloc_stack', 'alloc_ref', 'alloc_box', 'project_box', 'begin_access', 'end_access', 'begin_borrow', 'end_borrow', 'copy_value', 'destroy_value', 'destroy_addr', 'retain_value', 'release_value', 'strong_retain', 'strong_release', 'br', 'cond_br', 'switch_enum', 'return', 'unreachable', 'integer_literal', 'float_literal', 'string_literal', 'builtin', 'debug_value', 'mark_uninitialized', 'global_addr', 'metatype', 'upcast', 'unchecked_ref_cast', 'init_existential_addr', 'open_existential_addr', 'move_value', 'mark_dependence', 'yield', 'end_apply', 'abort_apply'],
	values: /%[\w.]+/,
	globals: /@(?:"(?:[^"\\]|\\.)*"|[\w.$]+)/,
	types: /\$[*@]?[\w.<>]+/,
	labels: /^\s*bb\d+(?=[(:])/,
};
const MIR: FormTokens = {
	lineComment: '//',
	keywords: ['fn', 'let', 'mut', 'const', 'static', 'promoted', 'scope', 'debug', 'goto', 'return', 'switchInt', 'otherwise', 'unwind', 'continue', 'terminate', 'cleanup', 'drop', 'assert', 'move', 'copy', 'unreachable', 'resume', 'as', 'discriminant', 'StorageLive', 'StorageDead', 'Len', 'Add', 'Sub', 'Mul', 'Div', 'Rem', 'Eq', 'Ne', 'Lt', 'Le', 'Gt', 'Ge', 'Offset', 'AddWithOverflow', 'SubWithOverflow', 'MulWithOverflow', 'Not', 'Neg', 'PtrToPtr', 'Transmute', 'true', 'false', 'unsafe', 'impl', 'for', 'in', 'ref', 'raw', 'deref_copy'],
	values: /\b_\d+\b/,
	types: /\b(?:i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize|f32|f64|bool|char|str|String|Vec|Option|Result|Self)\b/,
	labels: /^\s*bb\d+(?=[ :])/,
};
const GHC_CORE: FormTokens = {
	lineComment: '--',
	keywords: ['case', 'of', 'let', 'letrec', 'in', 'join', 'joinrec', 'jump', 'forall', 'DEFAULT', '__DEFAULT', 'Rec', 'NonRec', 'cast', 'src'],
	globals: /\$?[A-Z][\w']*(?:\.[A-Z][\w']*)*\.[\w'$]+/,
	types: /@[\w'$]+/,
};
const CMM: FormTokens = {
	lineComment: '//',
	keywords: ['if', 'else', 'goto', 'call', 'jump', 'return', 'switch', 'case', 'default', 'likely', 'True', 'False', 'section', 'const', 'offset', 'args', 'res', 'upd', 'unwind', 'returns', 'to', 'info_tbls', 'stack_info', 'label', 'rep', 'srt', 'arg_space'],
	values: /\b(?:R\d+|Sp|SpLim|Hp|HpLim|HpAlloc|BaseReg|CurrentTSO|CurrentNursery|F\d+|D\d+|L\d+)\b/,
	types: /\b(?:[IFPWB](?:8|16|32|64|128)|bits(?:8|16|32|64))\b/,
	labels: /^\s*[a-z]\w*(?=: )/,
};

const PY_BYTECODE: FormTokens = {
	lineComment: '#',
	keywords: [],
	labels: /^(?:L\d+:|\S[^:]*:$)/,
	mnemonics: /\b[A-Z][A-Z0-9_]+\b/,
};

/** The JVM's opcodes and the modifiers of a javap listing's declarations. */
const JVM: FormTokens = {
	lineComment: '//',
	keywords: (
		'nop aconst_null iconst_m1 iconst_0 iconst_1 iconst_2 iconst_3 iconst_4 iconst_5 lconst_0 lconst_1 fconst_0 fconst_1 fconst_2 dconst_0 dconst_1 bipush sipush ldc ldc_w ldc2_w ' +
		'iload lload fload dload aload iload_0 iload_1 iload_2 iload_3 lload_0 lload_1 lload_2 lload_3 fload_0 fload_1 fload_2 fload_3 dload_0 dload_1 dload_2 dload_3 aload_0 aload_1 aload_2 aload_3 ' +
		'iaload laload faload daload aaload baload caload saload istore lstore fstore dstore astore istore_0 istore_1 istore_2 istore_3 lstore_0 lstore_1 lstore_2 lstore_3 ' +
		'fstore_0 fstore_1 fstore_2 fstore_3 dstore_0 dstore_1 dstore_2 dstore_3 astore_0 astore_1 astore_2 astore_3 iastore lastore fastore dastore aastore bastore castore sastore ' +
		'pop pop2 dup dup_x1 dup_x2 dup2 dup2_x1 dup2_x2 swap iadd ladd fadd dadd isub lsub fsub dsub imul lmul fmul dmul idiv ldiv fdiv ddiv irem lrem frem drem ineg lneg fneg dneg ' +
		'ishl lshl ishr lshr iushr lushr iand land ior lor ixor lxor iinc i2l i2f i2d l2i l2f l2d f2i f2l f2d d2i d2l d2f i2b i2c i2s lcmp fcmpl fcmpg dcmpl dcmpg ' +
		'ifeq ifne iflt ifge ifgt ifle if_icmpeq if_icmpne if_icmplt if_icmpge if_icmpgt if_icmple if_acmpeq if_acmpne goto jsr ret tableswitch lookupswitch ireturn lreturn freturn dreturn areturn return ' +
		'getstatic putstatic getfield putfield invokevirtual invokespecial invokestatic invokeinterface invokedynamic new newarray anewarray arraylength athrow checkcast instanceof ' +
		'monitorenter monitorexit wide multianewarray ifnull ifnonnull goto_w jsr_w public private protected static final abstract synchronized native transient volatile class interface enum record default'
	).split(' '),
	labels: /^\s*\d+:/,
	types: /\b(?:void|boolean|byte|char|short|int|long|float|double)\b/,
};

const BRACKETS: Monaco.languages.CharacterPair[] = [
	['(', ')'],
	['[', ']'],
	['{', '}'],
	['<', '>'],
];

/** Every language registered here, with what it is called. */
export const OUTPUT_LANGUAGES = ['llvm-ir', 'asm-x86_64', 'asm-aarch64', 'asm-riscv64', 'asm-wasm32', 'sil', 'mir', 'ghc-core', 'cmm', 'py-bytecode', 'jvm-bytecode'] as const;

/**
 * Registers every language of OUTPUT_LANGUAGES with `monaco`: its id, its
 * tokenizer and its configuration. Calling it again does nothing.
 */
export function registerOutputLanguages(monaco: MonacoApi): void {
	const register = (id: string, alias: string, tokenizer: Monaco.languages.IMonarchLanguage, lineComment: string) => {
		if (monaco.languages.getLanguages().some((l) => l.id === id)) return;
		monaco.languages.register({ id, aliases: [alias] });
		monaco.languages.setMonarchTokensProvider(id, tokenizer);
		monaco.languages.setLanguageConfiguration(id, { comments: { lineComment }, brackets: BRACKETS });
	};
	register('llvm-ir', 'LLVM IR', irTokenizer(), ';');
	register('asm-x86_64', 'x86-64 assembly', asmTokenizer(DIALECTS['asm-x86_64']), DIALECTS['asm-x86_64'].lineComment);
	register('asm-aarch64', 'AArch64 assembly', asmTokenizer(DIALECTS['asm-aarch64']), DIALECTS['asm-aarch64'].lineComment);
	register('asm-riscv64', 'RISC-V assembly', asmTokenizer(DIALECTS['asm-riscv64']), DIALECTS['asm-riscv64'].lineComment);
	register('asm-wasm32', 'WebAssembly assembly', wasmTokenizer(), DIALECTS['asm-wasm32'].lineComment);
	register('sil', 'SIL', formTokenizer(SIL), SIL.lineComment);
	register('mir', 'MIR', formTokenizer(MIR), MIR.lineComment);
	register('ghc-core', 'GHC Core', formTokenizer(GHC_CORE), GHC_CORE.lineComment);
	register('cmm', 'Cmm', formTokenizer(CMM), CMM.lineComment);
	register('py-bytecode', 'CPython bytecode', formTokenizer(PY_BYTECODE), PY_BYTECODE.lineComment);
	register('jvm-bytecode', 'JVM bytecode', formTokenizer(JVM), JVM.lineComment);
}
