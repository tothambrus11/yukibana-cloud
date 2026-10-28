// Writes stdlib-index.json: the public names of the standard library and
// kotlin.test that a program can use without a receiver, so that the
// language server can complete them, and import them where they need it,
// without kotlinc's analysis. Read from kotlinc's ABI dumps of the klibs a
// Run compiles against (kotlinc/tools/src/yk/DumpAbi.java), so they are
// exactly the declarations Kotlin/Wasm's standard library has, with every
// overload, though not their parameters' names, which a klib's ABI does
// not keep.
//
// {
//   "top":     [[name, kind, package, [signature, ...], deprecated], ...]
//                top-level classes, functions and properties, not extensions
//   "statics": { "kotlin/Int": [[name, kind, [signature, ...], deprecated], ...] }
//                what `Int.` reaches: its companion's members, and its
//                nested classes and objects
// }
//
// kind is the server's (fun, property, class, interface, enum, object); the
// signatures are one per overload, those not deprecated first; deprecated is
// 1 when every overload is.
// Usage: node stdlib-index.mjs <out.json> <dump.abi>...
import { readFileSync, writeFileSync } from 'node:fs';

const [out, ...dumps] = process.argv.slice(2);

/**
 * A type as a program would write it: `kotlin.collections/List<#A>` as
 * `List<T>`, `kotlin/Function1<#A, #B>` as `(T) -> R`, and a parameter
 * `kotlin/Int...` as `vararg Int`. The dump numbers type parameters (#A, #B),
 * so they are named in the order the standard library tends to use.
 */
const TYPE_PARAMETERS = ['T', 'R', 'K', 'V', 'E', 'U', 'W', 'X'];
function simple(s) {
    s = s
        .replace(/[\w.]+\//g, '')
        .replace(/#([A-Z])\d*/g, (_, l) => TYPE_PARAMETERS[l.charCodeAt(0) - 65] ?? l)
        .replace(/\b([A-Z]): (in|out) /g, '$2 $1: ')
        .replace(/: Any\?(?=[,>])/g, '')
        .replace(/Array<out (\w+(?:<[^()]*?>)?\??)>\.\.\./g, 'vararg $1')
        .replace(/\b(Boolean|Byte|Char|Short|Int|Long|Float|Double|UByte|UShort|UInt|ULong)Array\.\.\./g, 'vararg $1')
        .replace(/(\w+(?:<[^()]*?>)?\??)\.\.\./g, 'vararg $1')
        .replace(/ = \.\.\./g, ' = …');
    // Function types, the innermost first.
    for (let m; (m = /\b(Suspend)?Function\d+</.exec(s));) {
        const open = m.index + m[0].length - 1;
        const end = skipBalanced(s, open);
        const parts = [];
        let depth = 0;
        let from = open + 1;
        for (let i = from; i < end - 1; i++) {
            if ('<('.includes(s[i])) depth++;
            else if ('>)'.includes(s[i])) depth--;
            else if (s[i] === ',' && depth === 0) { parts.push(s.slice(from, i).trim()); from = i + 1; }
        }
        parts.push(s.slice(from, end - 1).trim());
        const ret = parts.pop();
        s = `${s.slice(0, m.index)}${m[1] ? 'suspend ' : ''}(${parts.join(', ')}) -> ${ret}${s.slice(end)}`;
    }
    return s;
}

/** A balanced `<...>` or `(...)` starting at i, as the index after it. */
function skipBalanced(s, i) {
    const open = s[i];
    const close = open === '<' ? '>' : ')';
    let depth = 0;
    for (; i < s.length; i++) {
        if (s[i] === open) depth++;
        else if (s[i] === close && --depth === 0) return i + 1;
    }
    return s.length;
}

const KINDS = { fun: 'fun', val: 'property', var: 'property', class: 'class', interface: 'interface', object: 'object' };

/**
 * One line of the dump: its kind, its name (`kotlin.math/hypot` at the top
 * level, a member's simple name), whether it extends a receiver, its
 * signature, and the ABI signature its deprecation is keyed by. Null for
 * what is none of those (annotation classes, enum entries, constructors).
 */
function parse(line) {
    const comment = line.lastIndexOf(' // ');
    if (comment < 0) return null;
    const abi = line.slice(comment + 4).trim();
    let s = line.slice(0, comment).trim().replace(/\s*\{$/, '');
    const words = [];
    for (let m; (m = /^([a-z]+)\s+/.exec(s)); s = s.slice(m[0].length)) words.push(m[1]);
    const keyword = words.findLast((w) => w in KINDS);
    if (!keyword || words.includes('annotation')) return null;
    let kind = KINDS[keyword];
    if (kind === 'class' && words.includes('enum')) kind = 'enum';
    let typeParameters = '';
    if (s.startsWith('<#')) {
        const end = skipBalanced(s, 0);
        typeParameters = simple(s.slice(0, end));
        s = s.slice(end).trimStart();
    }
    let receiver = false;
    if (s.startsWith('(')) {
        receiver = true;
        s = s.slice(skipBalanced(s, 0)).replace(/^\./, '');
    }
    const name = /^(?:[\w.]+\/)?(?:<[\w-]+>|[\w$]+)/.exec(s)?.[0] ?? '';
    const rest = simple(s.slice(name.length));
    const simpleName = name.slice(name.lastIndexOf('/') + 1);
    let signature;
    if (kind === 'fun') signature = `fun ${typeParameters ? typeParameters + ' ' : ''}${simpleName}${rest}`;
    else if (kind === 'property') signature = `${words.includes('const') ? 'const ' : ''}${keyword} ${simpleName}`;
    else signature = `${kind === 'enum' ? 'enum class' : kind} ${simpleName}${typeParameters}${rest.replace(/^ : Enum<.*$/, '')}`;
    return { kind, name, simpleName, receiver, signature, abi, supertypes: kind === 'fun' || kind === 'property' ? '' : s.slice(name.length) };
}

/** Every declaration kept, in the order of the dumps: { scope, name, kind, pkg, signature, deprecated }. */
const declarations = [];
for (const file of dumps) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const deprecated = new Set(lines.filter((l) => l.startsWith('// deprecated: ')).map((l) => l.slice(15)));
    const enclosing = []; // the declaration at each depth above this line
    let property = null; // the property whose getter may be the next line
    for (const line of lines) {
        if (!line.trim() || line.startsWith('//') || line.trim() === '}') continue;
        const depth = (line.length - line.trimStart().length) / 4;
        enclosing.length = depth;
        const d = parse(line);
        if (!d) { property = null; continue; }
        enclosing[depth] = d;
        // A property's type is its getter's return type, on the line after it.
        if (property && d.simpleName.startsWith('<get-')) property.signature += `: ${/\): (.*)$/.exec(d.signature)?.[1] ?? '?'}`;
        property = null;
        if (d.simpleName.startsWith('<') || d.receiver) continue;
        const keep = (scope, pkg = '') => {
            const decl = { scope, name: d.simpleName, kind: d.kind, pkg, signature: d.signature, deprecated: deprecated.has(d.abi) };
            declarations.push(decl);
            if (d.kind === 'property') property = decl;
        };
        if (depth === 0) {
            const pkg = d.name.slice(0, d.name.indexOf('/'));
            // Not for programs: the runtime's internals and the compiler's coroutine machinery.
            if (/\.internal\b|^kotlin\.wasm\b|^kotlin\.coroutines\.(intrinsics|debug)\b/.test(pkg)) continue;
            keep('', pkg);
            continue;
        }
        // What `Outer.` reaches: Outer's nested classes and objects, and the
        // members of its companion, which the dump does not mark as one: an
        // object named Companion, or one that is an Outer (Random.Default).
        // An object's own members, too.
        const outer = enclosing[0];
        if (!outer || outer.kind === 'fun' || outer.kind === 'property') continue;
        const member = d.kind === 'fun' || d.kind === 'property';
        const holder = enclosing[1];
        const companion = depth === 2 && holder?.kind === 'object' && (holder.simpleName === 'Companion' || holder.supertypes.includes(outer.name));
        if ((depth === 1 && !member) || (depth === 1 && outer.kind === 'object') || (member && companion)) keep(outer.name);
    }
}

/** Overloads together, one row per scope, name and kind of thing. */
const groups = new Map();
for (const d of declarations) {
    const key = `${d.scope}\0${d.pkg}\0${d.name}\0${d.kind === 'fun' ? 'fun' : 'other'}`;
    const g = groups.get(key) ?? { ...d, signatures: [], live: [], dead: [] };
    (d.deprecated ? g.dead : g.live).push(d.signature);
    groups.set(key, g);
}
const top = [];
const statics = {};
for (const g of groups.values()) {
    const signatures = [...new Set([...g.live, ...g.dead])];
    const deprecated = g.live.length ? 0 : 1;
    if (g.scope) (statics[g.scope] ??= []).push([g.name, g.kind, signatures, deprecated]);
    else top.push([g.name, g.kind, g.pkg, signatures, deprecated]);
}
const byName = (a, b) => a[0].localeCompare(b[0]) || String(a[2]).localeCompare(String(b[2]));
top.sort(byName);
for (const rows of Object.values(statics)) rows.sort(byName);
writeFileSync(out, JSON.stringify({ top, statics: Object.fromEntries(Object.entries(statics).sort(([a], [b]) => a.localeCompare(b))) }) + '\n');
console.log(`stdlib-index.json: ${top.length} top-level names, ${Object.keys(statics).length} types with static members`);
