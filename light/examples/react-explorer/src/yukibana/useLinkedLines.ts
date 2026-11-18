/**
 * `useLinkedLines`: the pointer's place on either side of a source and
 * its compiler output, and what that lights up on the other side.
 */
import type { EmitResult } from '@yukibana/std';
import { useMemo, useState } from 'react';
import { bandsOf, outputOf, sourceOf } from './mapping.ts';

/** What a widget draws from the pointer and an explore answer. */
export interface LinkedLines {
	/** Each source line's colour band (`bandsOf`): the editor's bands. */
	readonly bands: ReadonlyMap<number, number>;
	/** Output line `index`'s band, or null. */
	readonly bandOf: (index: number) => number | null;
	/** Source lines to emphasise. */
	readonly source: ReadonlySet<number>;
	/** Output lines to emphasise. */
	readonly output: ReadonlySet<number>;
	/** The pointer is over source line `line` (or left, null). */
	readonly hoverSource: (line: number | null) => void;
	/** The pointer is over output line `index` (or left, null). */
	readonly hoverOutput: (index: number | null) => void;
	/** The source line output line `index` came from, or null. */
	readonly sourceOf: (index: number) => number | null;
}

const NONE: readonly never[] = [];

/** Returns the links between source `path` and `result`'s output lines, with the pointer's state; nothing is linked until there is output. */
export function useLinkedLines(result: EmitResult | null, path: string): LinkedLines {
	const lines = result?.kind === 'output' ? result.lines : NONE;
	const bands = useMemo(() => bandsOf(lines, path), [lines, path]);
	const [pointer, setPointer] = useState<{ readonly side: 'source' | 'output'; readonly at: number } | null>(null);
	const line = pointer === null ? null : pointer.side === 'source' ? pointer.at : sourceOf(lines, path, pointer.at);
	const output = useMemo(() => outputOf(lines, path, line), [lines, path, line]);
	const source = useMemo(() => new Set(line === null ? [] : [line]), [line]);
	return {
		bands,
		bandOf: (index) => {
			const from = sourceOf(lines, path, index);
			return from === null ? null : (bands.get(from) ?? null);
		},
		source,
		output,
		// Leaving one side clears the pointer only if it was there: Monaco may say the pointer left after it has entered the output.
		hoverSource: (at) => setPointer((now) => (at !== null ? { side: 'source', at } : now?.side === 'source' ? null : now)),
		hoverOutput: (at) => setPointer((now) => (at !== null ? { side: 'output', at } : now?.side === 'output' ? null : now)),
		sourceOf: (index) => sourceOf(lines, path, index),
	};
}
