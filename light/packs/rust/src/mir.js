// What the Rust pack's MIR view asks rustc for and shows (README, "The MIR
// view"; ../../CONTRACT.md, "Showing compiler output"): which crate of the
// project a file is compiled in, and the filter that maps each line of
// rustc's MIR (`-Zunpretty=mir -Zmir-include-spans`) to its source line.
// Pure functions of strings, no I/O: explorer.js runs Miri as rustc,
// test-mir.mjs checks these on tests/fixtures/, which gen.mjs makes with
// the shipped Miri.

import { stem } from './cargo.js';

/**
 * The crate `path` (a .rs file of the project) is compiled in, as Cargo
 * lays a package out: `{ root, name, kind }` with `root` the crate's root
 * file, `kind` 'bin' (src/main.rs), 'lib' (src/lib.rs) or 'test' (a file
 * of tests/, its own crate). Any other file is a module of the library
 * when there is one and src/main.rs does not declare it (`mod name;`),
 * else of the binary. Null when the package has neither root, or for a
 * file that is not Rust.
 */
export function crateOf(files, path, packageName) {
    if (!path.endsWith('.rs')) return null;
    if (/^tests\/[^/]+\.rs$/.test(path)) return { root: path, name: stem(path), kind: 'test' };
    const bin = files['src/main.rs'] !== undefined;
    const lib = files['src/lib.rs'] !== undefined;
    if (path === 'src/main.rs') return { root: path, name: packageName, kind: 'bin' };
    if (path === 'src/lib.rs') return { root: path, name: packageName, kind: 'lib' };
    const module = path.split('/').pop() === 'mod.rs' ? path.split('/').at(-2) : stem(path);
    const declared = bin && new RegExp(`^\\s*(pub(\\([^)]*\\))?\\s+)?mod\\s+${module}\\s*;`, 'm').test(files['src/main.rs']);
    if (lib && !declared) return { root: 'src/lib.rs', name: packageName, kind: 'lib' };
    if (bin) return { root: 'src/main.rs', name: packageName, kind: 'bin' };
    return lib ? { root: 'src/lib.rs', name: packageName, kind: 'lib' } : null;
}

/**
 * The span rustc prints after a MIR line with `-Zmir-include-spans`:
 * `// scope 0 at src/main.rs:2:5: 2:10`, `// in scope 1 at …` (a local),
 * `// return place in scope 0 at …`. The path is the project's (rustc is
 * given `--remap-path-prefix=/project/=`), or an absolute one outside it
 * (the standard library's macros).
 */
const SPAN = /\s*\/\/ (?:[\w ]*?\s)?(?:scope \d+ )?at (\S+?):(\d+):(\d+): (\d+):(\d+)\s*$/;
/** An item's header: `fn main() -> () {`, `const X: i32 = {`, `promoted[0] in main: &[&str; 2] = {`, `static …`. */
const ITEM = /^(fn |const |static |promoted\[\d+\] |\S.*\{\s*$)/;

/**
 * Filters rustc's MIR for reading and maps each line to its source line:
 * the span comment of each statement, terminator and local is removed from
 * the line and becomes its mapping (`{ file, line, column }`, `file` a
 * project path or an absolute path outside the project); an item's header
 * (`fn main() -> () {`) and each basic block's label map to the item's
 * first span, column 0; the `// WARNING` banner rustc puts first goes.
 *
 * - `library: false` hides each item none of whose lines maps to a project
 *   file (there are few: rustc prints only the crate's own items).
 *
 * Returns `{ text, lines }` as the C++ pack's filters do (`lines.length` is
 * the number of lines of `text`). Never throws.
 */
export function filterMir(text, { library = false } = {}) {
    const out = []; // { text, map, item }
    let item = -1;
    let items = 0;
    let header = -1;
    for (const line of text.split('\n')) {
        if (/^\/\/ (WARNING: This output format|and is subject to change)/.test(line)) continue;
        const span = SPAN.exec(line);
        const shown = (span ? line.slice(0, span.index) : line).replace(/\s+$/, '');
        const map = span && Number(span[2]) > 0 ? { file: span[1], line: Number(span[2]), column: Number(span[3]) } : null;
        if (/^\S/.test(line) && ITEM.test(line)) {
            item = items++;
            header = out.length;
        }
        out.push({ text: shown, map, item });
        if (item >= 0 && map && out[header].map === null) {
            const first = { file: map.file, line: map.line, column: 0 };
            out[header].map = first;
        }
        if (item >= 0 && line === '}') item = -1;
    }
    // A basic block's label (`    bb0: {`) maps to its first statement or terminator.
    for (let i = 0; i < out.length; i++)
        if (/^\s+bb\d+(\s*\(cleanup\))?: \{$/.test(out[i].text))
            for (let j = i + 1; j < out.length && !/^\s+\}$/.test(out[j].text); j++)
                if (out[j].map) {
                    out[i].map = out[j].map;
                    break;
                }
    let kept = out;
    if (!library) {
        const project = new Set();
        for (const l of out) if (l.item >= 0 && l.map && !l.map.file.startsWith('/')) project.add(l.item);
        kept = kept.filter((l) => l.item < 0 || project.has(l.item));
    }
    kept = kept.filter((l, i) => l.text !== '' || (i > 0 && kept[i - 1].text !== ''));
    while (kept.length && kept[0].text === '') kept.shift();
    while (kept.length && kept.at(-1).text === '') kept.pop();
    return { text: kept.map((l) => l.text).join('\n'), lines: kept.map((l) => l.map) };
}
