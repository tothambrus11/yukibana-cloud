/**
 * Widget 1: a C++ function and what clang makes of it, side by side. The
 * reader edits the source, picks the optimisation level (C++'s level
 * property, a line of compile_flags.txt) and the view (assembly or LLVM
 * IR, the views lang-cpp declares), and points at a line on either side to
 * see its counterpart; a click on an output line shows its source line.
 */
import { pathOf, readProperty, type EditorPort } from '@yukibana/core';
import { viewKind, type ViewKind } from '@yukibana/std';
import { useRef, useState, type ReactNode } from 'react';
import { CodeEditor } from '../components/CodeEditor.tsx';
import { ActionButton, RunStatus, Segmented } from '../components/Controls.tsx';
import { ExploreOutput } from '../components/ExploreOutput.tsx';
import { LevelPicker } from '../components/LevelPicker.tsx';
import { RunOutput } from '../components/OutputView.tsx';
import { useExplore } from '../yukibana/useExplore.ts';
import { useNearScreen } from '../yukibana/useNearScreen.ts';
import { useInstance } from '../yukibana/useInstance.ts';
import { useLinkedLines } from '../yukibana/useLinkedLines.ts';
import { useProject, useSnapshot } from '../yukibana/useProject.ts';
import { useRun } from '../yukibana/useRun.ts';
import { CPP } from './languages.ts';
import { CPP_LEVEL_SETTING } from './settings.ts';

const LANGUAGES = [CPP];
const MAIN = pathOf('main.cpp');

const SOURCE = `#include <cstdio>

// The sum of the first n squares, the slow way.
unsigned sum_of_squares(unsigned n) {
    unsigned total = 0;
    for (unsigned i = 1; i <= n; ++i)
        total += i * i;
    return total;
}

int main() {
    std::printf("sum of squares 1..100 = %u\\n", sum_of_squares(100));
}
`;

/** The widget, as the module describes it. */
export function ExploreWidget(): ReactNode {
	const yukibana = useInstance(LANGUAGES);
	const project = useProject({ 'main.cpp': SOURCE, 'compile_flags.txt': '-std=c++20\n-O0\n' });
	const views = CPP.explorer?.views.views ?? [];
	const [kind, setKind] = useState<ViewKind>(views.find((v) => v.kind === 'asm')?.kind ?? viewKind('asm'));
	const [toggles, setToggles] = useState<Readonly<Record<string, Readonly<Record<string, boolean>>>>>({});
	const figure = useRef<HTMLElement | null>(null);
	const near = useNearScreen(figure);
	const explore = useExplore(yukibana, CPP, project, { kind, path: MAIN, toggles: toggles[kind] ?? {}, enabled: near });
	const linked = useLinkedLines(explore.result, MAIN);
	const run = useRun(yukibana, CPP, project, { snippet: 'explore-cpp' });
	const port = useRef<EditorPort<'monaco'> | null>(null);
	const snapshot = useSnapshot(project);
	const level = readProperty(snapshot, CPP_LEVEL_SETTING.property);
	const unoptimized = explore.result?.kind === 'output' ? explore.result.unoptimized.filter((l) => l.file === MAIN).length : 0;

	return (
		<figure className="widget" id="explore" data-widget="explore" ref={figure}>
			<div className="widget-bar">
				<span className="widget-tag">C++ · clang</span>
				<LevelPicker project={project} setting={CPP_LEVEL_SETTING} name="explore-level" />
				<Segmented label="View" name="explore-view" choices={views.map((v) => ({ value: v.kind, label: v.title, title: `The ${v.noun}` }))} value={kind} onChange={setKind} />
			</div>
			<div className="split">
				<div className="pane">
					<div className="pane-title">
						main.cpp <span className="muted">{level.kind === 'value' ? level.value : level.kind === 'default' ? `${CPP_LEVEL_SETTING.property.default} (default)` : level.raw}</span>
					</div>
					<CodeEditor
						project={project}
						path={MAIN}
						id="explore-cpp"
						language={CPP.monaco}
						label="C++ source: main.cpp"
						bands={linked.bands}
						emphasised={linked.source}
						onHoverLine={linked.hoverSource}
						onPort={(made) => (port.current = made)}
					/>
				</div>
				<div className="pane">
					<ExploreOutput
						state={explore}
						toggles={toggles[kind] ?? {}}
						onToggle={(key, on) => setToggles((t) => ({ ...t, [kind]: { ...t[kind], [key]: on } }))}
						bandOf={linked.bandOf}
						emphasised={linked.output}
						onHover={linked.hoverOutput}
						onPick={(index) => {
							const line = linked.sourceOf(index);
							if (line !== null) port.current?.reveal(line, 1);
						}}
					/>
				</div>
			</div>
			<figcaption className="widget-foot">
				<ActionButton availability={run.availability} onClick={run.run} busy={run.busy} name="run">
					Run
				</ActionButton>
				<RunStatus state={run.state} />
				{unoptimized > 0 ? <span className="note">{unoptimized} source line{unoptimized === 1 ? '' : 's'} with code at -O0 left none here.</span> : null}
			</figcaption>
			{run.output.length > 0 ? <RunOutput output={run.output} empty="" label="C++ program output" /> : null}
		</figure>
	);
}
