/**
 * SHA-256 fed a chunk at a time, for the service worker's check of a pack
 * file while it streams (verified-cache.ts). `crypto.subtle.digest` takes
 * the whole input at once: checking a 48 MB pack file with it would mean
 * holding all of it before handing the first byte to the page, which costs
 * the pack its download progress and, at a few hundred megabytes, memory a
 * service worker may not have (D50, RR3-8). This one holds 64 bytes.
 *
 * The output is the same lowercase hex `node:crypto` and the build
 * (scripts/offline-manifest.mjs) write, tested against them in
 * tests/unit/sha256.test.mjs. No DOM: the worker has none.
 */

const K = new Int32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** An incremental SHA-256. `update` any number of times, then `hex` once. */
export class Sha256 {
	private readonly h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
	private readonly w = new Int32Array(64);
	/** The bytes of an unfinished block, `pending` of them. */
	private readonly block = new Uint8Array(64);
	private pending = 0;
	/** Bytes hashed so far; a Number is exact up to 2^53, some 9 PB. */
	private length = 0;
	private done = false;

	/** Adds bytes. The array is only read, never kept, so the caller may reuse it. Throws after `hex`. */
	update(bytes: Uint8Array): this {
		if (this.done) throw new Error('Sha256: update after hex');
		this.length += bytes.length;
		let i = 0;
		if (this.pending > 0) {
			const take = Math.min(64 - this.pending, bytes.length);
			this.block.set(bytes.subarray(0, take), this.pending);
			this.pending += take;
			i = take;
			if (this.pending < 64) return this;
			this.compress(this.block, 0);
			this.pending = 0;
		}
		for (; i + 64 <= bytes.length; i += 64) this.compress(bytes, i);
		if (i < bytes.length) {
			this.block.set(bytes.subarray(i), 0);
			this.pending = bytes.length - i;
		}
		return this;
	}

	/** The digest of everything added, as 64 lowercase hex digits. Ends the hash: a second call throws. */
	hex(): string {
		if (this.done) throw new Error('Sha256: hex called twice');
		const bits = this.length * 8;
		const tail = new Uint8Array(this.pending < 56 ? 64 - this.pending : 128 - this.pending);
		tail[0] = 0x80;
		// The length in bits, big-endian, in the last eight bytes; the high
		// word is whatever lies above 2^32 bits.
		const high = Math.floor(bits / 0x100000000);
		const n = tail.length;
		tail[n - 8] = high >>> 24;
		tail[n - 7] = high >>> 16;
		tail[n - 6] = high >>> 8;
		tail[n - 5] = high;
		tail[n - 4] = bits >>> 24;
		tail[n - 3] = bits >>> 16;
		tail[n - 2] = bits >>> 8;
		tail[n - 1] = bits;
		this.update(tail);
		this.done = true;
		let out = '';
		for (const word of this.h) out += (word >>> 0).toString(16).padStart(8, '0');
		return out;
	}

	private compress(bytes: Uint8Array, at: number): void {
		const w = this.w;
		for (let t = 0; t < 16; t++) {
			const j = at + t * 4;
			w[t] = (bytes[j]! << 24) | (bytes[j + 1]! << 16) | (bytes[j + 2]! << 8) | bytes[j + 3]!;
		}
		for (let t = 16; t < 64; t++) {
			const a = w[t - 15]!;
			const b = w[t - 2]!;
			const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
			const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
			w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) | 0;
		}
		const h = this.h;
		let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, k = h[7]!;
		for (let t = 0; t < 64; t++) {
			const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
			const t1 = (k + S1 + ((e & f) ^ (~e & g)) + K[t]! + w[t]!) | 0;
			const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
			const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
			k = g;
			g = f;
			f = e;
			e = (d + t1) | 0;
			d = c;
			c = b;
			b = a;
			a = (t1 + t2) | 0;
		}
		h[0] = (h[0]! + a) | 0;
		h[1] = (h[1]! + b) | 0;
		h[2] = (h[2]! + c) | 0;
		h[3] = (h[3]! + d) | 0;
		h[4] = (h[4]! + e) | 0;
		h[5] = (h[5]! + f) | 0;
		h[6] = (h[6]! + g) | 0;
		h[7] = (h[7]! + k) | 0;
	}
}
