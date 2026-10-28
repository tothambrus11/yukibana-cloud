// Positions in Haskell source, as GHC counts them and as LSP does, and how
// the lines a check saw moved since. Pure: the language server (server.js)
// and symbols.js use these, and test-symbols.mjs loads them in Node.

/**
 * The UTF-16 character of GHC's 1-based column on a line: GHC counts code
 * points, and a tab moves to the next multiple of 8 (GHC's lexer,
 * advance_tabstop).
 */
export function characterOf(text, col) {
    let c = 1;
    let i = 0;
    while (c < col && i < text.length) {
        const cp = text.codePointAt(i);
        c = cp === 9 ? Math.floor((c - 1) / 8) * 8 + 9 : c + 1;
        i += cp > 0xffff ? 2 : 1;
    }
    return i;
}

/** The 1-based GHC column of a UTF-16 character (characterOf's inverse). */
export function columnOf(text, character) {
    let c = 1;
    for (let i = 0; i < character && i < text.length; ) {
        const cp = text.codePointAt(i);
        c = cp === 9 ? Math.floor((c - 1) / 8) * 8 + 9 : c + 1;
        i += cp > 0xffff ? 2 : 1;
    }
    return c;
}

/**
 * How the lines of `before` (the text a check saw) moved in `after` (the
 * text now), as far as an edit's unchanged head and tail say: lines
 * before the first changed one keep their number, lines after the last
 * shift by the lines added; a line in between has no counterpart (-1).
 * `back` maps the other way, a changed line to the nearest line of the
 * changed region in `before`, which is as close as an unparsed edit lets
 * a position in it be located. `lines` are `after`'s, without their `\r`.
 */
export function lineMap(before, after) {
    const a = before.split('\n');
    const b = after.split('\n');
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    const shift = b.length - a.length;
    return {
        lines: b.map((l) => l.replace(/\r$/, '')),
        forward: (l) => (l < head ? l : l >= a.length - tail ? l + shift : -1),
        back: (l) => (l < head ? l : l >= b.length - tail ? l - shift : Math.max(0, Math.min(l, a.length - tail - 1, a.length - 1))),
    };
}

/**
 * The text of a GHC span ({sl, sc, el, ec}, 1-based, end exclusive) in
 * `text`, or '' where the text has no such lines.
 */
export function spanText(text, s) {
    const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
    if (s.sl < 1 || s.el > lines.length || s.el < s.sl) return '';
    if (s.sl === s.el) {
        const l = lines[s.sl - 1];
        return l.slice(characterOf(l, s.sc), characterOf(l, s.ec));
    }
    const first = lines[s.sl - 1];
    const last = lines[s.el - 1];
    return [first.slice(characterOf(first, s.sc)), ...lines.slice(s.sl, s.el - 1), last.slice(0, characterOf(last, s.ec))].join('\n');
}
