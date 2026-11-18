/**
 * Widget 3: a C++ program under the debugger. Breakpoints are set in the
 * editor's gutter; Debug builds the program with debug information (std's
 * `debug`, which lang-cpp provides), LLDB attaches through the lldb pack,
 * and Step and Continue drive it; the call stack and the selected frame's
 * variables are React's, read from the debugger.
 */
import { pathOf } from '@yukibana/core';
import { useState, type ReactNode } from 'react';
import { CodeEditor } from '../components/CodeEditor.tsx';
import { ActionButton, RunStatus } from '../components/Controls.tsx';
import { RunOutput } from '../components/OutputView.tsx';
import type { DebugStatus, Variable } from '../yukibana/debugger.ts';
import { useDebug, type DebugControls } from '../yukibana/useDebug.ts';
import { useInstance } from '../yukibana/useInstance.ts';
import { useProject } from '../yukibana/useProject.ts';
import { CPP } from './languages.ts';

const LANGUAGES = [CPP];
const MAIN = pathOf('main.cpp');

const SOURCE = `#include <cstdio>

// Insertion sort: walk each value left into place.
void insertion_sort(int *values, int count) {
    for (int i = 1; i < count; ++i) {
        int key = values[i];
        int j = i - 1;
        while (j >= 0 && values[j] > key) {
            values[j + 1] = values[j];
            --j;
        }
        values[j + 1] = key;
    }
}

int main() {
    int values[] = {5, 2, 9, 1, 7};
    insertion_sort(values, 5);
    for (int v : values) std::printf("%d ", v);
    std::printf("\\n");
}
`;

/** The line the widget starts with a breakpoint on: `int key = values[i];`. */
export const FIRST_BREAKPOINT = 6;

const AVAILABLE = { kind: 'available' } as const;
const NOT_STOPPED = { kind: 'unavailable', reason: 'The program is not stopped.' } as const;

/** The status in a few words, for the pill. */
function said(status: DebugStatus): string {
	switch (status.kind) {
		case 'idle':
			return 'Not debugging';
		case 'starting':
			return `${status.text}…`;
		case 'running':
			return 'Running';
		case 'stopped':
			return `Paused: ${status.reason}${status.description && status.description !== status.reason ? ` (${status.description})` : ''}`;
		case 'ended':
			return status.text;
	}
}

/** One variable, opened to its members on demand. */
function VariableRow({ variable, controls, depth }: { readonly variable: Variable; readonly controls: DebugControls; readonly depth: number }): ReactNode {
	const [open, setOpen] = useState(false);
	const children = controls.view.children[variable.ref];
	return (
		<li className="variable" data-name={variable.name} style={{ paddingInlineStart: `${depth * 14}px` }}>
			<div className="variable-row">
				{variable.ref !== 0 ? (
					<button
						type="button"
						className="twisty"
						aria-expanded={open}
						aria-label={`${open ? 'Close' : 'Open'} ${variable.name}`}
						onClick={() => {
							setOpen(!open);
							if (!open) controls.expand(variable.ref);
						}}
					>
						{open ? '▾' : '▸'}
					</button>
				) : (
					<span className="twisty" />
				)}
				<span className="variable-name">{variable.name}</span>
				<span className="variable-value">{variable.value}</span>
				<span className="variable-type">{variable.type}</span>
			</div>
			{open && children !== undefined ? (
				<ul>
					{children.map((child, index) => (
						<VariableRow key={`${child.name}-${index}`} variable={child} controls={controls} depth={depth + 1} />
					))}
				</ul>
			) : null}
		</li>
	);
}

/** The widget, as the module describes it. */
export function DebugWidget(): ReactNode {
	const yukibana = useInstance(LANGUAGES);
	const project = useProject({ 'main.cpp': SOURCE, 'compile_flags.txt': '-std=c++20\n' });
	const controls = useDebug(yukibana, CPP, project, { snippet: 'debug-cpp', initial: { [MAIN]: [FIRST_BREAKPOINT] } });
	const { view } = controls;
	const stopped = view.status.kind === 'stopped' ? AVAILABLE : NOT_STOPPED;
	const active = view.status.kind === 'starting' || view.status.kind === 'running' || view.status.kind === 'stopped';
	const locals = view.scopes.find((s) => /local/i.test(s.name)) ?? view.scopes[0];
	const variables = locals === undefined ? [] : (view.children[locals.ref] ?? []);

	return (
		<figure className="widget" id="debug" data-widget="debug" data-status={view.status.kind}>
			<div className="widget-bar">
				<span className="widget-tag">C++ · LLDB</span>
				<div className="debug-buttons" role="toolbar" aria-label="Debugger">
					<ActionButton availability={controls.availability} onClick={controls.start} busy={active} name="debug">
						Debug
					</ActionButton>
					<ActionButton availability={stopped} onClick={controls.resume} kind="quiet" name="continue" title="Continue to the next breakpoint">
						Continue
					</ActionButton>
					<ActionButton availability={stopped} onClick={controls.next} kind="quiet" name="next" title="Step over the line">
						Step over
					</ActionButton>
					<ActionButton availability={stopped} onClick={controls.stepIn} kind="quiet" name="step-in" title="Step into the call">
						Step in
					</ActionButton>
					<ActionButton availability={stopped} onClick={controls.stepOut} kind="quiet" name="step-out" title="Run until the function returns">
						Step out
					</ActionButton>
					<ActionButton availability={active ? AVAILABLE : { kind: 'unavailable', reason: 'Nothing is being debugged.' }} onClick={controls.stop} kind="quiet" name="stop">
						Stop
					</ActionButton>
				</div>
				<span className={`pill pill-${view.status.kind}`} role="status" data-debug-status={view.status.kind}>
					{said(view.status)}
				</span>
			</div>
			<div className="split">
				<div className="pane">
					<div className="pane-title">
						main.cpp <span className="muted">click the gutter to set a breakpoint</span>
					</div>
					<CodeEditor
						project={project}
						path={MAIN}
						id="debug-cpp"
						language={CPP.monaco}
						label="C++ source to debug: main.cpp"
						breakpoints={controls.breakpoints[MAIN] ?? []}
						onToggleBreakpoint={(line) => controls.toggle(MAIN, line)}
						stoppedLine={controls.stoppedLine(MAIN)}
					/>
				</div>
				<div className="pane debug-side">
					<section aria-label="Call stack">
						<h4>Call stack</h4>
						{view.frames.length === 0 ? (
							<p className="muted">{view.status.kind === 'stopped' ? 'No frames.' : 'Shown while the program is paused.'}</p>
						) : (
							<ol className="frames">
								{view.frames.map((frame, index) => (
									<li key={frame.id}>
										<button type="button" className={index === view.selected ? 'frame on' : 'frame'} onClick={() => controls.select(index)}>
											<span className="frame-name">{frame.name}</span>
											<span className="frame-where">{frame.path === null ? 'library' : `${frame.path}:${frame.line}`}</span>
										</button>
									</li>
								))}
							</ol>
						)}
					</section>
					<section aria-label="Variables" data-variables>
						<h4>Locals</h4>
						{variables.length === 0 ? (
							<p className="muted">{view.status.kind === 'stopped' ? 'No variables in this frame.' : 'The paused frame’s variables appear here.'}</p>
						) : (
							<ul className="variables">
								{variables.map((variable, index) => (
									<VariableRow key={`${variable.name}-${index}`} variable={variable} controls={controls} depth={0} />
								))}
							</ul>
						)}
					</section>
				</div>
			</div>
			<figcaption className="widget-foot">
				<RunStatus state={controls.run.state} />
			</figcaption>
			<RunOutput output={controls.run.output} empty="The program’s output appears here as it runs." label="Debugged program output" />
			{view.log.length > 0 ? (
				<details className="lldb-log">
					<summary>What LLDB said ({view.log.length})</summary>
					<pre>{view.log.join('\n')}</pre>
				</details>
			) : null}
		</figure>
	);
}
