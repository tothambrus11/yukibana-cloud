// Writes build/licenses/app.txt: the licence of every npm package the app's
// own code is built from (package.json's dependencies, Svelte and
// SvelteKit's client runtime, and everything those depend on), each under
// its name and version, with the third-party notices a package ships beside
// its licence (Monaco's ThirdPartyNotices.txt). The Licences dialog
// (src/lib/components/Licenses.svelte) links it, beside each pack's own
// LICENSE-*.txt files.
//
// It is a superset: a package the bundle tree-shakes away entirely is still
// listed. A package that ships no licence file but names MIT or ISC in its
// package.json gets that licence's standard text under its author's name,
// which is what those licences ask to be kept; any other package without a
// licence file fails the build by name, since shipping it would leave its
// licence undisclosed.
//
// Runs after `vite build` and before offline-manifest.mjs (package.json,
// "build"), which lists the file among the lazy ones.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
const roots = [...Object.keys(pkg.dependencies ?? {}), 'svelte', '@sveltejs/kit'];

/** The directory of an installed package, looked up from `from` as Node does; null if absent. */
function locate(name, from) {
	for (let dir = from; ; dir = dirname(dir)) {
		const candidate = join(dir, 'node_modules', name);
		if (existsSync(join(candidate, 'package.json'))) return candidate;
		if (dirname(dir) === dir) return null;
	}
}

const seen = new Map();
const missing = [];
const visit = (name, from) => {
	const dir = locate(name, from);
	if (!dir) {
		missing.push(`${name} (not installed)`);
		return;
	}
	if (seen.has(dir)) return;
	const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
	seen.set(dir, meta);
	for (const dep of Object.keys(meta.dependencies ?? {})) visit(dep, dir);
};
for (const name of roots) visit(name, app);

const LICENCE = /^(licen[cs]e|copying)(\.(md|txt))?$/i;
/** The standard texts of the licences a package may name without shipping a file. */
const STANDARD = {
	MIT: (who) =>
		`MIT License\n\nCopyright (c) ${who}\n\n` +
		'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\n' +
		'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\n' +
		'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
	ISC: (who) =>
		`ISC License\n\nCopyright (c) ${who}\n\n` +
		'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n\n' +
		'THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.',
};
/** package.json's author, as a copyright line names them. */
const authorOf = (meta) => (typeof meta.author === 'string' ? meta.author : meta.author?.name ? `${meta.author.name}${meta.author.email ? ` <${meta.author.email}>` : ''}` : null);
const NOTICE = /^(third-?party-?notices|notice)(\.(md|txt))?$/i;
const sections = [];
for (const [dir, meta] of [...seen].sort(([, a], [, b]) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
	const files = readdirSync(dir).filter((f) => LICENCE.test(f) || NOTICE.test(f)).sort((a, b) => Number(NOTICE.test(a)) - Number(NOTICE.test(b)) || a.localeCompare(b));
	let texts = files.map((f) => readFileSync(join(dir, f), 'utf8').trim()).join('\n\n');
	if (!files.some((f) => LICENCE.test(f))) {
		const standard = STANDARD[meta.license];
		const who = authorOf(meta);
		if (!standard || !who) {
			missing.push(`${meta.name}@${meta.version} (no licence file)`);
			continue;
		}
		texts = [`(${meta.name} ships no licence file; this is the standard ${meta.license} text its package.json names, under its author.)\n\n${standard(who)}`, texts].filter(Boolean).join('\n\n');
	}
	sections.push(`${'='.repeat(78)}\n${meta.name} ${meta.version} (${meta.license ?? 'see below'})\n${'='.repeat(78)}\n\n${texts}\n`);
}
if (missing.length) {
	console.error(`licenses.mjs: cannot disclose the licence of ${missing.join(', ')}`);
	process.exit(1);
}

const out = join(app, 'build/licenses/app.txt');
await mkdir(dirname(out), { recursive: true });
await writeFile(
	out,
	`Yukibana Light: the licences of the npm packages its app is built from (${sections.length} packages).\n` +
		`Each language pack's own licences are in its directory (packs/<pack>/LICENSE-*.txt), listed in the app's Licences dialog.\n\n` +
		sections.join('\n'),
);
console.log(`licenses/app.txt: ${sections.length} packages`);
