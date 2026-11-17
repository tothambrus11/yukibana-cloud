// The RPC frame of common/SPEC.md, the same on both sides, synchronous.
'use strict';
const fs = require('node:fs');

const CALL = 1, RETURN = 2, ERROR = 3;
const SOLVE = 1, WEIGHT = 2, WEIGHT_MANY = 3;

class Channel {
  constructor(readPath, writePath, handlers, readFirst) {
    // Both FIFOs block on open until the other end opens them, so the two
    // sides open them in the same order.
    if (readFirst) {
      this.r = fs.openSync(readPath, 'r');
      this.w = fs.openSync(writePath, 'w');
    } else {
      this.w = fs.openSync(writePath, 'w');
      this.r = fs.openSync(readPath, 'r');
    }
    this.handlers = handlers;
    this.buf = Buffer.alloc(1 << 16);
    this.start = 0;
    this.end = 0;
  }

  /** n bytes, or null at the end of the stream. */
  take(n) {
    if (this.end - this.start < n) {
      if (n > this.buf.length) {
        const bigger = Buffer.alloc(Math.max(n, this.buf.length * 2));
        this.buf.copy(bigger, 0, this.start, this.end);
        this.buf = bigger;
      } else {
        this.buf.copy(this.buf, 0, this.start, this.end);
      }
      this.end -= this.start;
      this.start = 0;
      while (this.end < n) {
        const got = fs.readSync(this.r, this.buf, this.end, this.buf.length - this.end, null);
        if (got === 0) return null;
        this.end += got;
      }
    }
    const out = this.buf.subarray(this.start, this.start + n);
    this.start += n;
    return out;
  }

  send(kind, fn, values) {
    const b = Buffer.alloc(8 + 8 * values.length);
    b.writeUInt8(kind, 0);
    b.writeUInt8(fn, 1);
    b.writeUInt32LE(values.length, 4);
    for (let i = 0; i < values.length; i++) b.writeBigInt64LE(BigInt(values[i]), 8 + 8 * i);
    let off = 0;
    while (off < b.length) off += fs.writeSync(this.w, b, off);
  }

  call(fn, values) {
    this.send(CALL, fn, values);
    return this.wait();
  }

  /** Serve calls until a return arrives; null at the end of the stream. */
  wait() {
    for (;;) {
      const head = this.take(8);
      if (head === null) return null;
      const kind = head[0], fn = head[1], count = head.readUInt32LE(4);
      const body = count ? this.take(8 * count) : Buffer.alloc(0);
      const values = new Array(count);
      for (let i = 0; i < count; i++) values[i] = Number(body.readBigInt64LE(8 * i));
      if (kind === CALL) {
        let result;
        try {
          result = this.handlers[fn](values);
        } catch (e) {
          console.error(e);
          this.send(ERROR, fn, []);
          continue;
        }
        this.send(RETURN, fn, result);
      } else if (kind === RETURN) {
        return values;
      } else {
        throw new Error(`call ${fn} failed on the other side`);
      }
    }
  }
}

module.exports = { Channel, SOLVE, WEIGHT, WEIGHT_MANY };
