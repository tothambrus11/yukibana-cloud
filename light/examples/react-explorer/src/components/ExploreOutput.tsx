/**
 * One compiler output view as a widget shows it: a header with the view's
 * toggles and what the compile took, the lines coloured by source line,
 * and the compiler's messages when it failed.
 */
import type { ExploreView } from '@yukibana/std';
import type { ReactNode } from 'react';
import { instructionCount } from '../yukibana/mapping.ts';
import type { ExploreState } from '../yukibana/useExplore.ts';
import { ExploreMessage, OutputLines } from './OutputView.tsx';

/** What `ExploreOutput` shows and reports. */
export interface ExploreOutputProps {
	/** The view's state (`useExplore`). */
	readonly state: ExploreState;
	/** The view's toggles as set, by key. */
	readonly toggles: Readonly<Record<string, boolean>>;
	/** Called when a toggle is flipped. */
	readonly onToggle: (key: string, on: boolean) => void;
	/** Per output line, its band, or null. */
	readonly bandOf: (index: number) => number | null;
	/** Output lines to emphasise. */
	readonly emphasised: ReadonlySet<number>;
	/** Called with the output line under the pointer. */
	readonly onHover: (index: number | null) => void;
	/** Called with the output line clicked. */
	readonly onPick: (index: number) => void;
}

/** The toggles a view offers on the answer's target: x86-only ones only on x86 output. */
function offered(view: ExploreView, target: string): ExploreView['toggles'] {
	return view.toggles.filter((t) => t.offered === 'always' || /x86/.test(target));
}

/** One view's output, as `ExploreOutputProps` describe. */
export function ExploreOutput({ state, toggles, onToggle, bandOf, emphasised, onHover, onPick }: ExploreOutputProps): ReactNode {
	const { view, result, pending, progress, problem } = state;
	if (problem !== null || view === null) return <div className="explore-message">{problem}</div>;
	const target = result?.kind === 'output' ? result.target : '';
	return (
		<div className="explore" data-view={view.kind} data-pending={pending ? true : undefined} data-result={result?.kind ?? 'none'}>
			<div className="explore-head">
				<div className="toggles" role="group" aria-label={`${view.title} options`}>
					{offered(view, target).map((t) => (
						<label key={t.key} className="toggle" title={t.does}>
							<input type="checkbox" checked={toggles[t.key] ?? t.on} onChange={(event) => onToggle(t.key, event.currentTarget.checked)} />
							{t.label}
						</label>
					))}
				</div>
				<div className="explore-meta">
					{pending ? <span className="spinner" aria-label="Compiling" /> : null}
					{progress !== null ? <span>Loading {progress.label}{progress.total > 0 ? ` ${Math.round((progress.loaded / progress.total) * 100)}%` : '…'}</span> : null}
					{result?.kind === 'output' ? (
						<span title={result.flags.join(' ')}>
							{result.target} · {instructionCount(result.text)} instructions · {Math.round(result.ms)} ms
						</span>
					) : null}
				</div>
			</div>
			{result === null ? (
				<div className="explore-message waiting">{pending ? `Compiling to ${view.noun}…` : `The ${view.noun} appears here.`}</div>
			) : result.kind === 'output' ? (
				<OutputLines text={result.text} bandOf={bandOf} emphasised={emphasised} onHover={onHover} onPick={onPick} label={`${view.title} of the source`} />
			) : (
				<ExploreMessage result={result} />
			)}
		</div>
	);
}
