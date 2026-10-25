// Writes std/index.json, the standard library's index (src/files.js says
// its shape), from what build.sh listed with the go command, per target:
//
//   node std-index.mjs <go-version> <out-dir> <target>...
//
// reading <out-dir>/<goos>-<goarch>.list (`ImportPath<TAB>Imports` of each
// shipped package, its imports separated by spaces) and
// <out-dir>/<goos>-<goarch>.all (every package of that target's standard
// library), and the archives already copied to <out-dir>/<goos>-<goarch>/.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [version, dir, ...targets] = process.argv.slice(2);
const index = { toolchain: version, targets: {} };
for (const target of targets) {
    const name = target.replace('/', '-');
    const lines = readFileSync(join(dir, `${name}.list`), 'utf8').trim().split('\n');
    const packages = {};
    for (const line of lines) {
        const [path, imports = ''] = line.split('\t');
        packages[path] = { imports: imports.split(' ').filter(Boolean), size: statSync(join(dir, name, `${path}.a`)).size };
    }
    for (const [path, { imports }] of Object.entries(packages)) {
        // Imports without an archive are the compiler's own (unsafe).
        packages[path].imports = imports.filter((p) => packages[p]);
        if (packages[path].imports.length !== imports.filter((p) => p !== 'unsafe').length) {
            throw new Error(`${target}: ${path} imports a package that has no archive: ${imports.filter((p) => !packages[p] && p !== 'unsafe')}`);
        }
    }
    const unshipped = readFileSync(join(dir, `${name}.all`), 'utf8')
        .trim()
        .split('\n')
        .filter((p) => !packages[p] && !p.startsWith('vendor/') && p !== 'unsafe');
    index.targets[target] = { packages, unshipped };
}
writeFileSync(join(dir, 'index.json'), JSON.stringify(index));
for (const [target, { packages, unshipped }] of Object.entries(index.targets)) {
    const bytes = Object.values(packages).reduce((n, p) => n + p.size, 0);
    console.log(`${target}: ${Object.keys(packages).length} packages shipped (${(bytes / 1e6).toFixed(1)} MB), ${unshipped.length} not`);
}
