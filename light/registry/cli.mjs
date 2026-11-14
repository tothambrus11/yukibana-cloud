#!/usr/bin/env node
// yukibana-registry: fills and checks a registry kept as a directory, and
// puts one into the bucket behind https://yukibana.run
// (REGISTRY-DESIGN.md 8):
//
//   yukibana-registry init   <registry>
//       Makes <registry> an empty registry.
//   yukibana-registry stamp  <build-dir> --meta <file>
//       Describes <build-dir> as a build: writes its files.json and its
//       pack.json (saying what <file> says, a JSON object with id, name,
//       version, protocol, requires and uses) and prints the build's name.
//   yukibana-registry verify <build-dir> [sha256-<hex>]
//       Checks that <build-dir> is exactly one build, and the named one.
//   yukibana-registry pack   <build-dir> [<archive>]
//       Writes the build as a pack archive, by default
//       <id>-<version>.pack.tar.zst here, and prints the build's name.
//   yukibana-registry add    <registry> <build-dir | archive> [sha256-<hex>]
//       Copies the build into <registry>, checking every file as it goes,
//       and makes the registry's compressed copies of its files.
//   yukibana-registry sync   <registry> <bucket-url>
//       Puts every build of <registry> that the bucket lacks into it, by
//       the S3 API (sync.mjs): <bucket-url> is the bucket's own address,
//       https://<account>.r2.cloudflarestorage.com/<bucket> for R2, and
//       the key comes from AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.
//
// Not yet: `add` from another registry or a URL, roots and `gc`, `check`
// of a served registry, `serve` (PLAN.md, stage 2).
//
// Exit 0 when done, 1 with every problem named on stderr, 2 for a command
// it does not understand.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { addBuild, initRegistry, packBuild, stampBuild, verifyBuild } from './build.mjs';
import { credentialsFromEnv, S3Bucket } from './s3.mjs';
import { syncRegistry } from './sync.mjs';

const USAGE = `usage:
  yukibana-registry init   <registry>
  yukibana-registry stamp  <build-dir> --meta <file>
  yukibana-registry verify <build-dir> [sha256-<hex>]
  yukibana-registry pack   <build-dir> [<archive>]
  yukibana-registry add    <registry> <build-dir | archive> [sha256-<hex>]
  yukibana-registry sync   <registry> <bucket-url>`;

/** Thrown for a command line this tool does not understand: exit 2 with the usage. */
class UsageError extends Error {}

/** `count` bytes as a size a person reads. */
function sizeOf(count) {
	const units = ['bytes', 'KiB', 'MiB', 'GiB'];
	let value = count;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return unit === 0 ? `${count} bytes` : `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * Runs one command line and returns its exit code, writing what it did
 * through `out` and every problem through `err`, one line each.
 * @param {string[]} argv the arguments after the program's name
 * @param {{ out: (line: string) => void, err: (line: string) => void }} io
 * @param {Record<string, string | undefined>} [env] where `sync` reads its key from
 * @returns {Promise<number>}
 */
export async function run(argv, io, env = process.env) {
	try {
		const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { meta: { type: 'string' } } });
		const [command, ...rest] = positionals;
		const takes = (least, most) => {
			if (rest.length < least || rest.length > most) throw new UsageError(`"${command}" takes ${least === most ? least : `${least} or ${most}`} argument${most === 1 ? '' : 's'}`);
		};
		const failed = (problems) => {
			for (const problem of problems) io.err(`yukibana-registry: ${problem}`);
			return 1;
		};
		if (command === 'init') {
			takes(1, 1);
			const made = await initRegistry(rest[0]);
			if (!made.ok) return failed(made.problems);
			io.out(made.created ? `${rest[0]} is now an empty registry` : `${rest[0]} is a registry already`);
			return 0;
		}
		if (command === 'stamp') {
			takes(1, 1);
			if (values.meta === undefined) throw new UsageError('"stamp" needs --meta <file>: what the pack.json is to say');
			let meta;
			try {
				meta = JSON.parse(await readFile(values.meta, 'utf8'));
			} catch (error) {
				return failed([`${values.meta} cannot be read as JSON: ${error instanceof Error ? error.message : String(error)}`]);
			}
			if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return failed([`${values.meta} is not a JSON object`]);
			const stamped = await stampBuild(rest[0], meta);
			if (!stamped.ok) return failed(stamped.problems);
			io.out(stamped.digest);
			io.err(`yukibana-registry: ${stamped.count} files, ${sizeOf(stamped.bytes)}${stamped.skipped > 0 ? `; ${stamped.skipped} compressed ${stamped.skipped === 1 ? 'copy' : 'copies'} left out` : ''}`);
			return 0;
		}
		if (command === 'verify') {
			takes(1, 2);
			const verified = await verifyBuild(rest[0], rest[1]);
			if (!verified.ok) return failed(verified.problems);
			io.out(`${verified.digest} ${verified.manifest.id} ${verified.manifest.version}: ${verified.count} files, ${sizeOf(verified.bytes)}`);
			return 0;
		}
		if (command === 'pack') {
			takes(1, 2);
			const packed = await packBuild(rest[0], rest[1]);
			if (!packed.ok) return failed(packed.problems);
			io.out(packed.digest);
			io.err(`yukibana-registry: ${packed.archive}: ${packed.manifest.id} ${packed.manifest.version}, ${packed.count} files, ${sizeOf(packed.bytes)} unpacked`);
			return 0;
		}
		if (command === 'sync') {
			takes(2, 2);
			const credentials = credentialsFromEnv(env);
			if (!credentials.ok) return failed(credentials.problems);
			let bucket;
			try {
				bucket = new S3Bucket(rest[1], credentials.credentials);
			} catch (error) {
				if (error instanceof RangeError) return failed([error.message]);
				throw error;
			}
			const synced = await syncRegistry(rest[0], bucket, { out: (line) => io.err(`yukibana-registry: ${line}`) });
			if (!synced.ok) return failed(synced.problems);
			io.out(`${synced.uploaded.length} builds put into the bucket, ${synced.present.length} there already`);
			return 0;
		}
		if (command === 'add') {
			takes(2, 3);
			const added = await addBuild(rest[0], rest[1], rest[2]);
			if (!added.ok) return failed(added.problems);
			io.out(`${added.digest} ${added.manifest.id} ${added.manifest.version}: ${added.added ? `added, with ${added.compressed} compressed ${added.compressed === 1 ? 'copy' : 'copies'}` : 'already there'}`);
			for (const missing of added.missing) io.err(`yukibana-registry: the registry lacks ${missing.digest}, which this build uses as ${missing.id}${missing.optional ? ' (optional)' : ''}`);
			return 0;
		}
		throw new UsageError(command === undefined ? 'no command' : `unknown command "${command}"`);
	} catch (error) {
		if (error instanceof UsageError || (error instanceof TypeError && typeof error.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS'))) {
			io.err(`yukibana-registry: ${error.message}`);
			io.err(USAGE);
			return 2;
		}
		// The file system's own refusal (a directory that is not there, a lost race for a build's name): a line, not a trace.
		if (error instanceof Error && typeof error.code === 'string') {
			io.err(`yukibana-registry: ${error.message}`);
			return 1;
		}
		throw error;
	}
}

if (import.meta.main === undefined) throw new Error(`yukibana-registry needs Node 22.18 or later (this is ${process.version})`);
if (import.meta.main) {
	process.exitCode = await run(process.argv.slice(2), { out: (line) => console.log(line), err: (line) => console.error(line) });
}
