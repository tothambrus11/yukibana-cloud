/**
 * Widget 4: a C++ program with an off-by-one heap write, run with and
 * without AddressSanitizer. The sanitizers are lang-cpp's `SANITIZERS`
 * property, a `-fsanitize=` line of compile_flags.txt that the C++ runner
 * reads (fetching the sanitizer runtime only then); the report is the
 * runtime's own, on stderr, with its source locations made into links
 * that show the line in the editor.
 */
import { pathOf, type EditorPort } from '@yukibana/core';
import { SANITIZERS } from '@yukibana/lang-cpp/properties';
import type { SanitizerChoice } from '@yukibana/lang-cpp/sanitizers';
import { Fragment, useRef, type ReactNode } from 'react';
import { CodeEditor } from '../components/CodeEditor.tsx';
import { ActionButton, RunStatus, Segmented } from '../components/Controls.tsx';
import { AnsiText } from '../components/OutputView.tsx';
import { stripAnsi } from '../yukibana/ansi.ts';
import { useInstance } from '../yukibana/useInstance.ts';
import { useProject, useSnapshot } from '../yukibana/useProject.ts';
import { useProperty } from '../yukibana/useProperty.ts';
import { useRun } from '../yukibana/useRun.ts';
import { CPP } from './languages.ts';

const LANGUAGES = [CPP];
const MAIN = pathOf('main.cpp');

const SOURCE = `#include <cstdio>
#include <cstdlib>

int main() {
    int *scores = static_cast<int *>(std::malloc(4 * sizeof(int)));
    for (int i = 0; i <= 4; ++i)   // one too many
        scores[i] = i * 10;
    std::printf("last score: %d\\n", scores[4]);
    std::free(scores);
}
`;

/** The picker's settings, as the property's values. */
type Mode = 'off' | 'address' | 'both';
const CHOICES: Readonly<Record<Mode, SanitizerChoice>> = { off: { address: false, undefined: false }, address: { address: true, undefined: false }, both: { address: true, undefined: true } };

function modeOf(choice: SanitizerChoice): Mode {
	return choice.address ? (choice.undefined ? 'both' : 'address') : 'off';
}

/** `text` with every `main.cpp:<line>` made a button that shows that line. */
function linked(text: string, reveal: (line: number) => void): ReactNode {
	return text.split(/(main\.cpp:\d+(?::\d+)?)/).map((part, index) => {
		const match = /^main\.cpp:(\d+)/.exec(part);
		return match === null ? (
			<Fragment key={index}>{part}</Fragment>
		) : (
			<button key={index} type="button" className="source-link" onClick={() => reveal(Number(match[1]))}>
				{part}
			</button>
		);
	});
}

/** The widget, as the module describes it. */
export function SanitizerWidget(): ReactNode {
	const yukibana = useInstance(LANGUAGES);
	// -O0: at -O2 clang forwards the stores to the load and deletes the allocation, and with it the overflow.
	const project = useProject({ 'main.cpp': SOURCE, 'compile_flags.txt': '-std=c++20\n-O0\n' });
	const sanitizers = useProperty(project, SANITIZERS);
	const run = useRun(yukibana, CPP, project, { snippet: 'sanitize-cpp' });
	const flags = useSnapshot(project).file(pathOf('compile_flags.txt')) ?? '';
	const port = useRef<EditorPort<'monaco'> | null>(null);
	const reveal = (line: number): void => port.current?.reveal(line, 1);
	const stderr = run.output.filter((p) => p.kind === 'stderr').map((p) => p.text).join('');
	const stdout = run.output.filter((p) => p.kind !== 'stderr').map((p) => p.text).join('');
	const plain = stripAnsi(stderr);
	const report = /ERROR: AddressSanitizer: ([\w-]+)/.exec(plain);
	const summary = /SUMMARY: .*/.exec(plain)?.[0] ?? null;

	return (
		<figure className="widget" id="sanitize" data-widget="sanitize" data-report={report?.[1] ?? 'none'}>
			<div className="widget-bar">
				<span className="widget-tag">C++ · sanitizers</span>
				<Segmented
					label="Sanitizer"
					name="sanitize-mode"
					choices={[
						{ value: 'off', label: 'Off' },
						{ value: 'address', label: 'AddressSanitizer', title: 'Out-of-bounds reads and writes, use after free, leaks' },
						{ value: 'both', label: 'ASan + UBSan', title: 'And undefined behaviour: overflow, bad shifts, null pointers' },
					]}
					value={modeOf(sanitizers.value)}
					onChange={(mode) => sanitizers.set(CHOICES[mode])}
				/>
				<code className="flags" title="compile_flags.txt, as the runner reads it">
					{flags.trim().split('\n').join(' ')}
				</code>
			</div>
			<div className="split">
				<div className="pane">
					<CodeEditor project={project} path={MAIN} id="sanitize-cpp" language={CPP.monaco} label="C++ source with a heap overflow: main.cpp" onPort={(made) => (port.current = made)} />
					<div className="pane-foot">
						<ActionButton availability={run.availability} onClick={run.run} busy={run.busy} name="run">
							Run
						</ActionButton>
						<RunStatus state={run.state} />
					</div>
				</div>
				<div className="pane">
					{report !== null ? (
						<div className="asan-banner" role="alert">
							<strong>{report[1]}</strong>
							{summary !== null ? <span>{linked(summary.replace(/^SUMMARY: AddressSanitizer: /, ''), reveal)}</span> : null}
						</div>
					) : run.state?.kind === 'ended' && run.state.code === 0 ? (
						<div className="quiet-banner">The program exited normally. Nothing noticed the fifth write.</div>
					) : null}
					<pre className="run-output asan" aria-label="Sanitized program output" aria-live="polite">
						{run.output.length === 0 ? (
							<span className="run-empty">Run it, then run it again with AddressSanitizer.</span>
						) : (
							<>
								{stdout !== '' ? (
									<span className="out-stdout">
										<AnsiText text={stdout} />
									</span>
								) : null}
								{stderr !== '' ? (
									<span className="out-stderr">
										<AnsiText text={stderr} decorate={(text) => linked(text, reveal)} />
									</span>
								) : null}
							</>
						)}
					</pre>
				</div>
			</div>
		</figure>
	);
}
