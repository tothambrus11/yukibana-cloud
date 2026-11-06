// The project as Cargo sees it, and the archives the Rust pack ships: pure
// functions shared by the runner and the compiler output worker (runner.js,
// explorer.js). No I/O and no imports, so node runs their tests (test-mir.mjs)
// with no npm install.

const decoder = new TextDecoder();

/** The edition when Cargo.toml names none or one rustc 1.98 does not know: the template's (2024 is known too). */
export const DEFAULT_EDITION = '2021';
export const EDITIONS = new Set(['2015', '2018', '2021', '2024']);

/** A crate's name as code names it: a file's stem, with dashes as underscores. */
export const stem = (path) => path.split('/').pop().replace(/\.rs$/, '').replace(/-/g, '_');

/** Regular files of a ustar archive, as [path, bytes]. */
export function untar(tar) {
    const field = (at, length) => {
        const end = tar.indexOf(0, at);
        return decoder.decode(tar.subarray(at, end < 0 || end > at + length ? at + length : end));
    };
    const files = [];
    for (let at = 0; at + 512 <= tar.length && tar[at] !== 0; ) {
        const name = field(at, 100);
        const prefix = field(at + 345, 155);
        const size = parseInt(field(at + 124, 12).trim() || '0', 8);
        const type = String.fromCharCode(tar[at + 156] || 48);
        at += 512;
        if (type === '0') files.push([prefix ? `${prefix}/${name}` : name, tar.subarray(at, at + size)]);
        at += Math.ceil(size / 512) * 512;
    }
    return files;
}

/**
 * `[package] name` and `edition` from Cargo.toml, and the crates it names
 * under `[dependencies]` and `[dev-dependencies]` (`name = "1"`, `name = {
 * version = "1", ... }` or a `[dependencies.name]` table), each with its
 * version requirement (null when none is given). A line-based reading,
 * enough for the keys a package needs; anything else in it is ignored.
 * Crate names have dashes as underscores, as code names them.
 */
export function manifest(files) {
    const text = files['Cargo.toml'] ?? '';
    let section = '';
    const values = {};
    const dependencies = new Map();
    const devDependencies = new Map();
    const kinds = { dependencies, 'dev-dependencies': devDependencies };
    let table = null; // [map, crate] while in [dependencies.<crate>]
    for (const raw of text.split('\n')) {
        const line = raw.replace(/#.*$/, '').trim();
        const header = /^\[([^\]]+)\]$/.exec(line);
        if (header) {
            section = header[1].trim();
            const t = /^((?:dev-)?dependencies)\.(.+)$/.exec(section);
            table = t ? [kinds[t[1]], t[2].trim().replace(/^"|"$/g, '').replace(/-/g, '_')] : null;
            if (table) table[0].set(table[1], null);
            continue;
        }
        const kv = /^([A-Za-z_-]+)\s*=\s*"([^"]*)"$/.exec(line);
        if (kv && section === 'package') values[kv[1]] = kv[2];
        if (kv && table && kv[1] === 'version') table[0].set(table[1], kv[2]);
        const dep = /^([A-Za-z0-9_"-]+)\s*=\s*(.*)$/.exec(line);
        if (dep && kinds[section]) {
            const req = /^"([^"]*)"/.exec(dep[2]) ?? /\bversion\s*=\s*"([^"]*)"/.exec(dep[2]);
            kinds[section].set(dep[1].replace(/"/g, '').replace(/-/g, '_'), req ? req[1] : null);
        }
    }
    const name = (values.name || 'app').replace(/-/g, '_');
    const edition = EDITIONS.has(values.edition) ? values.edition : DEFAULT_EDITION;
    return { name, edition, declared: values.edition, dependencies, devDependencies };
}

/**
 * Whether `version` (x.y.z) meets a Cargo version requirement: comma-
 * separated comparators, each `^` (the default), `~`, `=`, `<`, `<=`, `>`,
 * `>=` or a wildcard (`1.*`, `*`), by Cargo's rules (a caret allows changes
 * that keep the leftmost non-zero part). Pre-release requirements are not
 * understood (false).
 */
export function satisfies(version, requirement) {
    const v = version.split('.').map(Number);
    const cmp = (a, b) => {
        for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0) ? -1 : 1;
        return 0;
    };
    return requirement.split(',').every((raw) => {
        const m = /^\s*(\^|~|=|<=|>=|<|>)?\s*(\*|\d+)(?:\.(\*|\d+))?(?:\.(\*|\d+))?\s*$/.exec(raw);
        if (!m) return false;
        const op = m[1] ?? '^';
        const parts = [m[2], m[3], m[4]].filter((p) => p !== undefined && p !== '*').map(Number);
        const wildcard = [m[2], m[3], m[4]].includes('*');
        const low = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
        // The first version past the range a partial or caret requirement allows.
        const bump = (i) => [...parts.slice(0, i), parts[i] + 1, 0, 0].slice(0, 3);
        if (wildcard || (op === '=' && parts.length < 3)) {
            if (parts.length === 0) return true;
            return cmp(v, low) >= 0 && cmp(v, bump(parts.length - 1)) < 0;
        }
        switch (op) {
            case '=': return cmp(v, low) === 0;
            case '>': return parts.length === 3 ? cmp(v, low) > 0 : cmp(v, bump(parts.length - 1)) >= 0;
            case '>=': return cmp(v, low) >= 0;
            case '<': return cmp(v, low) < 0;
            case '<=': return parts.length === 3 ? cmp(v, low) <= 0 : cmp(v, bump(parts.length - 1)) < 0;
            case '~': return cmp(v, low) >= 0 && cmp(v, bump(Math.min(parts.length - 1, 1))) < 0;
            default: {
                // ^: up to the next change of the leftmost non-zero part
                // given (^0.0 and ^0 are partial: the last part given).
                const lead = parts.findIndex((p) => p !== 0);
                const at = lead === -1 ? parts.length - 1 : lead;
                return cmp(v, low) >= 0 && cmp(v, bump(at)) < 0;
            }
        }
    });
}
