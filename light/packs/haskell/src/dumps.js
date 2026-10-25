// What the Haskell pack's compiler output views show (README, "Compiler
// output views"; ../../CONTRACT.md, "Showing compiler output"): GHC's own
// dumps of one module, Core (-ddump-simpl), STG (-ddump-stg-final), Cmm
// (-ddump-cmm) and its WebAssembly assembly (-ddump-asm), with each line
// mapped to the source span it came from. Pure functions of strings, no
// I/O and no imports: explorer.js runs GHC, test-dumps.mjs checks these on
// the fixtures in tests/fixtures/, which explorer.js's own GHC wrote.
//
// Source locations. With -g, GHC keeps a source note on every expression it
// can (`src</workspace/Main.hs:4:1-16>`, `src</workspace/Main.hs:(7,1)-(9,13)>`
// for a span over lines), through the simplifier, into STG, and into Cmm
// as `//tick src<…>` statements. A note covers the expression after it, so
// a Core or STG line maps to the innermost note whose expression it is
// part of, which the printer's indentation says; a Cmm statement to the
// last note before it in its procedure. The assembly has no notes: each of
// its functions maps to its Cmm procedure's first note, on the line, with
// no column. The project is compiled in /workspace, so a note's file is a
// project path once that prefix goes; a note of a file outside the project
// keeps its own path.

/** A source note: `src<file:line:col-col>`, `src<file:(line,col)-(line,col)>` or `src<file:line:col>`. */
const NOTE = /src<([^:>]+):(?:\((\d+),(\d+)\)-\(\d+,\d+\)|(\d+):(\d+)(?:-\d+)?)>/g;
const ROOT = '/workspace/';

/** The mapping a note gives: its file (a project path, or its own path outside the project), its first line and column. */
function noteAt(m) {
    const file = m[1].startsWith(ROOT) ? m[1].slice(ROOT.length) : m[1];
    const line = Number(m[2] ?? m[4]);
    const column = Number(m[3] ?? m[5]);
    return line > 0 ? { file, line, column } : null;
}

/** The dump's own scaffolding: banners, sizes, and the blank lines between dumps. */
const BANNER = /^={5,} .* ={5,}$/;
const SIZES = /^(Result size of .*|  = \{terms: .*\}|-- RHS size: \{.*\})$/;

/**
 * Lines of a dump without its banners (`==================== Tidy Core
 * ====================`) and, unless `details`, its size reports
 * (`-- RHS size: {terms: 5, …}`), with blank lines at most one in a row.
 */
function body(text, details) {
    const rows = [];
    for (const line of text.split('\n')) {
        if (BANNER.test(line) || (!details && SIZES.test(line))) continue;
        if (line.trim() === '' && (rows.length === 0 || rows.at(-1).trim() === '')) continue;
        rows.push(line.replace(/\s+$/, ''));
    }
    while (rows.length && rows.at(-1) === '') rows.pop();
    return rows;
}

const indentOf = (line) => line.length - line.trimStart().length;
/** A line that starts a top-level binding (Core's `square :: …`, STG's `Main.square`, `Rec {`): unindented, not a comment. */
const TOP = (line) => line !== '' && indentOf(line) === 0 && !line.startsWith('--') && line !== 'end Rec }';

/**
 * Filters a Core or STG dump (`-ddump-simpl`, `-ddump-stg-final`, with
 * -g) for reading and maps each line to its source line.
 *
 * A note at the start of a line covers the lines after it at its
 * indentation or deeper; one after other text on its line, the rest of the
 * line and the lines deeper than it. A line maps to the innermost note
 * covering it (the last one on the line itself, when it has any). The
 * unindented lines of a binding (its type signature, `[GblId, …]`, `name =`)
 * map to the first note of the binding, with no column.
 *
 * - `ticks: false` removes the notes from the text (the mapping stays):
 *   they are most of a -g dump's width, and the colours show the same.
 * - `details: false` also drops the dumps' size reports.
 *
 * Returns `{ text, lines }`: the kept lines and one mapping or null each.
 * Never throws.
 */
export function filterCore(text, { ticks = false, details = false } = {}) {
    const rows = body(text, details);
    const lines = [];
    const shown = [];
    let scopes = []; // { min, map }: notes whose expression may still go on
    let binding = -1; // index in lines of the current top-level binding's first line
    let pending = []; // the binding's unindented lines, waiting for its first note
    for (const row of rows) {
        const indent = indentOf(row);
        if (row === '') scopes = [];
        else scopes = scopes.filter((s) => indent >= s.min);
        if (TOP(row) && !(lines.length && rows[lines.length - 1] !== '' && indentOf(rows[lines.length - 1]) === 0 && binding >= 0 && pending.length)) {
            binding = lines.length;
            pending = [];
        }
        let map = null;
        const notes = [...row.matchAll(NOTE)];
        for (const m of notes) {
            const at = noteAt(m);
            if (!at) continue;
            const leading = row.slice(0, m.index).trim() === '' || /^(src<[^>]*>\s*)+$/.test(row.slice(indent, m.index));
            scopes.push({ min: leading ? indent : indent + 1, map: at });
            map = at;
        }
        map ??= scopes.at(-1)?.map ?? null;
        if (map && pending.length) {
            for (const i of pending) lines[i] = { file: map.file, line: map.line, column: 0 };
            pending = [];
        }
        if (!map && indent === 0 && row !== '' && binding >= 0) pending.push(lines.length);
        lines.push(map);
        shown.push(ticks ? row : row.replace(/src<[^>]*>\s*/g, ''));
    }
    if (ticks) return { text: shown.join('\n'), lines };
    // Without the notes, a line that was only notes is empty, and one that
    // ended in a note before its expression (`= src<…>`, `(src<…>`) is cut
    // short: it is joined with the line under it, which maps more precisely.
    const kept = [];
    for (let i = 0; i < shown.length; i++) {
        const text = shown[i];
        if (text.trim() === '' && rows[i] !== '') continue;
        // The line under it may itself have been only notes (`= src<…>` over `src<…>`): the next one with text.
        let next = i + 1;
        while (next < shown.length && shown[next].trim() === '' && rows[next] !== '') next++;
        const open = /(\(|\s=|^\s*=)\s*$/.test(text) && /src<[^>]*>\s*$/.test(rows[i]) && next < shown.length && shown[next].trim() !== '';
        if (open) {
            shown[next] = `${text.replace(/\s+$/, '')}${text.trimEnd().endsWith('(') ? '' : ' '}${shown[next].trimStart()}`;
            rows[next] = rows[next] || ' ';
            continue;
        }
        kept.push({ text, map: lines[i] });
    }
    return { text: kept.map((l) => l.text).join('\n'), lines: kept.map((l) => l.map) };
}

/** A Cmm procedure's first line: `[Main.square_entry() { //  [R2]`, or a data section's: `[section ""data" . Main.square_closure" {`. */
const PROC = /^([\w.$'#*+<>=!&|^%~/?:@\\-]+)\(\) \{/;

/**
 * Filters a Cmm dump (`-ddump-cmm`, with -g) for reading and maps each
 * line to its source line: a `//tick src<…>` statement maps itself and the
 * statements after it in its procedure, until the next one. A procedure's
 * own lines before its first note (its name, info tables) map to that
 * first note, with no column.
 *
 * - `ticks: false` removes the `//tick` lines (the mapping stays).
 * - `details: false` also removes the `unwind` annotations, which only the
 *   debugger reads.
 *
 * Returns `{ text, lines, procedures }`: as filterCore, and each
 * procedure's first note by the procedure's name (`Main.square_entry`),
 * which the assembly view maps with (filterAsm). Never throws.
 */
export function filterCmm(text, { ticks = false, details = false } = {}) {
    const rows = body(text, details);
    const kept = [];
    const procedures = new Map();
    let current = null;
    let name = null;
    let waiting = []; // the procedure's lines before its first note
    for (const row of rows) {
        // A new group (`[…`), or the next procedure of one (` main_sat_entry() {`).
        const proc = PROC.exec(row.trimStart().replace(/^\[/, ''));
        if (row.startsWith('[') || row === '' || proc) {
            current = null;
            waiting = [];
            name = proc?.[1] ?? null;
        }
        const note = /^\s*\/\/tick /.test(row) ? [...row.matchAll(NOTE)].map(noteAt).find(Boolean) : null;
        if (note) {
            if (name && !procedures.has(name)) procedures.set(name, note);
            for (const l of waiting) l.map = { file: note.file, line: note.line, column: 0 };
            waiting = [];
            current = note;
        }
        if (!details && /^\s*unwind /.test(row)) continue;
        const line = { text: row, map: current };
        if (note && !ticks) continue;
        if (!current && row !== '') waiting.push(line);
        kept.push(line);
    }
    return { text: kept.map((l) => l.text).join('\n'), lines: kept.map((l) => l.map), procedures };
}

/**
 * GHC's Z-encoding of a name into a symbol (`$wgo` is `zdwgo`, `.` in a
 * module name `zi`): what the assembly's labels are spelled in.
 */
const Z_LOWER = { '(': 'ZL', ')': 'ZR', '[': 'ZM', ']': 'ZN', ':': 'ZC', Z: 'ZZ', z: 'zz', '&': 'za', '|': 'zb', '^': 'zc', $: 'zd', '=': 'ze', '>': 'zg', '#': 'zh', '.': 'zi', '<': 'zl', '-': 'zm', '!': 'zn', '+': 'zp', "'": 'zq', '\\': 'zr', '/': 'zs', '*': 'zt', _: 'zu', '%': 'zv' };
const Z_DECODE = Object.fromEntries(Object.entries(Z_LOWER).map(([k, v]) => [v, k]));

/** `name` Z-encoded, character by character (letters and digits stay; anything else not in the table as zNNNU). */
export function zEncode(name) {
    let out = '';
    for (const c of name) out += Z_LOWER[c] ?? (/[A-Za-z0-9]/.test(c) ? c : `z${c.codePointAt(0).toString(16)}U`);
    return out;
}

/**
 * Decodes the Z-encoding of every symbol in `text` (`ghczminternal_GHCziInternalziNum_zdfNumIntzuzdczt_entry`
 * becomes `ghc-internal_GHC.Internal.Num_$fNumInt_$c*_entry`); the `_`
 * between a symbol's package, module and name stays. The text keeps its
 * line count.
 */
export function zDecode(text) {
    return text.replace(/\b[A-Za-z_][\w]*\b/g, (word) => {
        if (!/[zZ]/.test(word)) return word;
        let out = '';
        for (let i = 0; i < word.length; i++) {
            const two = word.slice(i, i + 2);
            const hex = /^z([0-9a-f]+)U/.exec(word.slice(i));
            const tuple = /^Z(\d+)([TH])/.exec(word.slice(i));
            if (hex) {
                out += String.fromCodePoint(parseInt(hex[1], 16));
                i += hex[0].length - 1;
            } else if (tuple) {
                const n = Number(tuple[1]);
                out += tuple[2] === 'T' ? `(${','.repeat(Math.max(n - 1, 0))})` : `(#${','.repeat(Math.max(n - 1, 0))}#)`;
                i += tuple[0].length - 1;
            } else if (Z_DECODE[two]) {
                out += Z_DECODE[two];
                i++;
            } else out += word[i];
        }
        return out;
    });
}

/**
 * The function from an assembly label to the Cmm procedure it was made
 * from (filterCmm's `procedures`), or null. The two spell names
 * differently: Cmm qualifies a local binding by its parent and keeps its
 * occurrence name (`main_sat_s1ix_entry`, with -dsuppress-module-prefixes),
 * the assembly has only its unique (`s1ix_entry`, and `rIK_entry` for a
 * top-level binding the module does not export, `square_rIK` in Cmm); a top-level one is
 * `Main.square_entry` or `square_entry` in Cmm, Z-encoded with its module
 * in the assembly (`Main_square_entry`, and `ZCMain_main_entry` for the
 * `:Main.main` wrapper). A closure's or info table's label (`s1ix_info`)
 * goes with its entry code.
 */
function procedureFinder(procedures, module) {
    const local = new Map();
    for (const [name, note] of procedures) {
        const parts = name.split('_');
        if (parts.length >= 3) local.set(parts.slice(-2).join('_'), note);
    }
    const prefixes = [`${zEncode(module)}_`, `ZC${zEncode(module)}_`];
    return (symbol) => {
        const entry = symbol.replace(/_(info|closure)$/, '_entry');
        const prefix = prefixes.find((p) => entry.startsWith(p));
        if (prefix) {
            const name = zDecode(entry.slice(prefix.length));
            return procedures.get(`${module}.${name}`) ?? procedures.get(name) ?? null;
        }
        // A local name's unique has no `_`, and a top-level one's `_` is Z-encoded (`zu`).
        return entry.split('_').length === 2 ? (local.get(entry) ?? null) : null;
    };
}

/**
 * Filters GHC's WebAssembly assembly (`-ddump-asm`) for reading and maps
 * each function to its Cmm procedure's first note (filterCmm's
 * `procedures`): every line from a function's label to its `end_function`,
 * on the note's line, column 0. `module` is the module's name (`Main`), the
 * prefix its own symbols carry.
 *
 * - `directives: false` removes the directives (`.globaltype`, `.functype`,
 *   `.section`, `.globl`, `.hidden`, …), except the data under a label
 *   (`.int8`, `.int32`, …), and comments.
 * - `demangle: true` Z-decodes the symbols (zDecode).
 *
 * Returns `{ text, lines }`. Never throws.
 */
export function filterAsm(text, { directives = false, demangle = false } = {}, procedures = new Map(), module = 'Main') {
    const find = procedureFinder(procedures, module);
    const kept = [];
    let current = null;
    for (const row of body(text, true)) {
        const label = /^([\w$.]+):\s*$/.exec(row);
        if (label) {
            current = find(label[1]);
            if (current) current = { file: current.file, line: current.line, column: 0 };
        }
        const directive = /^\s*\.[A-Za-z_]/.test(row) && !/^\s*\.(int8|int16|int32|int64|asciz|ascii|byte|skip|zero|size)\b/.test(row);
        const comment = /^\s*#/.test(row);
        if (!directives && (directive || comment)) {
            if (/^\s*end_function\b/.test(row)) current = null;
            continue;
        }
        kept.push({ text: demangle ? zDecode(row) : row, map: current });
        if (/^\s*end_function\b/.test(row)) current = null;
    }
    const rows = kept.filter((l, i) => l.text.trim() !== '' || (i > 0 && kept[i - 1].text.trim() !== ''));
    while (rows.length && rows[0].text.trim() === '') rows.shift();
    return { text: rows.map((l) => l.text).join('\n'), lines: rows.map((l) => l.map) };
}
