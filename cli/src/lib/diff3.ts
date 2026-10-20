/** Line diffs and the three-way merge an update offers the student.
 *
 *  An update has three versions of an editable file: the starter of the
 *  release the folder started from (the base), the student's file (mine) and
 *  the newest release's starter (theirs). `merge3` cuts the file into
 *  chunks: stretches nobody changed, changes only one side made (taken as
 *  they are), changes both made identically, and conflicts, where both
 *  changed the same lines differently. The IDE's merge view starts from
 *  `render(merge, 'base')`, which applies every change that does not clash
 *  and leaves each conflict as the base had it for the student to decide;
 *  `yukibana update` writes `render(merge, 'markers')`, which is what git
 *  users expect. Both come from this one implementation so the terminal and
 *  the IDE offer the same result.
 *
 *  Pure: strings in, chunks out. Lines keep their line endings, so a file
 *  that is merged without conflicts comes back byte for byte, a missing final
 *  newline and `\r\n` included.
 */

/** One region where `b` differs from `a`: lines `[aStart, aEnd)` of `a` are
 *  replaced by lines `[bStart, bEnd)` of `b`. An insertion has
 *  `aStart === aEnd`, a deletion `bStart === bEnd`. */
export interface Hunk {
  readonly aStart: number;
  readonly aEnd: number;
  readonly bStart: number;
  readonly bEnd: number;
}

/** A file as lines, each with its own terminator (the last may have none).
 *  `''` is no lines at all, not one empty line. */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** The hunks that turn `a` into `b`, in order, never overlapping or
 *  touching. Myers' O(ND) diff over whole lines, after the common prefix is
 *  set aside. Of the equally short diffs it picks the one that keeps lines
 *  as early as it can, so an insertion lands after the lines it repeats.
 *  The common suffix is not trimmed for the same reason: a teacher who
 *  appends a function ending in `    todo!()\n}\n` after one that ends the
 *  same way would read, from the end, as having inserted it before the old
 *  function's last lines. */
export function diffLines(a: readonly string[], b: readonly string[]): Hunk[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  const n = a.length - pre;
  const m = b.length - pre;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0) return [{ aStart: pre, aEnd: pre + n, bStart: pre, bEnd: pre + m }];

  // The furthest x reached on each diagonal k = x - y, for each number of
  // edits d; kept per d so the path can be walked back.
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  const at = (i: number) => a[pre + i];
  const bt = (j: number) => b[pre + j];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && at(x) === bt(y)) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }

  // Walk back from (n, m), collecting which lines of a and b were kept.
  const keptA = new Uint8Array(n);
  const keptB = new Uint8Array(m);
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const vd = trace[d] as Int32Array;
    const k = x - y;
    const down = k === -d || (k !== d && (vd[offset + k - 1] ?? 0) < (vd[offset + k + 1] ?? 0));
    const prevK = down ? k + 1 : k - 1;
    const prevX = vd[offset + prevK] ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      keptA[x] = 1;
      keptB[y] = 1;
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    keptA[x] = 1;
    keptB[y] = 1;
  }

  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && keptA[i] === 1 && keptB[j] === 1) {
      i++;
      j++;
      continue;
    }
    const aStart = i;
    const bStart = j;
    while (i < n && keptA[i] !== 1) i++;
    while (j < m && keptB[j] !== 1) j++;
    hunks.push({ aStart: pre + aStart, aEnd: pre + i, bStart: pre + bStart, bEnd: pre + j });
  }
  return slideDown(hunks, a, b);
}

/** Moves each pure insertion or deletion as far down as it can go while
 *  meaning the same, as git does, for the cases the search above still
 *  places early. Read too early, an inserted function touches whatever
 *  changed just above it, and a merge calls that a conflict. */
function slideDown(hunks: Hunk[], a: readonly string[], b: readonly string[]): Hunk[] {
  for (let k = 0; k < hunks.length; k++) {
    let h = hunks[k] as Hunk;
    const next = hunks[k + 1];
    const limitA = next?.aStart ?? a.length;
    if (h.aStart === h.aEnd) {
      while (h.aEnd < limitA && h.bEnd < b.length && b[h.bStart] === b[h.bEnd]) {
        h = { aStart: h.aStart + 1, aEnd: h.aEnd + 1, bStart: h.bStart + 1, bEnd: h.bEnd + 1 };
      }
    } else if (h.bStart === h.bEnd) {
      while (h.aEnd < limitA && a[h.aStart] === a[h.aEnd]) {
        h = { aStart: h.aStart + 1, aEnd: h.aEnd + 1, bStart: h.bStart + 1, bEnd: h.bEnd + 1 };
      }
    }
    hunks[k] = h;
  }
  return hunks;
}

/** A stretch of the merged file. `base`, `mine` and `theirs` are that
 *  stretch's lines in each version.
 *
 *  * `same`: nobody changed it.
 *  * `mine`: only the student changed it; the result keeps their lines.
 *  * `theirs`: only the teacher changed it; the result takes the teacher's.
 *  * `both`: both made the same change.
 *  * `conflict`: both changed it, differently. Nothing decides it but a
 *    person. */
export type Chunk =
  | { readonly kind: 'same'; readonly base: readonly string[] }
  | { readonly kind: 'mine' | 'theirs' | 'both' | 'conflict'; readonly base: readonly string[]; readonly mine: readonly string[]; readonly theirs: readonly string[] };

export interface Merge {
  readonly chunks: readonly Chunk[];
  /** How many teacher changes the merge offers: chunks the teacher's side
   *  touched (`theirs`, `both` and `conflict`). What the update widget
   *  counts as "changes". */
  readonly changes: number;
  /** How many of those clash with the student's own edits. */
  readonly conflicts: number;
}

/** Merges the student's and the teacher's edits of `base`.
 *
 *  Changes from the two sides that overlap in the base, or that insert at
 *  the same place, or where one inserts right at the edge of the other's
 *  change, are one chunk: their order cannot be decided by position. Two
 *  changes on adjacent but distinct lines are separate and both apply, as in
 *  git and in VS Code's merge editor. */
export function merge3(base: string, mine: string, theirs: string): Merge {
  const b = splitLines(base);
  const m = splitLines(mine);
  const t = splitLines(theirs);
  const tagged = [
    ...diffLines(b, m).map((h) => ({ h, side: 0 as const })),
    ...diffLines(b, t).map((h) => ({ h, side: 1 as const })),
  ].toSorted((p, q) => p.h.aStart - q.h.aStart || p.h.aEnd - q.h.aEnd);

  const chunks: Chunk[] = [];
  // How far each side's lines are shifted from the base's by the hunks
  // already passed.
  const delta = [0, 0];
  let pos = 0;
  let changes = 0;
  let conflicts = 0;
  let next = 0;
  while (next < tagged.length) {
    const first = tagged[next] as (typeof tagged)[number];
    const lo = first.h.aStart;
    let hi = first.h.aEnd;
    const group = [first];
    next++;
    for (; next < tagged.length; next++) {
      const c = tagged[next] as (typeof tagged)[number];
      // One side's hunks never touch each other, so a hunk that starts
      // where the group ends is the other side's.
      const insertion = (h: Hunk) => h.aStart === h.aEnd;
      const touches = c.h.aStart === hi && (insertion(c.h) || group.some((g) => insertion(g.h) && g.h.aEnd === hi));
      if (c.h.aStart < hi || touches) {
        group.push(c);
        hi = Math.max(hi, c.h.aEnd);
      } else {
        break;
      }
    }
    if (pos < lo) chunks.push({ kind: 'same', base: b.slice(pos, lo) });

    const sideLines = (side: 0 | 1, lines: readonly string[]): string[] => {
      const start = lo + (delta[side] ?? 0);
      let shift = delta[side] ?? 0;
      for (const g of group) if (g.side === side) shift += g.h.bEnd - g.h.bStart - (g.h.aEnd - g.h.aStart);
      delta[side] = shift;
      return lines.slice(start, hi + shift);
    };
    const touched = [group.some((g) => g.side === 0), group.some((g) => g.side === 1)];
    const baseLines = b.slice(lo, hi);
    const mineLines = sideLines(0, m);
    const theirLines = sideLines(1, t);
    let kind: 'mine' | 'theirs' | 'both' | 'conflict';
    if (!touched[1]) kind = 'mine';
    else if (!touched[0]) kind = 'theirs';
    else kind = sameLines(mineLines, theirLines) ? 'both' : 'conflict';
    if (kind !== 'mine') changes++;
    if (kind === 'conflict') conflicts++;
    chunks.push({ kind, base: baseLines, mine: mineLines, theirs: theirLines });
    pos = hi;
  }
  if (pos < b.length) chunks.push({ kind: 'same', base: b.slice(pos) });
  return { chunks, changes, conflicts };
}

/** Labels for conflict markers: what `<<<<<<<` and `>>>>>>>` name. */
export interface MarkerLabels {
  readonly mine: string;
  readonly base: string;
  readonly theirs: string;
}

/** The merged file. Every chunk that is not a conflict is resolved as
 *  `merge3` says; conflicts are written as `conflicts` asks:
 *
 *  * `base`: as the base had them, so the file is the student's with every
 *    clean teacher change applied and each clash still to decide. The IDE's
 *    merge view starts here: it shows a conflict as unhandled exactly when
 *    the result there is still the base's.
 *  * `mine`: as the student had them, for `--keep-mine`.
 *  * `markers`: git's diff3 style, with the base between `|||||||` and
 *    `=======`, so a conflict says what both sides started from. */
export function render(merge: Merge, conflicts: 'base' | 'mine' | 'markers', labels: MarkerLabels = { mine: 'yours', base: 'base', theirs: 'teacher' }): string {
  let out = '';
  for (const c of merge.chunks) {
    if (c.kind === 'same') out += c.base.join('');
    else if (c.kind === 'mine') out += c.mine.join('');
    else if (c.kind === 'theirs' || c.kind === 'both') out += c.theirs.join('');
    else if (conflicts === 'base') out += c.base.join('');
    else if (conflicts === 'mine') out += c.mine.join('');
    else {
      out += `<<<<<<< ${labels.mine}\n${terminated(c.mine)}||||||| ${labels.base}\n${terminated(c.base)}=======\n${terminated(c.theirs)}>>>>>>> ${labels.theirs}\n`;
    }
  }
  return out;
}

/** Lines as text that ends in a newline, so a marker after them starts on a
 *  line of its own even when the side's last line had no terminator. */
function terminated(lines: readonly string[]): string {
  const s = lines.join('');
  return s === '' || s.endsWith('\n') ? s : s + '\n';
}

function sameLines(p: readonly string[], q: readonly string[]): boolean {
  return p.length === q.length && p.every((l, i) => l === q[i]);
}
