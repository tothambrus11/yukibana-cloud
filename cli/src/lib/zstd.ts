/** zstandard in and out, for submissions. Node has it in `zlib` from 22.15;
 *  the Worker does not, which is why the registry only checks the magic
 *  number and the CLI is where a submission is opened. */

import { promisify } from 'node:util';
import { zstdCompress, zstdDecompress } from 'node:zlib';

export async function zstd(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await promisify(zstdCompress)(bytes));
}

export async function unzstd(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await promisify(zstdDecompress)(bytes));
}
