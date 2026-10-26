/**
 * A project as a link: the whole project (its language, files, folders,
 * tabs and the settings saved with it) written into the URL's fragment, so
 * a tab's URL is its project. Reopening the browser restores each tab with
 * the project it had, and the Share button's link gives whoever opens it a
 * copy of their own: nothing is stored anywhere but in the link.
 *
 * The fragment is `#project=<encoding>.<data>`:
 *
 *   z  `data` is the document's JSON, compressed with raw DEFLATE
 *      (CompressionStream's `deflate-raw`), in base64url without padding.
 *      What the app writes.
 *   j  `data` is the document's JSON in base64url without padding, for a
 *      link written by hand or by a script that has no DEFLATE at hand.
 *
 * The fragment, not the query, because a browser never sends it to the
 * server: a project is never in a request or a server's log.
 *
 * The document says its schema's version in `v`. `readDocument` validates
 * a document against the schema of its version (arktype), then maps it
 * forward, one version at a time, to the current one, so a link made today
 * still opens after the schema changes. To change the schema: add the new
 * version's type to `SCHEMAS`, a function from the previous version's
 * document to it in `MIGRATIONS`, and move `CURRENT`; never edit a schema
 * that has been released, because links made with it exist.
 *
 * Imports nothing of the app's but the language list, so `node` can load
 * this file directly (tests/unit/project-link.test.mjs).
 */
import { type } from 'arktype';
import { isLanguageId, type LanguageId } from './languages.ts';

/** Version 0: a project as `localStorage` held it before links, with no version and no language (the storage key named it). */
const V0 = type({
	files: 'Record<string, string>',
	'folders?': 'unknown',
	'open?': 'unknown',
	'active?': 'unknown',
	'runOptions?': 'unknown',
	'optimization?': 'unknown',
});

/** How Run runs a C++ program built for a Linux target (cpp-targets.ts, `RunOptions`). */
const RUN_OPTIONS = type({ emulation: "'system' | 'user'", cpus: '1 | 2 | 4', strace: 'boolean' });

/**
 * Version 1: one project of one language. Paths are relative and
 * `/`-separated (project.ts refuses any other). Only `files` is required:
 * no folders, no tabs, no active file and the default settings are what
 * leaving the rest out means, so a link written by hand can be short.
 */
const V1 = type({
	// A key this version does not have is dropped, not carried along.
	'+': 'delete',
	v: '1',
	language: 'string',
	files: 'Record<string, string>',
	/** Folders, empty ones included; a file's own folders are implied. */
	'folders?': 'string[]',
	/** The files open in tabs, in order. */
	'open?': 'string[]',
	/** The file shown; null or absent: the first tab. */
	'active?': 'string | null',
	/** Absent: the defaults. */
	'runOptions?': RUN_OPTIONS,
	/** The optimisation level of a language whose level no file holds (optimization.ts), as its flag. */
	'optimization?': 'string',
});

/** The current version of the document, which `encodeProject` writes and `readDocument` returns. */
export const CURRENT = 1;

/** A project, in the current schema. */
export type ProjectDocument = typeof V1.infer;

/** Every version's schema; `v` absent is version 0. */
const SCHEMAS = { 0: V0, 1: V1 } as const;

/** What a migration may need that its document does not say. */
export interface MigrationContext {
	/** The language a version 0 document is of (its storage key's); a link has no version 0, so none is given for one. */
	language?: LanguageId;
}

/** Each version's document to the next version's, by the version migrated from. */
const MIGRATIONS: { readonly [from: number]: (document: never, context: MigrationContext) => unknown } = {
	0: (d: typeof V0.infer, context: MigrationContext) => {
		if (context.language === undefined) throw new Error('the project does not say its language');
		const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
		// Version 0 was lenient: a bad tab, folder or setting was dropped, never a reason to lose the files. So is this.
		const runOptions = RUN_OPTIONS(d.runOptions);
		return {
			v: 1,
			language: context.language,
			files: d.files,
			folders: strings(d.folders),
			open: strings(d.open),
			active: typeof d.active === 'string' ? d.active : null,
			...(runOptions instanceof type.errors ? {} : { runOptions }),
			...(typeof d.optimization === 'string' ? { optimization: d.optimization } : {}),
		};
	},
};

/**
 * `value` as a current document: validated against its version's schema
 * and migrated forward. Throws an error naming everything wrong (arktype's
 * summary) for a document that is not one, of a version this app does not
 * know (a link from a newer app), or of a language it does not have.
 */
export function readDocument(value: unknown, context: MigrationContext = {}): ProjectDocument {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('the project is not an object');
	const declared = (value as { v?: unknown }).v;
	if (declared !== undefined && (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 1)) throw new Error(`the project's version ${JSON.stringify(declared)} is not one`);
	let version = declared ?? 0;
	if (version > CURRENT) throw new Error(`the project is of version ${version}, made by a newer Yukibana Light than this one (${CURRENT}); reload to update`);
	let document: unknown = value;
	for (;;) {
		const checked = SCHEMAS[version as keyof typeof SCHEMAS](document);
		if (checked instanceof type.errors) throw new Error(checked.summary);
		if (version === CURRENT) {
			const current = checked as ProjectDocument;
			if (!isLanguageId(current.language)) throw new Error(`this Yukibana Light has no language "${current.language}"`);
			return current;
		}
		const migrate = MIGRATIONS[version];
		if (!migrate) throw new Error(`no migration from version ${version}`);
		document = migrate(checked as never, context);
		version++;
	}
}

/** The fragment's key. */
const KEY = 'project';

/**
 * The URL fragment, with its `#`, that holds `document`. Async because
 * compression is a stream.
 */
export async function encodeProject(document: ProjectDocument): Promise<string> {
	const json = new TextEncoder().encode(JSON.stringify(document));
	return `#${KEY}=z.${base64url(await deflate(json))}`;
}

/**
 * Whether a URL fragment (`location.hash`, with or without its `#`) holds a
 * project at all; `decodeProject` then says whether it is a good one. Any
 * other fragment is not the app's and is left alone.
 */
export function holdsProject(hash: string): boolean {
	return hash.replace(/^#/, '').startsWith(`${KEY}=`);
}

/**
 * The project a URL fragment holds, validated and migrated to the current
 * version. Throws, saying why, for a fragment that `holdsProject` accepts
 * but that is damaged (cut short when copied, say), not JSON, or not a
 * project.
 */
export async function decodeProject(hash: string): Promise<ProjectDocument> {
	const rest = hash.replace(/^#/, '');
	if (!holdsProject(rest)) throw new Error('the link holds no project');
	const value = rest.slice(KEY.length + 1);
	const dot = value.indexOf('.');
	const encoding = value.slice(0, dot);
	if (dot < 0 || (encoding !== 'z' && encoding !== 'j')) throw new Error(`the link's project is in an encoding this app does not know ("${encoding}")`);
	let bytes: Uint8Array;
	try {
		bytes = fromBase64url(value.slice(dot + 1));
		if (encoding === 'z') bytes = await inflate(bytes);
	} catch {
		throw new Error('the link is damaged: was it copied in full?');
	}
	let json: unknown;
	try {
		json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch {
		throw new Error('the link is damaged: its project is not JSON');
	}
	return readDocument(json);
}

/** `bytes` in base64url (RFC 4648 §5), without padding: the characters a URL keeps as they are. */
export function base64url(bytes: Uint8Array): string {
	let binary = '';
	// In slices: String.fromCharCode with a whole project's bytes as arguments overflows the stack.
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** The bytes of base64url text, padded or not; also takes plain base64, which a hand might write. Throws on any other character. */
export function fromBase64url(text: string): Uint8Array {
	if (!/^[A-Za-z0-9_+/-]*={0,2}$/.test(text)) throw new Error('not base64url');
	const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/').replace(/=+$/, '').padEnd(Math.ceil(text.replace(/=+$/, '').length / 4) * 4, '='));
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
	return through(bytes, new CompressionStream('deflate-raw'));
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
	return through(bytes, new DecompressionStream('deflate-raw'));
}

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
	const out = new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream));
	return new Uint8Array(await out.arrayBuffer());
}
