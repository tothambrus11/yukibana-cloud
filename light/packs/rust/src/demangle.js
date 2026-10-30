// Rust's legacy symbol mangling (rustc's default), undone for the
// compiler output views: `_ZN4core3fmt9Arguments9new_const17h0123456789abcdefE`
// is `core::fmt::Arguments::new_const`. Pure, no imports; test-emit.mjs
// checks it.
//
// A legacy symbol is an Itanium nested name (`_ZN`, then each path segment
// as its length and its bytes, then `E`) whose last segment is `h` and 16
// hex digits, a hash of the crate and the item, which is left out, as
// rustc-demangle's `{:#}` leaves it out. A segment escapes what an Itanium
// name cannot hold: `$LT$` `<`, `$GT$` `>`, `$RF$` `&`, `$BP$` `*`, `$SP$`
// `@`, `$LP$` `(`, `$RP$` `)`, `$C$` `,`, `$u7e$` and the like a character
// by its code point, `..` `::`, and a leading `_$` is `$`.

const ESCAPES = { SP: '@', BP: '*', RF: '&', LT: '<', GT: '>', LP: '(', RP: ')', C: ',' };

/** One segment's text, unescaped; null when an escape is not one. */
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

/**
 * The path a legacy-mangled Rust symbol (`_ZN…E`, `__ZN…E` as Mach-O
 * spells it, with an optional `.llvm.123` suffix) names, without its
 * hash; the name itself when it is not one.
 */
export function demangleRust(name) {
    const m = /^_?_ZN(.*)E((?:\.[\w.]+)?)$/.exec(name);
    if (!m) return name;
    const body = m[1];
    const parts = [];
    let at = 0;
    while (at < body.length) {
        const len = /^\d+/.exec(body.slice(at));
        if (!len) return name;
        at += len[0].length;
        const n = Number(len[0]);
        if (at + n > body.length) return name;
        parts.push(body.slice(at, at + n));
        at += n;
    }
    if (parts.length > 1 && /^h[0-9a-f]{16}$/.test(parts.at(-1))) parts.pop();
    const plain = parts.map(segment);
    return plain.includes(null) || plain.length === 0 ? name : plain.join('::');
}

/** demangleRust for each of `names`: the batch emit-filter.js's demangleLines takes. */
export const demangleAll = (names) => names.map(demangleRust);
