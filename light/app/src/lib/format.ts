/**
 * Short forms of what the app shows in tight places: a duration as the
 * terminal and the compiler output views say it, and a language server's
 * name as the status bar says it.
 *
 * Imports nothing, so `node` can load this file directly
 * (tests/unit/format.test.mjs).
 */

/**
 * `ms` milliseconds as a person reads a duration: whole milliseconds under
 * a second (`412 ms`), else seconds with one decimal (`40.7 s`), the form
 * the terminal's "Exited … after 7.2 s" uses. The views used to say
 * `40659 ms`, which nobody reads at a glance. A negative or non-finite
 * value is shown as `0 ms`, never as `NaN`.
 */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return '0 ms';
	if (ms < 1000) return `${Math.round(ms)} ms`;
	return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * A language server's name and version (what `initialize` answered in
 * `serverInfo`, as lsp/client.ts joins them) cut to what fits a status bar:
 * the server's name and the major.minor of its version, such as
 * `clangd 21.1` for `clangd clangd version 21.1.8 (…)`, whose name is said
 * twice. Where the version in brackets is a better-known product's (the
 * JavaScript pack is `yukibana-typescript-ls 0.1.0 (TypeScript 6.0.3)`),
 * that product is named instead. A string without a version is returned
 * as it is; the full string belongs in the item's title, not here.
 */
export function serverLabel(server: string): string {
	const text = server.trim().replace(/\s+/g, ' ');
	const product = /\((TypeScript|Scala) (\d+)(?:\.(\d+))?/.exec(text);
	if (product) return `${product[1]} ${product[2]}${product[3] !== undefined ? `.${product[3]}` : ''}`;
	const [name = '', ...rest] = text.split(' ');
	const version = /(?:^|[\s(])v?(\d+)(?:\.(\d+))?(?:[.\-+]\S*)?(?=$|[\s);,])/.exec(rest.join(' '));
	if (!name) return text;
	if (!version) return text;
	return `${name} ${version[1]}${version[2] !== undefined ? `.${version[2]}` : ''}`;
}
