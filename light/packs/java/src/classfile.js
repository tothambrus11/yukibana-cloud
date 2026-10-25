// What the Java pack's bytecode view shows (README, "The bytecode view";
// ../../CONTRACT.md, "Showing compiler output"): the class files javac
// wrote for one source file of the project, listed as `javap -c` lists
// them, each instruction mapped to its source line by the method's
// LineNumberTable. Pure functions of bytes: explorer.js runs javac and
// hands over the jar; test-classfile.mjs checks these on class files a
// desktop javac wrote (tests/fixtures/).

/** The entries of a zip (a jar): `{ name, method, data }`, `data` still compressed when `method` is 8 (deflate). */
export function zipEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = bytes.length - 22;
    while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0) throw new Error('not a zip: no end of central directory');
    const count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    const decoder = new TextDecoder();
    const out = [];
    for (let i = 0; i < count; i++) {
        if (view.getUint32(at, true) !== 0x02014b50) throw new Error('not a zip: bad central directory');
        const method = view.getUint16(at + 10, true);
        const size = view.getUint32(at + 20, true);
        const nameLength = view.getUint16(at + 28, true);
        const extra = view.getUint16(at + 30, true);
        const comment = view.getUint16(at + 32, true);
        const local = view.getUint32(at + 42, true);
        const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        out.push({ name, method, data: bytes.subarray(start, start + size) });
        at += 46 + nameLength + extra + comment;
    }
    return out;
}

/** The class files of a jar, by entry name (`geo/Point.class`), inflated with `DecompressionStream`. */
export async function jarClasses(bytes) {
    const classes = new Map();
    for (const e of zipEntries(bytes)) {
        if (!e.name.endsWith('.class')) continue;
        if (e.method === 0) classes.set(e.name, e.data);
        else if (e.method === 8) classes.set(e.name, new Uint8Array(await new Response(new Blob([e.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
        else throw new Error(`${e.name}: zip method ${e.method}`);
    }
    return classes;
}

// ---- Class files (JVMS chapter 4)

const ACC = { PUBLIC: 0x1, PRIVATE: 0x2, PROTECTED: 0x4, STATIC: 0x8, FINAL: 0x10, SYNCHRONIZED: 0x20, VOLATILE: 0x40, TRANSIENT: 0x80, NATIVE: 0x100, INTERFACE: 0x200, ABSTRACT: 0x400, SYNTHETIC: 0x1000, ANNOTATION: 0x2000, ENUM: 0x4000 };

/**
 * A class file, parsed as far as the listing needs: `{ name, superName,
 * access, sourceFile, pool, fields, methods }`, `pool` the constant pool
 * (index 0 and the slot after a long or double empty), each method
 * `{ name, descriptor, access, code: { maxStack, maxLocals, bytes, lines } | null }`
 * with `lines` the LineNumberTable as `[startPc, line]` pairs. Throws on a
 * file that is not one.
 */
export function parseClass(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = 0;
    const u1 = () => view.getUint8(at++);
    const u2 = () => ((at += 2), view.getUint16(at - 2));
    const u4 = () => ((at += 4), view.getUint32(at - 4));
    if (u4() !== 0xcafebabe) throw new Error('not a class file');
    at += 4; // version
    const pool = [null];
    const count = u2();
    const utf8 = new TextDecoder();
    for (let i = 1; i < count; i++) {
        const tag = u1();
        switch (tag) {
            case 1: { const n = u2(); pool[i] = { tag, value: utf8.decode(bytes.subarray(at, at + n)) }; at += n; break; }
            case 3: pool[i] = { tag, value: view.getInt32(at) }; at += 4; break;
            case 4: pool[i] = { tag, value: view.getFloat32(at) }; at += 4; break;
            case 5: pool[i] = { tag, value: view.getBigInt64(at) }; at += 8; pool[++i] = null; break;
            case 6: pool[i] = { tag, value: view.getFloat64(at) }; at += 8; pool[++i] = null; break;
            case 7: case 8: case 16: case 19: case 20: pool[i] = { tag, a: u2() }; break;
            case 9: case 10: case 11: case 12: case 17: case 18: pool[i] = { tag, a: u2(), b: u2() }; break;
            case 15: pool[i] = { tag, kind: u1(), a: u2() }; break;
            default: throw new Error(`constant pool tag ${tag} at #${i}`);
        }
    }
    const text = (i) => pool[i]?.value ?? '';
    const className = (i) => text(pool[i]?.a);
    const access = u2();
    const name = className(u2());
    const superIndex = u2();
    const superName = superIndex ? className(superIndex) : null;
    const interfaces = u2();
    at += 2 * interfaces;
    const members = (withCode) => {
        const list = [];
        for (let n = u2(); n > 0; n--) {
            const m = { access: u2(), name: text(u2()), descriptor: text(u2()), code: null };
            for (let a = u2(); a > 0; a--) {
                const attr = text(u2());
                const length = u4();
                const next = at + length;
                if (withCode && attr === 'Code') {
                    const maxStack = u2();
                    const maxLocals = u2();
                    const codeLength = u4();
                    const code = bytes.subarray(at, at + codeLength);
                    at += codeLength;
                    const handlers = u2();
                    at += 8 * handlers; // the exception table
                    const lines = [];
                    for (let b = u2(); b > 0; b--) {
                        const sub = text(u2());
                        const subLength = u4();
                        const subNext = at + subLength;
                        if (sub === 'LineNumberTable') for (let k = u2(); k > 0; k--) lines.push([u2(), u2()]);
                        at = subNext;
                    }
                    lines.sort((x, y) => x[0] - y[0]);
                    m.code = { maxStack, maxLocals, bytes: code, lines };
                }
                at = next;
            }
            list.push(m);
        }
        return list;
    };
    const fields = members(false);
    const methods = members(true);
    let sourceFile = null;
    for (let a = u2(); a > 0; a--) {
        const attr = text(u2());
        const length = u4();
        if (attr === 'SourceFile') sourceFile = text(view.getUint16(at));
        at += length;
    }
    return { name, superName, access, sourceFile, pool, fields, methods };
}

// ---- The listing

/** The opcodes, 0 to 201, by name. */
const OPCODES = (
    'nop aconst_null iconst_m1 iconst_0 iconst_1 iconst_2 iconst_3 iconst_4 iconst_5 lconst_0 lconst_1 fconst_0 fconst_1 fconst_2 dconst_0 dconst_1 ' +
    'bipush sipush ldc ldc_w ldc2_w iload lload fload dload aload iload_0 iload_1 iload_2 iload_3 lload_0 lload_1 lload_2 lload_3 fload_0 fload_1 fload_2 fload_3 ' +
    'dload_0 dload_1 dload_2 dload_3 aload_0 aload_1 aload_2 aload_3 iaload laload faload daload aaload baload caload saload istore lstore fstore dstore astore ' +
    'istore_0 istore_1 istore_2 istore_3 lstore_0 lstore_1 lstore_2 lstore_3 fstore_0 fstore_1 fstore_2 fstore_3 dstore_0 dstore_1 dstore_2 dstore_3 astore_0 astore_1 astore_2 astore_3 ' +
    'iastore lastore fastore dastore aastore bastore castore sastore pop pop2 dup dup_x1 dup_x2 dup2 dup2_x1 dup2_x2 swap ' +
    'iadd ladd fadd dadd isub lsub fsub dsub imul lmul fmul dmul idiv ldiv fdiv ddiv irem lrem frem drem ineg lneg fneg dneg ishl lshl ishr lshr iushr lushr iand land ior lor ixor lxor iinc ' +
    'i2l i2f i2d l2i l2f l2d f2i f2l f2d d2i d2l d2f i2b i2c i2s lcmp fcmpl fcmpg dcmpl dcmpg ifeq ifne iflt ifge ifgt ifle if_icmpeq if_icmpne if_icmplt if_icmpge if_icmpgt if_icmple if_acmpeq if_acmpne ' +
    'goto jsr ret tableswitch lookupswitch ireturn lreturn freturn dreturn areturn return getstatic putstatic getfield putfield invokevirtual invokespecial invokestatic invokeinterface invokedynamic ' +
    'new newarray anewarray arraylength athrow checkcast instanceof monitorenter monitorexit wide multianewarray ifnull ifnonnull goto_w jsr_w'
).split(' ');

/** How each opcode's operands are laid out, by opcode; absent: none. */
const OPERANDS = new Map([
    [16, 'b1'], [17, 's2'], [18, 'cp1'], [19, 'cp2'], [20, 'cp2'], [132, 'iinc'], [169, 'local'], [170, 'table'], [171, 'lookup'],
    [185, 'interface'], [186, 'indy'], [188, 'atype'], [189, 'cp2'], [192, 'cp2'], [193, 'cp2'], [187, 'cp2'], [197, 'multi'], [200, 'branch4'], [201, 'branch4'],
]);
for (let op = 21; op <= 25; op++) OPERANDS.set(op, 'local');
for (let op = 54; op <= 58; op++) OPERANDS.set(op, 'local');
for (let op = 153; op <= 168; op++) OPERANDS.set(op, 'branch2');
for (const op of [198, 199]) OPERANDS.set(op, 'branch2');
for (let op = 178; op <= 184; op++) OPERANDS.set(op, 'cp2');
const ATYPES = { 4: 'boolean', 5: 'char', 6: 'float', 7: 'double', 8: 'byte', 9: 'short', 10: 'int', 11: 'long' };

/** A field or method descriptor's type as Java writes it (`[Ljava/lang/String;` is `java.lang.String[]`), from `at`; returns `[type, next]`. */
function typeAt(d, at) {
    let dims = 0;
    while (d[at] === '[') dims++, at++;
    const prim = { B: 'byte', C: 'char', D: 'double', F: 'float', I: 'int', J: 'long', S: 'short', Z: 'boolean', V: 'void' }[d[at]];
    let type;
    if (prim) (type = prim), at++;
    else {
        const end = d.indexOf(';', at);
        type = d.slice(at + 1, end).replaceAll('/', '.');
        at = end + 1;
    }
    return [type + '[]'.repeat(dims), at];
}

/** A method descriptor's parameters and return type: `{ params: ['double', 'double'], result: 'void' }`. */
export function methodType(descriptor) {
    const params = [];
    let at = 1;
    while (descriptor[at] !== ')') {
        const [t, next] = typeAt(descriptor, at);
        params.push(t);
        at = next;
    }
    return { params, result: typeAt(descriptor, at + 1)[0] };
}

/** The modifiers of `access` as Java writes them, for a class, a field or a method. */
function modifiers(access, what) {
    const out = [];
    if (access & ACC.PUBLIC) out.push('public');
    if (access & ACC.PRIVATE) out.push('private');
    if (access & ACC.PROTECTED) out.push('protected');
    if (access & ACC.STATIC && what !== 'class') out.push('static');
    if (access & ACC.FINAL && !(what === 'class' && access & ACC.ENUM)) out.push('final');
    if (what === 'method' && access & ACC.SYNCHRONIZED) out.push('synchronized');
    if (what === 'field' && access & ACC.VOLATILE) out.push('volatile');
    if (what === 'field' && access & ACC.TRANSIENT) out.push('transient');
    if (what === 'method' && access & ACC.NATIVE) out.push('native');
    if (access & ACC.ABSTRACT && !(what === 'class' && access & ACC.INTERFACE)) out.push('abstract');
    return out;
}

/** A float or double as Java prints one: `3.0`, `0.1`, `Infinity`. */
const decimal = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/**
 * What `javap -c` says after an instruction that names constant `index`
 * (`Method java/lang/Object."<init>":()V`), in class `self`, whose own
 * members javap names without their class (`Field x:D`).
 */
function describe(pool, index, self) {
    const c = pool[index];
    if (!c) return `#${index}`;
    const text = (i) => pool[i]?.value ?? '';
    const cls = (i) => text(pool[i]?.a);
    const quote = (n) => (/[<[]/.test(n[0] ?? '') ? `"${n}"` : n);
    const nat = (i) => `${quote(text(pool[i]?.a))}:${text(pool[i]?.b)}`;
    const owner = (i) => (cls(i) === self ? '' : `${cls(i)}.`);
    switch (c.tag) {
        case 3: return `int ${c.value}`;
        case 4: return `float ${decimal(c.value)}f`;
        case 5: return `long ${c.value}l`;
        case 6: return `double ${decimal(c.value)}d`;
        case 7: return `class ${quote(cls(index))}`;
        case 8: return `String ${text(c.a)}`;
        case 9: return `Field ${owner(c.a)}${nat(c.b)}`;
        case 10: return `Method ${owner(c.a)}${nat(c.b)}`;
        case 11: return `InterfaceMethod ${owner(c.a)}${nat(c.b)}`;
        case 16: return `MethodType ${text(c.a)}`;
        case 18: return `InvokeDynamic #${c.a}:${nat(c.b)}`;
        default: return `#${index}`;
    }
}

/** What a constant is, shortly, for a listing without indices: `geo/Point.norm:()D`, `"hello"`, `5`. */
function brief(pool, index, self) {
    const c = pool[index];
    if (c?.tag === 8) return JSON.stringify(pool[c.a]?.value ?? '');
    return describe(pool, index, self)
        .replace(/^(Method|InterfaceMethod|Field|class|int|float|long|double|MethodType) /, '')
        .replace(/^InvokeDynamic #\d+:/, '');
}

/**
 * One method's code as `javap -c` lists it: `{ pc, text }` per instruction,
 * `text` its mnemonic and operands. A constant is shown by what it is
 * (`invokevirtual geo/Point.norm:()D`), or with `details` as javap shows it,
 * its index and then what it is as a comment (`invokevirtual #7 // Method
 * geo/Point.norm:()D`).
 */
function instructions(code, pool, self, details) {
    const b = code.bytes;
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const out = [];
    let pc = 0;
    /** Constant `i`, and the operands javap prints after its index (`extra`). */
    const ref = (i, extra = '') => (details ? `#${i}${extra}`.padEnd(19) + `// ${describe(pool, i, self)}` : brief(pool, i, self));
    while (pc < b.length) {
        const start = pc;
        let op = b[pc++];
        let wide = false;
        if (op === 196) {
            wide = true;
            op = b[pc++];
        }
        const name = OPCODES[op] ?? `opcode_${op}`;
        let args = '';
        switch (OPERANDS.get(op)) {
            case 'b1': args = String(view.getInt8(pc)); pc += 1; break;
            case 's2': args = String(view.getInt16(pc)); pc += 2; break;
            case 'cp1': args = ref(b[pc]); pc += 1; break;
            case 'cp2': args = ref(view.getUint16(pc)); pc += 2; break;
            case 'local': args = String(wide ? view.getUint16(pc) : b[pc]); pc += wide ? 2 : 1; break;
            case 'iinc':
                args = wide ? `${view.getUint16(pc)}, ${view.getInt16(pc + 2)}` : `${b[pc]}, ${view.getInt8(pc + 1)}`;
                pc += wide ? 4 : 2;
                break;
            case 'branch2': args = String(start + view.getInt16(pc)); pc += 2; break;
            case 'branch4': args = String(start + view.getInt32(pc)); pc += 4; break;
            case 'interface': args = ref(view.getUint16(pc), `,  ${b[pc + 2]}`); pc += 4; break;
            case 'indy': args = ref(view.getUint16(pc), ',  0'); pc += 4; break;
            case 'atype': args = ATYPES[b[pc]] ?? String(b[pc]); pc += 1; break;
            case 'multi': args = ref(view.getUint16(pc), `,  ${b[pc + 2]}`); pc += 3; break;
            case 'table': {
                pc = start + 4 - (start % 4);
                const dflt = view.getInt32(pc);
                const low = view.getInt32(pc + 4);
                const high = view.getInt32(pc + 8);
                pc += 12;
                const cases = [];
                for (let k = low; k <= high; k++, pc += 4) cases.push(`${k}: ${start + view.getInt32(pc)}`);
                args = `{ ${[...cases, `default: ${start + dflt}`].join(', ')} }`;
                break;
            }
            case 'lookup': {
                pc = start + 4 - (start % 4);
                const dflt = view.getInt32(pc);
                const n = view.getInt32(pc + 4);
                pc += 8;
                const cases = [];
                for (let k = 0; k < n; k++, pc += 8) cases.push(`${view.getInt32(pc)}: ${start + view.getInt32(pc + 4)}`);
                args = `{ ${[...cases, `default: ${start + dflt}`].join(', ')} }`;
                break;
            }
            default:
        }
        out.push({ pc: start, text: args ? `${(wide ? 'wide ' : '') + name}`.padEnd(15) + ` ${args}` : name });
    }
    return out;
}

/** The source line of `pc` in a LineNumberTable (`[startPc, line]` pairs, sorted), or null before its first entry. */
function lineAt(lines, pc) {
    let line = null;
    for (const [start, l] of lines) {
        if (start > pc) break;
        line = l;
    }
    return line;
}

/** A method's declaration as `javap` prints it: `public double norm();`, `Point(double, double);`, `static {};`. */
function declaration(cls, m) {
    if (m.name === '<clinit>') return 'static {};';
    const { params, result } = methodType(m.descriptor);
    const mods = modifiers(m.access, 'method');
    const name = m.name === '<init>' ? cls.name.replaceAll('/', '.') : `${result} ${m.name}`;
    return `${[...mods, name].join(' ')}(${params.join(', ')});`;
}

/**
 * The listing of `classes` (parseClass's), as `javap -c` (with `-p`: private
 * members too) prints it, for the classes whose source is `path` (one of the
 * project's `paths`, sourcePathOf): each
 * class's declaration, its fields, and each method's declaration and code,
 * the instructions as `pc: mnemonic operands`, mapped by the method's
 * LineNumberTable. A method's declaration maps to its first line (column
 * 0); the class's, its fields' and the braces to nothing. The classes come
 * in the order of their first line, nested and local ones included (javac
 * writes each to its own class file, with the same SourceFile).
 *
 * - `details: false` shows what a constant is in place of its index
 *   (`invokevirtual geo/Point.norm:()D`); true, as javap does
 *   (`invokevirtual #7 // Method geo/Point.norm:()D`), with each method's
 *   `stack=, locals=` line and the synthetic methods (bridges, accessors).
 *
 * Returns `{ text, lines }` (`lines.length` is the number of lines of
 * `text`, `column` always 0: javac records none).
 */
export function listClasses(classes, path, paths, { details = false } = {}) {
    const mine = classes.filter((c) => sourcePathOf(c, paths) === path);
    const first = (c) => Math.min(...c.methods.flatMap((m) => m.code?.lines.map(([, l]) => l) ?? []), Infinity);
    mine.sort((a, b) => first(a) - first(b) || a.name.localeCompare(b.name));
    const rows = [];
    const push = (text, line = null) => rows.push({ text, map: line === null ? null : { file: path, line, column: 0 } });
    for (const c of mine) {
        if (rows.length) push('');
        const kind = c.access & ACC.ANNOTATION ? '@interface' : c.access & ACC.INTERFACE ? 'interface' : c.access & ACC.ENUM ? 'enum' : c.superName === 'java/lang/Record' ? 'record' : 'class';
        const ext = c.superName && !['java/lang/Object', 'java/lang/Enum', 'java/lang/Record'].includes(c.superName) ? ` extends ${c.superName.replaceAll('/', '.')}` : '';
        push(`${[...modifiers(c.access, 'class'), kind, c.name.replaceAll('/', '.')].join(' ')}${ext} {`);
        for (const f of c.fields) push(`  ${[...modifiers(f.access, 'field'), typeAt(f.descriptor, 0)[0], f.name].join(' ')};`);
        for (const m of c.methods) {
            // The bridges and accessors javac makes up, unless asked for; a lambda's body is the project's code.
            if (m.access & ACC.SYNTHETIC && !details && !m.name.startsWith('lambda$')) continue;
            push('');
            const lines = m.code?.lines ?? [];
            push(`  ${declaration(c, m)}`, lines[0]?.[1] ?? null);
            if (!m.code) continue;
            if (details) push(`    stack=${m.code.maxStack}, locals=${m.code.maxLocals}`, lines[0]?.[1] ?? null);
            for (const ins of instructions(m.code, c.pool, c.name, details)) push(`${String(ins.pc).padStart(8)}: ${ins.text}`, lineAt(lines, ins.pc));
        }
        push('}');
    }
    return { text: rows.map((r) => r.text).join('\n'), lines: rows.map((r) => r.map) };
}

/**
 * The project path class `cls` was compiled from, among `paths`: the one
 * whose name is its SourceFile and whose directory ends in its package
 * (`src/main/java/geo/Point.java` for `geo/Point`), else the only one with
 * that name, else null.
 */
export function sourcePathOf(cls, paths) {
    if (!cls.sourceFile) return null;
    const pkg = cls.name.includes('/') ? cls.name.slice(0, cls.name.lastIndexOf('/') + 1) : '';
    const named = paths.filter((p) => p === cls.sourceFile || p.endsWith(`/${cls.sourceFile}`));
    return named.find((p) => p === `${pkg}${cls.sourceFile}` || p.endsWith(`/${pkg}${cls.sourceFile}`)) ?? (named.length === 1 ? named[0] : null);
}
