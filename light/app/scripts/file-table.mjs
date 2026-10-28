// The build's file table and how it gets into service-worker.js, as pure
// functions of strings (offline-manifest.mjs does the I/O; tested in
// tests/unit/file-table.test.mjs).
//
// The table is the service worker's trust root: it serves a cached file
// only when its bytes have the sha256 the table lists (src/lib/verified-cache.ts,
// which also reads it). It is written into the worker's script rather
// than read from a file, because the browser fetches that script from the
// network, while anything the worker could read from Cache Storage a
// program on the origin could rewrite together with the page it vouches for.

/**
 * The quoted text src/service-worker/index.ts holds where the table goes.
 * The minifier may turn its quotes into backticks; any of the three is found.
 */
export const FILE_TABLE_SLOT = '__YUKIBANA_FILE_TABLE__';

/**
 * The table for a manifest whose every file carries a full sha256:
 * `{version, shell, files: {path: [sha256, size]}}`. The shell is the
 * manifest's plus offline.json itself (`manifest`, its own sha256 and
 * size), which the worker precaches so the Offline dialog works offline.
 * Throws, naming the path, if a file has no full sha256.
 */
export function fileTable(offline, manifest) {
	const files = {};
	const all = [...offline.shell, ...offline.lazy, ...Object.values(offline.packs).flat(), { path: 'offline.json', ...manifest }];
	for (const f of all) {
		if (!/^[0-9a-f]{64}$/.test(f.hash ?? '')) throw new Error(`file table: ${f.path || 'index.html'} has no sha256`);
		files[f.path] = [f.hash, f.size];
	}
	return { version: offline.version, shell: [...offline.shell.map((f) => f.path), 'offline.json'], files };
}

/**
 * The worker's script with the table in its slot, as a string literal the
 * worker passes to JSON.parse. Throws unless the slot appears exactly
 * once: none means the worker changed and would run without a table, two
 * means something else holds the text and would be overwritten too.
 */
export function inlineFileTable(script, table) {
	const slot = new RegExp(`(["'\`])${FILE_TABLE_SLOT}\\1`, 'g');
	const found = script.match(slot)?.length ?? 0;
	if (found !== 1) throw new Error(`file table: service-worker.js holds the slot ${FILE_TABLE_SLOT} ${found} times, not once`);
	// JSON.stringify of a string is a valid JavaScript string literal.
	const literal = JSON.stringify(JSON.stringify(table));
	return script.replace(slot, () => literal);
}
