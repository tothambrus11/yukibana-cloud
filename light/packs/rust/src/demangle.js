// Rust's symbol names, undone for the compiler output views: rustc 1.98
// mangles with the v0 scheme (`_RNvCs1234_6shapes6square` is
// `shapes::square`), and the standard library's older code and some
// crates with the legacy one (`_ZN4core3fmt9Arguments9new_const17h…E` is
// `core::fmt::Arguments::new_const`). Pure, no imports; test-mir.mjs
// checks it.
//
// Both are printed as rustc-demangle's `{:#}` prints them: without the
// crates' disambiguators and the legacy hash, generic arguments in full
// (`alloc::vec::Vec<i32>::extend_trusted::<core::iter::Map<…>>`), closures
// as `{closure#0}`. A name that is not one, or uses what this does not
// read (punycode identifiers, the newer structural constants), comes back
// as it was.

// ---- legacy: an Itanium nested name with escapes

const ESCAPES = { SP: '@', BP: '*', RF: '&', LT: '<', GT: '>', LP: '(', RP: ')', C: ',' };

/** One legacy segment's text, unescaped; null when an escape is not one. */
function segment(raw) {
    let s = raw.startsWith('_$') ? raw.slice(1) : raw;
    let out = '';
    while (s.length) {
        if (s.startsWith('$')) {
            const end = s.indexOf('$', 1);
            if (end < 0) return null;
            const code = s.slice(1, end);
            if (ESCAPES[code] !== undefined) out += ESCAPES[code];
            else if (/^u[0-9a-f]+$/.test(code)) out += String.fromCodePoint(parseInt(code.slice(1), 16));
            else return null;
            s = s.slice(end + 1);
        } else if (s.startsWith('..')) {
            out += '::';
            s = s.slice(2);
        } else {
            out += s[0];
            s = s.slice(1);
        }
    }
    return out;
}

/** A legacy symbol's path (`_ZN` segments `E`), without its `h` hash; null when it is not one. */
function legacy(body) {
    const parts = [];
    let at = 0;
    while (at < body.length) {
        const len = /^\d+/.exec(body.slice(at));
        if (!len) return null;
        at += len[0].length;
        const n = Number(len[0]);
        if (at + n > body.length) return null;
        parts.push(body.slice(at, at + n));
        at += n;
    }
    if (parts.length > 1 && /^h[0-9a-f]{16}$/.test(parts.at(-1))) parts.pop();
    const plain = parts.map(segment);
    return plain.includes(null) || plain.length === 0 ? null : plain.join('::');
}

// ---- v0 (RFC 2603)

const BASIC = {
    a: 'i8', b: 'bool', c: 'char', d: 'f64', e: 'str', f: 'f32', h: 'u8', i: 'isize', j: 'usize', l: 'i32', m: 'u32', n: 'i128', o: 'u128',
    s: 'i16', t: 'u16', u: '()', v: '...', x: 'i64', y: 'u64', z: '!', p: '_',
};
const SIGNED = new Set(['a', 'i', 'l', 'n', 's', 'x']);
const UNSIGNED = new Set(['h', 'j', 'm', 'o', 't', 'y']);

class Invalid extends Error {}

/** A v0 symbol after `_R`, printed; throws Invalid for what it does not read. */
function v0(text) {
    let at = 0;
    let depth = 0;
    const peek = () => text[at];
    const eat = (c) => (text[at] === c ? (at++, true) : false);
    const next = () => {
        if (at >= text.length) throw new Invalid();
        return text[at++];
    };
    /** base-62-number: digits, then `_`; `_` alone is 0, else the number plus 1. */
    const base62 = () => {
        if (eat('_')) return 0;
        let n = 0;
        for (;;) {
            const c = next();
            if (c === '_') return n + 1;
            const d = c >= '0' && c <= '9' ? c.charCodeAt(0) - 48 : c >= 'a' && c <= 'z' ? c.charCodeAt(0) - 87 : c >= 'A' && c <= 'Z' ? c.charCodeAt(0) - 29 : -1;
            if (d < 0) throw new Invalid();
            n = n * 62 + d;
        }
    };
    const disambiguator = () => (eat('s') ? base62() + 1 : 0);
    const decimal = () => {
        const m = /^(0|[1-9]\d*)/.exec(text.slice(at));
        if (!m) throw new Invalid();
        at += m[0].length;
        return Number(m[0]);
    };
    const ident = () => {
        if (eat('u')) throw new Invalid(); // punycode
        const n = decimal();
        eat('_');
        if (at + n > text.length) throw new Invalid();
        const s = text.slice(at, at + n);
        at += n;
        return s;
    };
    /** Parses what is at `target` (a backref's position) with `parse`, and comes back. */
    const backref = (parse) => {
        const start = at - 1;
        const target = base62();
        if (target >= start) throw new Invalid();
        const back = at;
        at = target;
        const s = parse();
        at = back;
        return s;
    };
    const guard = (parse) => {
        if (++depth > 200) throw new Invalid();
        try {
            return parse();
        } finally {
            depth--;
        }
    };
    const list = (item, sep = ', ') => {
        const items = [];
        while (!eat('E')) items.push(item());
        return items.join(sep);
    };
    const genericArg = () => {
        if (eat('L')) {
            base62();
            return "'_";
        }
        if (eat('K')) return constant();
        return type();
    };
    /** A path; `value`: in a value's position, where generic arguments take `::<`. */
    const path = (value) =>
        guard(() => {
            const c = next();
            switch (c) {
                case 'C': {
                    disambiguator();
                    return ident();
                }
                case 'M': {
                    disambiguator();
                    path(false); // the impl's own path, not printed
                    return `<${type()}>`;
                }
                case 'X': {
                    disambiguator();
                    path(false);
                    const self = type();
                    return `<${self} as ${path(false)}>`;
                }
                case 'Y': {
                    const self = type();
                    return `<${self} as ${path(false)}>`;
                }
                case 'N': {
                    const ns = next();
                    const inner = path(value);
                    const n = disambiguator();
                    const name = ident();
                    if (ns >= 'a' && ns <= 'z') return name ? `${inner}::${name}` : inner;
                    const kind = ns === 'C' ? 'closure' : ns === 'S' ? 'shim' : ns;
                    return `${inner}::{${kind}${name ? `:${name}` : ''}#${n}}`;
                }
                case 'I': {
                    const inner = path(value);
                    return `${inner}${value ? '::' : ''}<${list(genericArg)}>`;
                }
                case 'B':
                    return backref(() => path(value));
                default:
                    throw new Invalid();
            }
        });
    const binder = () => (eat('G') ? base62() : 0);
    const fnSig = () => {
        binder();
        const unsafe = eat('U');
        let abi = '';
        if (eat('K')) abi = eat('C') ? 'C' : ident().replace(/_/g, '-');
        const params = list(type);
        const ret = type();
        return `${unsafe ? 'unsafe ' : ''}${abi ? `extern "${abi}" ` : ''}fn(${params})${ret === '()' ? '' : ` -> ${ret}`}`;
    };
    const dynBounds = () => {
        binder();
        const traits = [];
        while (!eat('E')) {
            let t = path(false);
            const bindings = [];
            while (eat('p')) {
                const name = ident();
                bindings.push(`${name} = ${type()}`);
            }
            if (bindings.length) t = t.endsWith('>') ? `${t.slice(0, -1)}, ${bindings.join(', ')}>` : `${t}<${bindings.join(', ')}>`;
            traits.push(t);
        }
        return traits.join(' + ');
    };
    const type = () =>
        guard(() => {
            const c = peek();
            if (c !== undefined && BASIC[c] !== undefined) {
                at++;
                return BASIC[c];
            }
            switch (next()) {
                case 'A': {
                    const t = type();
                    return `[${t}; ${constant()}]`;
                }
                case 'S':
                    return `[${type()}]`;
                case 'T': {
                    const items = [];
                    while (!eat('E')) items.push(type());
                    return items.length === 1 ? `(${items[0]},)` : `(${items.join(', ')})`;
                }
                case 'R':
                case 'Q': {
                    const mut = text[at - 1] === 'Q';
                    if (eat('L')) base62();
                    return `&${mut ? 'mut ' : ''}${type()}`;
                }
                case 'P':
                    return `*const ${type()}`;
                case 'O':
                    return `*mut ${type()}`;
                case 'F':
                    return fnSig();
                case 'D': {
                    const bounds = dynBounds();
                    if (!eat('L')) throw new Invalid();
                    base62();
                    return `dyn ${bounds}`;
                }
                case 'B':
                    return backref(type);
                default:
                    at--;
                    return path(false);
            }
        });
    const constant = () =>
        guard(() => {
            if (eat('B')) return backref(constant);
            if (eat('p')) return '_';
            const t = next();
            if (BASIC[t] === undefined) throw new Invalid(); // a structural constant
            const negative = eat('n');
            const m = /^([0-9a-f]*)_/.exec(text.slice(at));
            if (!m) throw new Invalid();
            at += m[0].length;
            const value = m[1] === '' ? 0n : BigInt(`0x${m[1]}`);
            if (t === 'b') return value === 0n ? 'false' : 'true';
            if (t === 'c') return `'${String.fromCodePoint(Number(value))}'`;
            if (SIGNED.has(t) || UNSIGNED.has(t)) return `${negative ? '-' : ''}${value}`;
            throw new Invalid();
        });

    if (/^\d/.test(text)) decimal(); // the encoding's version, 0 when absent
    const printed = path(true);
    // What may follow: the instantiating crate's path, which `{:#}` leaves out.
    if (at < text.length && /[A-Z]/.test(peek())) path(false);
    if (at !== text.length) throw new Invalid();
    return printed;
}

/**
 * The path a Rust symbol names: v0 (`_R…`, `__R…` as Mach-O spells it) or
 * legacy (`_ZN…E`), with an optional `.llvm.123` suffix (LLVM's, for a
 * local symbol it made unique), printed without disambiguators or hash;
 * the name itself when it is not one.
 */
export function demangleRust(name) {
    const suffix = /\.(llvm|lto|cold)\.[\w.]*$|\.\d+$/.exec(name);
    const symbol = suffix ? name.slice(0, suffix.index) : name;
    try {
        const r = /^_?_R(.+)$/.exec(symbol);
        if (r) return v0(r[1]);
        const z = /^_?_ZN(.*)E$/.exec(symbol);
        if (z) return legacy(z[1]) ?? name;
    } catch (e) {
        if (!(e instanceof Invalid)) throw e;
    }
    return name;
}

/** Rust symbols in a text: v0 (`_R`) and legacy (`_ZN`), where they start a token. */
export const RUST_SYMBOL = /(?<![\w.$])_?_(?:R[0-9A-Za-z_]+|ZN[\w.$]+?E)(?:\.(?:llvm|lto|cold)\.[\w.]+)?(?![\w$])/g;

/** Every Rust symbol in `text` replaced by its demangled path; the text keeps its line count. */
export function demangleText(text) {
    return text.replace(RUST_SYMBOL, (name) => {
        const plain = demangleRust(name);
        return plain.includes('\n') ? name : plain;
    });
}
