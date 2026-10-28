// What the language server makes of the declarations and local bindings
// Yuki.hs reads from a check's .hie files: the nested outline (document
// symbols), the search of every file's outline (workspace symbols), and
// HLS's inlay hints for local bindings. Pure: server.js asks Yuki.hs and
// hands the answers here; test-symbols.mjs runs these in Node.

import { characterOf, lineMap, spanText } from './text.js';

/** LSP's SymbolKind values the outline uses. */
export const SymbolKind = { Class: 5, Method: 6, Field: 8, Constructor: 9, Interface: 11, Function: 12, Variable: 13, Constant: 14, Struct: 23, TypeParameter: 26 };

/** LSP's InlayHintKind.Type. */
const TYPE_HINT = 1;

/**
 * Which kinds of Yuki's outline entries an entry of a kind holds: a data
 * type its constructors, a constructor its fields, a class its method
 * signatures, default methods and associated types, an instance its
 * bindings. Anything else inside a declaration (a where clause's local
 * functions are not listed at all) stays at the top level.
 */
const HOLDS = {
    data: ['constructor'],
    constructor: ['field'],
    class: ['signature', 'value', 'family'],
    instance: ['method'],
};

/** Whether GHC span `a` ({sl, sc, el, ec}) contains span `b`. */
const contains = (a, b) => (a.sl < b.sl || (a.sl === b.sl && a.sc <= b.sc)) && (a.el > b.el || (a.el === b.el && a.ec >= b.ec));

/** The type of a declaration as GHC prints it (`name :: type`), on one line, without the name. */
const typeOf = (decl) => (decl ? decl.replace(/^\(?[^\s]+?\)?\s*::\s*/, '').replace(/\s+/g, ' ').trim() : '');

/**
 * A module's outline, nested as HLS nests it: constructors under their
 * type and fields under their constructor, method signatures (and the
 * class's associated types) under the class, each instance (named by its
 * head as written, `instance Show Point`) with its bindings. `entries` are
 * Yuki.hs's 'outline' of the module (the spans of the text the check saw),
 * `tops` its 'tops' (each top-level name's type as GHC prints it, for the
 * details), `text` the text the check saw (an instance's head and a
 * field's type are read from it), and `range` turns a GHC span into the
 * LSP range it has in the document now. A class's default method is the
 * signature's: listed once. A binding a deriving clause generated (an
 * instance method with no instance around it) is left out. Every
 * selectionRange is inside its range, as LSP requires.
 */
export function outlineSymbols(entries, tops, text, range) {
    const containerFirst = (e) => (HOLDS[e.kind] ? 0 : 1);
    const at = (e) => `${e.sel.sl}:${e.sel.sc}`;
    // A name GHC also binds as a value where it is declared as something
    // else (a record field's selector, an instance's method) is that
    // something else; and a binding GHC generated where the text does not
    // say its name (a deriving clause's `==` and `showsPrec`, at the
    // clause) is no declaration.
    const declared = new Set(entries.filter((e) => e?.sel && e.kind !== 'value').map(at));
    const written = (e) => e.kind === 'instance' || [e.name, `(${e.name})`].includes(spanText(text, e.sel));
    const sorted = entries
        .filter((e) => e && e.span && e.sel && (e.name || e.kind === 'instance') && !(e.kind === 'value' && declared.has(at(e))) && written(e))
        .slice()
        .sort((a, b) => a.span.sl - b.span.sl || a.span.sc - b.span.sc || b.span.el - a.span.el || b.span.ec - a.span.ec || containerFirst(a) - containerFirst(b));
    const topOf = (e) => tops.find((t) => t.name === e.name && t.span?.sl === e.sel.sl && t.span?.sc === e.sel.sc);
    const roots = [];
    const stack = [];
    for (const e of sorted) {
        while (stack.length && !contains(stack.at(-1).entry.span, e.span)) stack.pop();
        const parent = stack.findLast((p) => HOLDS[p.entry.kind]?.includes(e.kind));
        if (!parent && e.kind === 'method') continue;
        const siblings = parent ? parent.symbol.children : roots;
        if (parent?.entry.kind === 'class' && (e.kind === 'value' || e.kind === 'signature')) {
            const same = siblings.findIndex((s) => s.name === e.name);
            if (same >= 0 && e.kind === 'value') continue;
            if (same >= 0) siblings.splice(same, 1);
        }
        const symbol = toSymbol(e, topOf(e), text, range);
        siblings.push(symbol);
        stack.push({ entry: e, symbol });
    }
    const prune = (list) => {
        for (const s of list) if (s.children.length) prune(s.children);
        else delete s.children;
        return list;
    };
    return prune(roots);
}

function toSymbol(e, top, text, range) {
    const whole = contains(e.span, e.sel) ? e.span : e.sel;
    let name = e.name;
    let detail = '';
    let kind;
    switch (e.kind) {
        case 'data':
            kind = SymbolKind.Struct;
            break;
        case 'class':
            kind = SymbolKind.Interface;
            break;
        case 'instance':
            kind = SymbolKind.Interface;
            name = spanText(text, e.span).split(/\bwhere\b/)[0].replace(/\s+/g, ' ').trim() || 'instance';
            break;
        case 'synonym':
        case 'family':
            kind = SymbolKind.TypeParameter;
            break;
        case 'pattern':
        case 'constructor':
            kind = SymbolKind.Constructor;
            detail = typeOf(top?.type);
            break;
        case 'field':
            kind = SymbolKind.Field;
            // `px :: Double`: the field's type as written.
            detail = spanText(text, e.span).replace(/^[^:]*::\s*/, '').replace(/\s+/g, ' ').trim();
            break;
        case 'signature':
        case 'method':
            kind = SymbolKind.Method;
            detail = typeOf(top?.type);
            break;
        default:
            detail = typeOf(top?.type);
            kind = /->/.test(detail) ? SymbolKind.Function : SymbolKind.Constant;
    }
    return { name, detail, kind, range: range(whole), selectionRange: range(e.sel), children: [] };
}

/**
 * How well a symbol's name matches what was typed in a workspace symbol
 * search, lower being better, or null when it does not: the name itself,
 * then ignoring case, a prefix, then ignoring case, a part of the name,
 * then the letters in order with others between them (`dst` matches
 * `distance`). An empty query matches everything equally. Spaces in the
 * query are ignored.
 */
export function matchScore(query, name) {
    const q = query.replace(/\s+/g, '');
    if (!q) return 0;
    const lq = q.toLowerCase();
    const ln = name.toLowerCase();
    if (name === q) return 0;
    if (ln === lq) return 1;
    if (name.startsWith(q)) return 2;
    if (ln.startsWith(lq)) return 3;
    if (ln.includes(lq)) return 4;
    let i = 0;
    for (const c of ln) if (c === lq[i]) i++;
    return i === lq.length ? 5 : null;
}

/**
 * The answer to `workspace/symbol`: every symbol of the files' outlines
 * (`files`: [{uri, symbols}], each file's document symbols) whose name
 * matches `query`, nested ones with their parent's name as containerName,
 * best match first (then shorter names, then by file and position), at
 * most `limit`. The location's range is the whole declaration, as LSP
 * says it is.
 */
export function searchSymbols(files, query, limit = 250) {
    const found = [];
    const visit = (uri, list, container) => {
        for (const s of list) {
            const score = matchScore(query, s.name);
            if (score !== null) found.push({ score, line: s.range.start.line, info: { name: s.name, kind: s.kind, location: { uri, range: s.range }, ...(container && { containerName: container }) } });
            if (s.children) visit(uri, s.children, s.name);
        }
    };
    for (const f of files) visit(f.uri, f.symbols, '');
    found.sort((a, b) => a.score - b.score || a.info.name.length - b.info.name.length || (a.info.location.uri < b.info.location.uri ? -1 : a.info.location.uri > b.info.location.uri ? 1 : 0) || a.line - b.line);
    return found.slice(0, limit).map((f) => f.info);
}

/**
 * Whether a type as GHC prints it mentions a type variable (`a -> a`,
 * `Map k v`): a signature with one, written inside a function, would not
 * mean the outer signature's variable without ScopedTypeVariables, so no
 * edit writes it.
 */
export function hasTypeVariables(type) {
    // A type-level string (`Proxy "x"`) is no variable.
    return /(?:^|[^\w'.])[a-z_][\w']*/.test(type.replace(/"(?:[^"\\]|\\.)*"/g, '""'));
}

/**
 * HLS's inlay hints for local bindings: after the name of each let or
 * where binding and each variable bound with `<-` (in a do block, a guard
 * or a comprehension) that has no signature,
 * its type as GHC inferred it (`:: Point`). `binds` is Yuki.hs's 'binds'
 * for the text the last check saw (`before`); a hint is moved to where
 * its line is in `after` (the text now) and kept only where the name is
 * still written there, so a check a keystroke behind hints nothing
 * wrongly. Only lines `from` to `to` (0-based, inclusive) are answered. A
 * let or where binding's hint carries the edit that writes the signature
 * above it, at the name's column so it stays in the same layout block
 * (`let a :: Point` then `    a = ...`); not for an operator or a name
 * defined infix, and not for a type with type variables (see
 * hasTypeVariables).
 */
export function bindingHints(binds, before, after, from = 0, to = Infinity) {
    const map = lineMap(before, after);
    const hints = [];
    for (const b of binds) {
        if (!b?.sel || typeof b.name !== 'string' || typeof b.type !== 'string') continue;
        const line = map.forward(b.sel.sl - 1);
        if (line < 0 || line >= map.lines.length || line < from || line > to) continue;
        const text = map.lines[line];
        const start = characterOf(text, b.sel.sc);
        const end = characterOf(text, b.sel.ec);
        if (text.slice(start, end) !== b.name) continue;
        // A variable a match binds is hinted only when it is a do block's
        // `x <- e` (Yuki.hs's "arg": GHC records the lambda the do block
        // expands to): an `<-` follows its pattern, with no `->`, `=` or
        // `\` before it (a function's, a lambda's or a case's argument).
        if (b.kind === 'arg' && !/^(?:(?!->|=|\\).)*<-/.test(text.slice(end))) continue;
        const type = b.type.replace(/\s+/g, ' ').trim();
        const hint = { position: { line, character: end }, label: `:: ${type}`, kind: TYPE_HINT, paddingLeft: true };
        const prefix = text.slice(0, start);
        if (b.kind === 'let' && /^[a-z_]/.test(b.name) && /^(?:\s*|.*\b(?:let|where)\s+)$/.test(prefix) && !hasTypeVariables(type)) {
            const at = { line, character: start };
            hint.textEdits = [{ range: { start: at, end: at }, newText: `${b.name} :: ${type}\n${prefix.replace(/[^\t]/g, ' ')}` }];
        }
        hints.push(hint);
    }
    return hints.sort((x, y) => x.position.line - y.position.line || x.position.character - y.position.character);
}
