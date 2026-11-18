/**
 * What the explorer and the runner show: a compiler output view's lines,
 * coloured by the source line each came from, and a run's output.
 */
import type { EmitResult } from '@yukibana/std';
import { memo, type ReactNode } from 'react';
import { ansiSegments } from '../yukibana/ansi.ts';
import type { OutputPiece } from '../yukibana/useRun.ts';

/** One output line split into what it is: a label, a directive, a comment, an instruction and its operands. */
function tokens(line: string): ReactNode {
	const comment = /(\s(?:#|;|\/\/).*)$/.exec(line);
	const body = comment ? line.slice(0, comment.index) : line;
	const tail = comment ? (
		<span key="c" className="t-comment">
			{comment[1]}
		</span>
	) : null;
	const trimmed = body.trimStart();
	const indent = body.slice(0, body.length - trimmed.length);
	if (/^[^\s].*:$/.test(body.trimEnd()) || /^[\w.$@"<>-]+:/.test(trimmed)) return [<span key="l" className="t-label">{body}</span>, tail];
	if (trimmed.startsWith('.')) return [indent, <span key="d" className="t-directive">{trimmed}</span>, tail];
	const match = /^(\S+)(.*)$/.exec(trimmed);
	if (match === null) return [body, tail];
	const operands = (match[2] ?? '').split(/(%[\w.]+|@[\w.$"]+|\$[\w.]+|\b-?\d+\b)/).map((part, i) =>
		i % 2 === 1 ? (
			<span key={i} className={part.startsWith('%') || part.startsWith('$') ? 't-reg' : part.startsWith('@') ? 't-sym' : 't-num'}>
				{part}
			</span>
		) : (
			part
		),
	);
	return [indent, <span key="m" className="t-op">{match[1]}</span>, ...operands, tail];
}

/** What `OutputLines` shows and reports. */
export interface OutputLinesProps {
	/** The answer's text, one line per output line. */
	readonly text: string;
	/** Per output line, its source line's band, or null. */
	readonly bandOf: (index: number) => number | null;
	/** Output lines to emphasise. */
	readonly emphasised: ReadonlySet<number>;
	/** Called with the output line under the pointer, or null when it leaves. */
	readonly onHover: (index: number | null) => void;
	/** Called with the output line clicked. */
	readonly onPick: (index: number) => void;
	/** What a screen reader calls it. */
	readonly label: string;
}

/** A compiler output view's lines, each with its source line's colour band. */
export const OutputLines = memo(function OutputLines({ text, bandOf, emphasised, onHover, onPick, label }: OutputLinesProps): ReactNode {
	const lines = text.replace(/\n$/, '').split('\n');
	return (
		<pre className="asm" aria-label={label} onMouseLeave={() => onHover(null)}>
			{lines.map((line, index) => {
				const band = bandOf(index);
				return (
					<div
						key={index}
						className={`asm-line${band === null ? '' : ` band band-${band}`}${emphasised.has(index) ? ' band-on' : ''}`}
						onMouseEnter={() => onHover(index)}
						onClick={() => onPick(index)}
					>
						<span className="asm-no">{index + 1}</span>
						<span className="asm-text">{tokens(line)}</span>
					</div>
				);
			})}
		</pre>
	);
});

/** A sentence for an answer that has no output: the compiler's messages, the worker's failure. */
export function ExploreMessage({ result }: { readonly result: EmitResult }): ReactNode {
	switch (result.kind) {
		case 'output':
		case 'dropped':
			return null;
		case 'failed':
			return (
				<div className="explore-message failed">
					<strong>The compiler said no.</strong>
					<pre>{result.error}</pre>
				</div>
			);
		case 'broken':
			return (
				<div className="explore-message broken">
					<strong>No compiler here.</strong> {result.error}
				</div>
			);
	}
}

/** A run's output, its streams told apart; `empty` stands in before anything is printed. */
export function RunOutput({ output, empty, label }: { readonly output: readonly OutputPiece[]; readonly empty: string; readonly label: string }): ReactNode {
	return (
		<pre className="run-output" aria-label={label} aria-live="polite">
			{output.length === 0 ? (
				<span className="run-empty">{empty}</span>
			) : (
				output.map((piece, index) => (
					<span key={index} className={`out-${piece.kind}`}>
						<AnsiText text={piece.text} />
					</span>
				))
			)}
		</pre>
	);
}

/**
 * `text` with its terminal colours shown as styles (`ansi-<colour>`,
 * `ansi-bold`) and its escape sequences gone; `decorate` may turn each
 * plain run of text into more (links to source lines).
 */
export function AnsiText({ text, decorate }: { readonly text: string; readonly decorate?: (text: string) => ReactNode }): ReactNode {
	return ansiSegments(text).map((segment, index) => {
		const content = decorate === undefined ? segment.text : decorate(segment.text);
		if (!segment.bold && segment.colour === null) return <span key={index}>{content}</span>;
		return (
			<span key={index} className={[segment.bold ? 'ansi-bold' : '', segment.colour === null ? '' : `ansi-${segment.colour}`].filter(Boolean).join(' ')}>
				{content}
			</span>
		);
	});
}
