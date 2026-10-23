/** zstandard decompression, for submissions the CLI and the IDE compressed
 *  with it until October 2026; everything is gzip now. Node has it in
 *  `zlib` from 22.15. */

import { promisify } from 'node:util';
import { zstdDecompress } from 'node:zlib';

/** Returns `bytes`, a zstandard frame, decompressed. */
export async function unzstd(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await promisify(zstdDecompress)(bytes));
}
