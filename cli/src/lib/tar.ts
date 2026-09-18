/** Tar, read and written in memory.
 *
 *  A course repository is small — sources, a manifest, a few tests — so the
 *  whole archive fits in memory and this stays a pure function of bytes,
 *  testable without a filesystem. What it must understand is what GitHub
 *  produces (`git archive`: pax format, a global header carrying the commit,
 *  extended headers for long paths) and what a student's tools will read
 *  (ustar, with pax extensions only when a path is too long for it).
 */

export type EntryType = 'file' | 'dir' | 'symlink';

export interface Entry {
  /** Forward-slash path, no leading `./`, no trailing slash. */
  readonly path: string;
  readonly type: EntryType;
  /** Unix permission bits. Kept, so `sbt`, `gradlew` and scripts stay executable. */
  readonly mode: number;
  /** Seconds since the epoch. */
  readonly mtime: number;
  readonly data: Uint8Array;
  /** For a symlink: where it points. */
  readonly linkTarget?: string;
}

const BLOCK = 512;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function field(block: Uint8Array, at: number, length: number): string {
  let end = at;
  while (end < at + length && block[end] !== 0) end++;
  return decoder.decode(block.subarray(at, end));
}

function octal(block: Uint8Array, at: number, length: number): number {
  const text = field(block, at, length).trim();
  return text === '' ? 0 : Number.parseInt(text, 8);
}

function paxRecords(data: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  let at = 0;
  while (at < data.length) {
    let space = at;
    while (space < data.length && data[space] !== 0x20) space++;
    const length = Number.parseInt(decoder.decode(data.subarray(at, space)), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = decoder.decode(data.subarray(space + 1, at + length - 1));
    const eq = record.indexOf('=');
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1));
    at += length;
  }
  return out;
}

const clean = (path: string): string => path.replace(/^(\.\/)+/, '').replace(/\/+$/, '');

/** Every entry of the archive, in order. Global headers are read and
 *  dropped; extended headers are folded into the entry they precede. Types
 *  other than file, directory and symlink (devices, fifos) are dropped: none
 *  belongs in a source tree, and a student's tar would refuse them anyway. */
export function readTar(bytes: Uint8Array): Entry[] {
  const entries: Entry[] = [];
  let at = 0;
  let pending: Map<string, string> | null = null;
  let longName: string | null = null;
  let longLink: string | null = null;

  while (at + BLOCK <= bytes.length) {
    const block = bytes.subarray(at, at + BLOCK);
    if (block.every((b) => b === 0)) break;
    const size = octal(block, 124, 12);
    const typeflag = String.fromCharCode(block[156] ?? 0);
    const dataStart = at + BLOCK;
    const data = bytes.subarray(dataStart, dataStart + size);
    at = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (typeflag === 'g') continue;
    if (typeflag === 'x') { pending = paxRecords(data); continue; }
    if (typeflag === 'L') { longName = clean(decoder.decode(data).replace(/\0+$/, '')); continue; }
    if (typeflag === 'K') { longLink = decoder.decode(data).replace(/\0+$/, ''); continue; }

    const prefix = field(block, 345, 155);
    const name = field(block, 0, 100);
    let path = longName ?? pending?.get('path') ?? (prefix ? `${prefix}/${name}` : name);
    let linkTarget = longLink ?? pending?.get('linkpath') ?? field(block, 157, 100);
    const mtime = pending?.has('mtime') ? Math.floor(Number(pending.get('mtime'))) : octal(block, 136, 12);
    const mode = octal(block, 100, 8) & 0o7777;
    pending = null;
    longName = null;
    longLink = null;

    const isDir = typeflag === '5' || (typeflag === '\0' && path.endsWith('/'));
    path = clean(path);
    if (path === '' || path === 'pax_global_header') continue;

    if (isDir) {
      entries.push({ path, type: 'dir', mode, mtime, data: new Uint8Array(0) });
    } else if (typeflag === '2') {
      entries.push({ path, type: 'symlink', mode, mtime, data: new Uint8Array(0), linkTarget });
    } else if (typeflag === '0' || typeflag === '\0' || typeflag === '7') {
      entries.push({ path, type: 'file', mode, mtime, data: data.slice() });
    }
    linkTarget = '';
  }
  return entries;
}

function writeField(block: Uint8Array, at: number, length: number, text: string): void {
  const bytes = encoder.encode(text);
  block.set(bytes.subarray(0, length), at);
}

function writeOctal(block: Uint8Array, at: number, length: number, value: number): void {
  writeField(block, at, length, value.toString(8).padStart(length - 1, '0'));
}

const TYPEFLAG: Record<EntryType | 'pax', number> = { file: 0x30, dir: 0x35, symlink: 0x32, pax: 0x78 };

function header(path: string, type: EntryType | 'pax', mode: number, mtime: number, size: number, linkTarget: string): Uint8Array {
  const block = new Uint8Array(BLOCK);
  let name = path;
  let prefix = '';
  if (encoder.encode(path).length > 100) {
    // ustar splits a long path at a slash into prefix (155) and name (100).
    const cut = path.lastIndexOf('/', 100);
    if (cut > 0 && encoder.encode(path.slice(0, cut)).length <= 155 && encoder.encode(path.slice(cut + 1)).length <= 100) {
      prefix = path.slice(0, cut);
      name = path.slice(cut + 1);
    } else {
      name = path.slice(0, 100); // the pax header before this one carries the real path
    }
  }
  writeField(block, 0, 100, name);
  writeOctal(block, 100, 8, mode);
  writeOctal(block, 108, 8, 0);
  writeOctal(block, 116, 8, 0);
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, mtime);
  block.fill(0x20, 148, 156);
  block[156] = TYPEFLAG[type];
  writeField(block, 157, 100, linkTarget);
  writeField(block, 257, 6, 'ustar');
  block[262] = 0;
  writeField(block, 263, 2, '00');
  writeField(block, 345, 155, prefix);
  let sum = 0;
  for (const b of block) sum += b;
  writeField(block, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
  return block;
}

function paxHeader(path: string, records: Record<string, string>): Uint8Array[] {
  let body = '';
  for (const [key, value] of Object.entries(records)) {
    // A record is "<length> key=value\n" where length counts its own digits.
    const record = ` ${key}=${value}\n`;
    const n = encoder.encode(record).length;
    let length = n + String(n).length;
    if (String(length).length > String(n).length) length++;
    body += `${length}${record}`;
  }
  const data = encoder.encode(body);
  const name = `./PaxHeaders/${path}`.slice(0, 100);
  return [header(name, 'pax', 0o644, 0, data.length, ''), padded(data)];
}

function padded(data: Uint8Array): Uint8Array {
  const length = Math.ceil(data.length / BLOCK) * BLOCK;
  if (length === data.length) return data;
  const out = new Uint8Array(length);
  out.set(data);
  return out;
}

/** The archive for these entries, ustar with a pax extended header wherever a
 *  path or link target does not fit. Entries are written in the order given;
 *  callers put a directory before its contents. */
export function writeTar(entries: readonly Entry[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    const path = e.type === 'dir' ? `${e.path}/` : e.path;
    const link = e.linkTarget ?? '';
    const records: Record<string, string> = {};
    if (encoder.encode(path).length > 100 && !ustarSplits(path)) records['path'] = path;
    if (encoder.encode(link).length > 100) records['linkpath'] = link;
    if (Object.keys(records).length > 0) parts.push(...paxHeader(e.path, records));
    parts.push(header(path, e.type, e.mode, e.mtime, e.type === 'file' ? e.data.length : 0, link));
    if (e.type === 'file') parts.push(padded(e.data));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function ustarSplits(path: string): boolean {
  const cut = path.lastIndexOf('/', 100);
  return cut > 0 && encoder.encode(path.slice(0, cut)).length <= 155 && encoder.encode(path.slice(cut + 1)).length <= 100;
}
