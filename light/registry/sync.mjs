// Putting a registry kept as a directory (build.mjs) into the bucket the
// official registry's Worker serves from (worker.js), which is how
// https://yukibana.run gets its packs (PLAN.md, stage 2).
//
// The bucket holds one object per path, and the Worker answers a request
// with one read. So a file with a compressed copy beside it in the
// directory is stored as that copy, under the file's own key, with its
// encoding; the Worker sends it as stored, and the edge decodes it for the
// rare client that takes no brotli. The directory registry checked the
// copy against the file when it made it (verifyBuild), and this checks
// the build again before a byte of it leaves.
//
// A build is put whole or is not there: every file first, its pack.json
// last, and a build whose pack.json the bucket has is not put again
// (builds are named by content, so it is the same build). A sync stopped
// half-way leaves files no page asks for, and the next one puts the build
// again from the start. Nothing is ever deleted.
import { lstat, opendir } from 'node:fs/promises';
import path from 'node:path';
import { eachAtOnce, hashFile, openRegistry, verifyBuild } from './build.mjs';
import { DIGEST } from './rules.mjs';
import { BucketError } from './s3.mjs';

/** The key a sync asks about before anything else: the frame's page, which the official bucket has, though whether it is there does not matter. */
const PROBE = 'frame/v1/frame.html';

/** How many objects are put at once. */
const AT_ONCE = 8;

/**
 * What a sync needs of a bucket: S3Bucket in s3.mjs, or a Map in a test.
 * @typedef {object} Bucket
 * @property {(key: string) => Promise<boolean>} has whether an object is at `key`
 * @property {(key: string, file: string, what: { size: number, sha256: string, encoding?: 'br' }) => Promise<void>} put stores the bytes of `file`, which are `size` long and hash to `sha256`, at `key`; rejects with a BucketError when the bucket refuses
 */

/** Whether anything is at `file`. */
async function exists(file) {
	try {
		await lstat(file);
		return true;
	} catch {
		return false;
	}
}

/**
 * The builds of a registry in an order that puts each after the builds it
 * uses that the same registry holds, so that a page never finds a build in
 * the bucket before what it needs. Among builds that do not use each
 * other, by name.
 * @param {Map<string, Iterable<string>>} uses each build's name, and the names of the builds it uses
 * @returns {string[]}
 */
export function orderOf(uses) {
	const order = [];
	const placed = new Set();
	const place = (digest) => {
		if (placed.has(digest) || !uses.has(digest)) return;
		// Marked before its uses are placed: builds are named by content and cannot use each other in a circle, and a forged registry that does must not loop.
		placed.add(digest);
		for (const used of [...(uses.get(digest) ?? [])].sort()) place(used);
		order.push(digest);
	};
	for (const digest of [...uses.keys()].sort()) place(digest);
	return order;
}

/**
 * The object that stands for `file` of the build in `dir`: its compressed
 * copy when it has one, else the file, with what the bucket checks.
 * @param {string} dir
 * @param {string} file
 * @param {{ sha256: string, size: number }} listed the file's own size and hash
 */
async function objectOf(dir, file, listed) {
	const copy = path.join(dir, `${file}.br`);
	if (await exists(copy)) return { file: copy, ...(await hashFile(copy)), encoding: /** @type {'br'} */ ('br') };
	return { file: path.join(dir, file), ...listed };
}

/**
 * Puts every build of the directory registry `registry` that `bucket`
 * lacks into it, as `packs/<digest>/<file>`, in {@link orderOf}'s order,
 * checking each build ({@link verifyBuild}) before any of its files is
 * put. Asks the bucket one question first, so that a key or address it
 * refuses is said at once, also for an empty registry, which is how a
 * deploy checks its key before there are builds. Says through `out` what
 * it does, one line a build.
 *
 * Stops at the first build that fails, its check or the bucket, and
 * returns the problems: a later build may use it.
 * @param {string} registry
 * @param {Bucket} bucket
 * @param {{ out: (line: string) => void }} io
 * @returns {Promise<{ ok: true, uploaded: string[], present: string[] } | { ok: false, problems: string[] }>}
 */
export async function syncRegistry(registry, bucket, io) {
	const opened = await openRegistry(registry);
	if (!opened.ok) return opened;
	// One question first, whatever the registry holds, so a wrong key or address is said before minutes of checking, and by an empty registry too.
	try {
		await bucket.has(PROBE);
	} catch (error) {
		if (error instanceof BucketError) return { ok: false, problems: [`${bucket} does not let this key in: ${error.message}`] };
		throw error;
	}
	const packs = path.join(registry, 'packs');
	/** @type {Map<string, string[]>} */
	const uses = new Map();
	const held = [];
	for await (const entry of await opendir(packs)) {
		// An add in progress is a directory whose name starts with a dot, and is no build yet.
		if (entry.isDirectory() && DIGEST.test(entry.name)) held.push(entry.name);
	}
	/** @type {Map<string, import('./build.mjs').Verified & { ok: true }>} */
	const verified = new Map();
	for (const digest of held) {
		const build = await verifyBuild(path.join(packs, digest), digest);
		if (!build.ok) return { ok: false, problems: build.problems.map((problem) => `${digest}: ${problem}`) };
		verified.set(digest, build);
		uses.set(digest, Object.values(build.manifest.uses).map((use) => use.digest));
	}
	const uploaded = [];
	const present = [];
	try {
		for (const digest of orderOf(uses)) {
			const build = /** @type {import('./build.mjs').Verified & { ok: true }} */ (verified.get(digest));
			const label = `${digest} ${build.manifest.id} ${build.manifest.version}`;
			if (await bucket.has(`packs/${digest}/pack.json`)) {
				present.push(digest);
				io.out(`${label}: in the bucket already`);
				continue;
			}
			for (const [id, use] of Object.entries(build.manifest.uses)) {
				if (!uses.has(use.digest) && !(await bucket.has(`packs/${use.digest}/pack.json`))) {
					io.out(`${label}: uses ${use.digest} as ${id}${use.optional ? ' (optional)' : ''}, which neither this registry nor the bucket holds`);
				}
			}
			const dir = path.join(packs, digest);
			const descriptions = async (name) => ({ name, ...(await hashFile(path.join(dir, name))) });
			const [packJson, filesJson] = [await descriptions('pack.json'), await descriptions('files.json')];
			const objects = [filesJson, ...[...build.files].map(([name, listed]) => ({ name, ...listed }))];
			let bytes = 0;
			await eachAtOnce(
				objects,
				async ({ name, sha256, size }) => {
					const object = await objectOf(dir, name, { sha256, size });
					await bucket.put(`packs/${digest}/${name}`, object.file, object);
					bytes += object.size;
				},
				AT_ONCE,
			);
			// Last: a page that finds pack.json finds every file it names.
			const pack = await objectOf(dir, packJson.name, { sha256: packJson.sha256, size: packJson.size });
			await bucket.put(`packs/${digest}/pack.json`, pack.file, pack);
			uploaded.push(digest);
			io.out(`${label}: put, ${objects.length + 1} objects, ${bytes + pack.size} bytes`);
		}
	} catch (error) {
		if (error instanceof BucketError) return { ok: false, problems: [`${bucket}: ${error.message}`] };
		throw error;
	}
	return { ok: true, uploaded, present };
}
