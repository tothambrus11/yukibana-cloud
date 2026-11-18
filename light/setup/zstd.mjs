#!/usr/bin/env node
// A stand-in for the zstd command, as much of it as `tar --zstd` uses:
// standard input to standard output, compressing, or decompressing with -d.
// shell.mjs puts bin/zstd (which runs this) on bash's PATH only when bash
// has no zstd of its own, which is the case in Git for Windows. Anything
// else zstd can do is refused by name rather than half done.
import { pipeline } from 'node:stream/promises';
import { createZstdCompress, createZstdDecompress } from 'node:zlib';

let decompress = false;
for (const arg of process.argv.slice(2)) {
	if (arg === '-d' || arg === '--decompress') decompress = true;
	// What tar may add, and what stdin to stdout means anyway.
	else if (['-c', '--stdout', '-q', '--quiet', '-f', '--force', '-'].includes(arg) || /^-T\d+$/.test(arg)) continue;
	else {
		console.error(`zstd (light/setup's stand-in): ${arg} is not supported; install zstd itself`);
		process.exit(2);
	}
}
try {
	await pipeline(process.stdin, decompress ? createZstdDecompress() : createZstdCompress(), process.stdout);
} catch (e) {
	console.error(`zstd (light/setup's stand-in): ${e instanceof Error ? e.message : String(e)}`);
	process.exit(1);
}
