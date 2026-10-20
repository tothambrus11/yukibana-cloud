/** The line diff the merge and diff editors use for an update's files: the
 *  CLI's, not Monaco's.
 *
 *  Theia's merge editor finds its change blocks with whatever `DiffComputer`
 *  is bound, Monaco's by default. The pre-merged result comes from
 *  `planUpdate`, which uses `diffLines` from `@yukibana/cli`. Where the two
 *  diffs place a change differently (Monaco's reads a function appended
 *  after a like-ending one as inserted before its last lines), the editor
 *  draws one big conflict around a teacher change that was already applied
 *  cleanly. So for `yukibana-update:` documents the blocks come from the
 *  same diff that made the result, and `yukibana update` in a terminal
 *  draws its conflict markers in the same places. Every other diff in the
 *  IDE stays Monaco's.
 *
 *  Word-level highlights within a changed block are a diff of the block's
 *  words with the same function.
 */

import { inject, injectable } from '@theia/core/shared/inversify';
import type { URI } from '@theia/core';
import type { DetailedLineRangeMapping, Diff, DiffComputer, DiffComputerOptions, RangeMapping } from '@theia/core/lib/common/diff';
import { MonacoDiffComputer } from '@theia/monaco/lib/browser/monaco-diff-computer';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { diffLines } from '@yukibana/cli/diff3';
import { UPDATE_SCHEME } from './update-resource';

@injectable()
export class UpdateDiffComputer implements DiffComputer {
  @inject(MonacoDiffComputer) protected readonly monaco!: MonacoDiffComputer;
  @inject(MonacoTextModelService) protected readonly models!: MonacoTextModelService;

  async computeDiff(left: URI, right: URI, _options?: DiffComputerOptions): Promise<Diff | undefined> {
    if (left.scheme !== UPDATE_SCHEME || right.scheme !== UPDATE_SCHEME) return this.monaco.computeDiff(left, right);
    const a = this.models.get(left.toString())?.textEditorModel.getLinesContent();
    const b = this.models.get(right.toString())?.textEditorModel.getLinesContent();
    if (a === undefined || b === undefined) return this.monaco.computeDiff(left, right);
    return { changes: lineDiff(a, b) };
  }
}

/** Monaco hands lines without their terminators, which is what the merge
 *  editor compares too; `diffLines` does not care either way. */
export function lineDiff(a: readonly string[], b: readonly string[]): DetailedLineRangeMapping[] {
  return diffLines(a, b).map((h) => ({
    left: { start: h.aStart, end: h.aEnd },
    right: { start: h.bStart, end: h.bEnd },
    innerChanges: wordChanges(a, h.aStart, h.aEnd, b, h.bStart, h.bEnd),
  }));
}

const TOKEN = /\w+|\s+|[^\w\s]/g;

/** The words that differ inside one changed block, as ranges in each
 *  document (zero-based lines and columns). An insertion or deletion of
 *  whole lines has no inner changes worth drawing. */
function wordChanges(a: readonly string[], aStart: number, aEnd: number, b: readonly string[], bStart: number, bEnd: number): RangeMapping[] {
  if (aStart === aEnd || bStart === bEnd) return [];
  const left = tokens(a, aStart, aEnd);
  const right = tokens(b, bStart, bEnd);
  return diffLines(left.map((t) => t.text), right.map((t) => t.text)).map((h) => ({
    left: span(left, h.aStart, h.aEnd, aEnd),
    right: span(right, h.bStart, h.bEnd, bEnd),
  }));
}

interface Token {
  readonly text: string;
  readonly line: number;
  readonly col: number;
}

/** The block's tokens, line breaks included as tokens of their own so a
 *  word diff cannot join two lines' words. */
function tokens(lines: readonly string[], start: number, end: number): Token[] {
  const out: Token[] = [];
  for (let line = start; line < end; line++) {
    for (const m of (lines[line] ?? '').matchAll(TOKEN)) out.push({ text: m[0], line, col: m.index });
    out.push({ text: '\n', line, col: (lines[line] ?? '').length });
  }
  return out;
}

/** The range from token `from` up to token `to` (exclusive). An empty
 *  span sits where token `from` starts. */
function span(ts: readonly Token[], from: number, to: number, endLine: number) {
  const start = ts[from] ?? { line: endLine, col: 0 };
  const last = ts[to - 1];
  const end =
    last === undefined || to === from ? start : last.text === '\n' ? { line: last.line + 1, col: 0 } : { line: last.line, col: last.col + last.text.length };
  return { start: { line: start.line, character: start.col }, end: { line: end.line, character: end.col } };
}
