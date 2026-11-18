// The reading side of the pack store, in Node, so that fetching a whole
// (unsplit) pack needs neither bash nor a zstd binary: the same assets,
// names, checks and result as `scripts/pack-store.sh fetch`, which CI keeps
// using. The two must agree on every id; test.mjs compares tree() with
// `pack-store.sh tree` for every pack, so a change to one that is not made
// to the other fails there.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createZstdDecompress } from 'node:zlib';
import * as tar from 'tar';

/** The light/ directory this copy of the tool belongs to, absolute. */
export const LIGHT = fileURLToPath(new URL('..', import.meta.url));
/** Where the app serves packs from: app/static/packs/<pack>. */
export const PACKS = path.join(LIGHT, 'app', 'static', 'packs');
/** Where the tree each installed pack came from is recorded: .pack-trees/<pack>, as pack-store.sh writes it. */
export const TREES = path.join(LIGHT, '.pack-trees');

const TAG = process.env.LIGHT_PACKS_TAG || 'light-packs';
const API = process.env.LIGHT_PACKS_API || 'https://api.github.com';
/** Assets asked per page: GitHub's maximum. A page holding fewer is the last. */
const ASSETS_PER_PAGE = 100;

/**
 * Runs git in light/ and returns its stdout without the trailing newline, or
 * null when it fails (a missing object is an answer here, not an error).
 * @param {string[]} args
 * @param {string} [input] what git reads on stdin
 * @returns {string | null}
 */
function git(args, input) {
	const r = spawnSync('git', ['-C', LIGHT, ...args], { encoding: 'utf8', input });
	if (r.error) throw new Error(`git cannot be run: ${r.error.message}`);
	return r.status === 0 ? r.stdout.replace(/\n$/, '') : null;
}

/**
 * The GitHub repository the stores are read from, owner/name:
 * LIGHT_PACKS_REPO, else origin's when it is on GitHub, else upstream's.
 * @returns {string}
 */
export function repo() {
	if (process.env.LIGHT_PACKS_REPO) return process.env.LIGHT_PACKS_REPO;
	const url = git(['remote', 'get-url', 'origin']) ?? '';
	const m = /github\.com[:/](.+?)(?:\.git)?$/.exec(url);
	return m?.[1] ?? 'tothambrus11/yukibana-cloud';
}

/**
 * The id HEAD's packs/<pack> is stored under: its git tree id, or, for a
 * pack whose `shared` file names other directories of packs/ it bundles
 * from, the blob id of the lines pack-store.sh's tree() documents. Throws
 * naming what is wrong. Committed sources only: uncommitted edits do not
 * change it, which is why the caller warns about them.
 * @param {string} pack
 * @returns {string} 40 hex digits
 */
export function tree(pack) {
	if (!existsSync(path.join(LIGHT, 'packs', pack))) throw new Error(`no pack ${pack} (packs/${pack})`);
	// light/ is a directory of the repository, or (in pack-store.sh's tests)
	// the root of one.
	let root = 'light/packs';
	let id = git(['rev-parse', `HEAD:${root}/${pack}`]);
	if (id === null) {
		root = 'packs';
		id = git(['rev-parse', `HEAD:${root}/${pack}`]);
		if (id === null) throw new Error(`HEAD has no packs/${pack}: commit it first`);
	}
	const shared = git(['show', `HEAD:${root}/${pack}/shared`]);
	if (shared === null) return id;
	const lines = ['yukibana-pack/2', `pack ${pack} ${id}`];
	for (const raw of shared.split('\n')) {
		const name = raw.replace(/#.*/, '').replace(/\s/g, '');
		if (!name) continue;
		if (name.includes('/') || name === '.' || name === '..') throw new Error(`packs/${pack}/shared names ${name}: name a directory of packs/, as kit`);
		const sub = git(['rev-parse', `HEAD:${root}/${name}`]);
		if (sub === null) throw new Error(`packs/${pack}/shared names ${name}, which HEAD has no packs/${name} for`);
		lines.push(`shared ${name} ${sub}`);
	}
	// bash's `<<<` ends the text with a newline, and the id is of exactly that.
	const blob = git(['hash-object', '--stdin'], `${lines.join('\n')}\n`);
	if (blob === null) throw new Error(`git hash-object failed for packs/${pack}'s shared id`);
	return blob;
}

/**
 * GETs $API/repos/<repo>/<what> and returns the parsed JSON, whatever the
 * status: GitHub's errors are JSON objects naming them, which callers
 * refuse. Sends GH_TOKEN when it is set; otherwise GitHub allows 60
 * requests an hour per address.
 * @param {string} what
 * @returns {Promise<unknown>}
 */
async function apiGet(what) {
	/** @type {Record<string, string>} */
	const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'yukibana-light-setup' };
	if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
	const res = await fetch(`${API}/repos/${repo()}/${what}`, { headers });
	const text = await res.text();
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${what}: not JSON: ${text.slice(0, 200)}`);
	}
}

/**
 * @typedef {object} Asset
 * @property {string} name
 * @property {string | null} sha256 what GitHub recorded, null when it recorded none (older assets)
 * @property {string} createdAt ISO 8601, which sorts as text
 * @property {string} url its download URL, readable without an account
 */

/**
 * Every asset of release `tag`, read page by page from its assets list (the
 * list a release embeds is not documented to be complete), or none when
 * the release does not exist. Throws on any other answer.
 * @param {string} [tag]
 * @returns {Promise<Asset[]>}
 */
export async function assets(tag = TAG) {
	const where = `release ${tag} of ${repo()}`;
	const release = /** @type {{ id?: unknown, status?: unknown, message?: unknown }} */ (await apiGet(`releases/tags/${tag}`));
	if (!Number.isSafeInteger(release?.id)) {
		if (release?.status === '404' || release?.message === 'Not Found') return [];
		throw new Error(`${where}: ${String(release?.message ?? JSON.stringify(release).slice(0, 200))}`);
	}
	/** @type {Asset[]} */
	const all = [];
	for (let page = 1; ; page++) {
		// GitHub holds at most 1000 assets a release: 10 pages.
		if (page > 50) throw new Error(`${where} lists more than 50 pages of assets; the API is not paging`);
		const list = await apiGet(`releases/${release.id}/assets?per_page=${ASSETS_PER_PAGE}&page=${page}`);
		if (!Array.isArray(list)) {
			const message = list && typeof list === 'object' && 'message' in list ? String(list.message) : JSON.stringify(list).slice(0, 200);
			throw new Error(`page ${page} of the assets of ${where}: ${message}`);
		}
		for (const a of list) {
			const digest = typeof a.digest === 'string' ? a.digest.replace(/^sha256:/, '') : null;
			all.push({ name: a.name, sha256: digest, createdAt: a.created_at, url: a.browser_download_url });
		}
		if (list.length < ASSETS_PER_PAGE) return all;
	}
}

/**
 * The newest build of `pack` in `list` (`<pack>-<40 hex>.tar.zst`, so pack
 * `c` never takes `cpp`'s), or undefined.
 * @param {string} pack
 * @param {Asset[]} list
 * @returns {Asset | undefined}
 */
export function newestBuild(pack, list) {
	const prefix = `${pack}-`;
	return list
		.filter((a) => a.name.startsWith(prefix) && /^[0-9a-f]{40}\.tar\.zst$/.test(a.name.slice(prefix.length)))
		.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
		.at(-1);
}

/**
 * Downloads HEAD's build of `pack` from the pack store, checks it against
 * the sha256 GitHub recorded, and puts it in place of app/static/packs/<pack>,
 * recording its tree in .pack-trees/<pack>. Returns false, changing nothing,
 * when the store has no build of these sources (and, with `any`, none at
 * all). With `any` a missing build is replaced by the pack's newest, which
 * is said; for a split pack `any` is the only way, as the store holds only
 * its builds from before it was split. A build whose tree is the one
 * recorded for the installed copy is not downloaded again.
 * @param {string} pack
 * @param {{ any?: boolean, log?: (line: string) => void }} [options]
 * @returns {Promise<boolean>}
 */
export async function fetchPack(pack, { any = false, log = (line) => console.error(line) } = {}) {
	const split = existsSync(path.join(LIGHT, 'packs', pack, 'toolchains'));
	if (split && !any) throw new Error(`${pack} is a split pack: its toolchain units are fetched by scripts/pack-toolchain.sh`);
	const want = split ? null : `${pack}-${tree(pack)}.tar.zst`;
	const list = await assets();
	let asset = want === null ? undefined : list.find((a) => a.name === want);
	if (!asset && any) {
		asset = newestBuild(pack, list);
		if (asset) log(`${pack}: no build of these sources yet, taking the newest, ${asset.name}`);
	}
	if (!asset) {
		log(`${pack}: no ${want ?? `${pack}-*.tar.zst`} in ${repo()}'s ${TAG} release`);
		return false;
	}
	const id = path.basename(asset.name, '.tar.zst').slice(pack.length + 1);
	// The newest build taken by an earlier run is in place already: --latest again leaves it.
	if ((await installedTree(pack)) === id) {
		log(`${pack}: ${asset.name} is installed already`);
		return true;
	}
	const tmp = await mkdtemp(path.join(tmpdir(), 'light-setup-'));
	// Extracted beside its destination, so the swap is a rename on one disk.
	const part = path.join(PACKS, `.${pack}.part`);
	try {
		log(`${pack}: downloading ${asset.name}`);
		const archive = path.join(tmp, asset.name);
		const sha256 = await download(asset.url, archive);
		if (asset.sha256 !== null && asset.sha256 !== sha256) throw new Error(`${asset.name}: sha256 mismatch`);
		await rm(part, { recursive: true, force: true });
		await mkdir(part, { recursive: true });
		await pipeline(createReadStream(archive), createZstdDecompress(), tar.x({ cwd: part, strict: true }));
		if (!existsSync(path.join(part, pack, 'server.js'))) throw new Error(`${asset.name} holds no ${pack}/server.js`);
		// The record first: a replace interrupted half way must not leave a half pack that counts as up to date.
		await rm(path.join(TREES, pack), { force: true });
		await rm(path.join(PACKS, pack), { recursive: true, force: true });
		await rename(path.join(part, pack), path.join(PACKS, pack));
		await mkdir(TREES, { recursive: true });
		await writeFile(path.join(TREES, pack), `${id}\n`);
		return true;
	} finally {
		await rm(part, { recursive: true, force: true });
		await rm(tmp, { recursive: true, force: true });
	}
}

/**
 * Downloads `url` to `file`, retrying a failed request up to three times,
 * and returns the sha256 of what was written, hex.
 * @param {string} url
 * @param {string} file
 * @returns {Promise<string>}
 */
async function download(url, file) {
	for (let attempt = 1; ; attempt++) {
		try {
			const res = await fetch(url, { headers: { 'User-Agent': 'yukibana-light-setup' } });
			if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
			const hash = createHash('sha256');
			const tee = new Transform({
				transform(chunk, _encoding, done) {
					hash.update(chunk);
					done(null, chunk);
				},
			});
			await pipeline(Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream} */ (res.body)), tee, createWriteStream(file));
			return hash.digest('hex');
		} catch (e) {
			if (attempt >= 4) throw new Error(`downloading ${url} failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
}

/**
 * The tree recorded for the installed copy of `pack`, or null when there is
 * none or no installed pack.
 * @param {string} pack
 * @returns {Promise<string | null>}
 */
export async function installedTree(pack) {
	if (!existsSync(path.join(PACKS, pack, 'server.js'))) return null;
	try {
		return (await readFile(path.join(TREES, pack), 'utf8')).trim();
	} catch {
		return null;
	}
}

/**
 * Whether packs/<pack> has uncommitted changes, untracked files included:
 * the store has builds of committed sources only.
 * @param {string} pack
 * @returns {boolean}
 */
export function dirty(pack) {
	return (git(['status', '--porcelain', '--', path.posix.join('packs', pack)]) ?? '') !== '';
}
