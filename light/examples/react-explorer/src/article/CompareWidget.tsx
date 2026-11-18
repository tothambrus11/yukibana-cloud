/**
 * Widget 2: one algorithm in five languages, one tab each, and a
 * scoreboard across them. Each tab runs its program and shows what its
 * compiler makes of it in the views its package declares (Rust's MIR, LLVM
 * IR and assembly; Swift's SIL; Python's bytecode); JavaScript has none,
 * which the instance says (`has(explore)` is false) and the tab says too.
 * All five languages are one instance's, sharing the page's host with the
 * other widgets.
 */
import { pathOf, type Path, type ProjectSnapshot } from '@yukibana/core';
import { explore, viewKind, type ViewKind } from '@yukibana/std';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CodeEditor } from '../components/CodeEditor.tsx';
import { ActionButton, RunStatus, Segmented } from '../components/Controls.tsx';
import { ExploreOutput } from '../components/ExploreOutput.tsx';
import { LevelPicker } from '../components/LevelPicker.tsx';
import { RunOutput } from '../components/OutputView.tsx';
import type { LanguageDef } from '../yukibana/language.ts';
import { instructionCount } from '../yukibana/mapping.ts';
import { useExplore } from '../yukibana/useExplore.ts';
import { useNearScreen } from '../yukibana/useNearScreen.ts';
import { useInstance, type Yukibana } from '../yukibana/useInstance.ts';
import { useLinkedLines } from '../yukibana/useLinkedLines.ts';
import { useProject } from '../yukibana/useProject.ts';
import { levelOptions } from '../yukibana/useProperty.ts';
import { useRun } from '../yukibana/useRun.ts';
import { CPP, JAVASCRIPT, PYTHON, RUST, SWIFT } from './languages.ts';
import { CPP_LEVEL_SETTING, RUST_LEVEL_SETTING, SWIFT_LEVEL_SETTING, type LevelSetting } from './settings.ts';

/** One tab: a language, its program, the file shown, its level, and the view it opens on. */
interface Entry {
	readonly def: LanguageDef;
	readonly files: Readonly<Record<string, string>>;
	readonly path: Path;
	readonly level: LevelSetting | null;
	readonly view: string;
	/** What the tab says about how the language is compiled, under its title. */
	readonly blurb: string;
}

const ENTRIES: readonly Entry[] = [
	{
		def: CPP,
		path: pathOf('main.cpp'),
		level: CPP_LEVEL_SETTING,
		view: 'asm',
		blurb: 'clang, ahead of time, to WebAssembly.',
		files: {
			'compile_flags.txt': '-std=c++20\n',
			'main.cpp': `#include <cstdio>

unsigned sum_of_squares(unsigned n) {
    unsigned total = 0;
    for (unsigned i = 1; i <= n; ++i)
        total += i * i;
    return total;
}

int main() {
    std::printf("sum of squares 1..100 = %u\\n", sum_of_squares(100));
}
`,
		},
	},
	{
		def: RUST,
		path: pathOf('src/main.rs'),
		level: RUST_LEVEL_SETTING,
		view: 'asm',
		blurb: 'rustc through MIR and LLVM, ahead of time, to WebAssembly.',
		files: {
			'Cargo.toml': '[package]\nname = "squares"\nversion = "0.1.0"\nedition = "2021"\n',
			'src/main.rs': `fn sum_of_squares(n: u32) -> u32 {
    let mut total = 0;
    for i in 1..=n {
        total += i * i;
    }
    total
}

fn main() {
    println!("sum of squares 1..100 = {}", sum_of_squares(100));
}
`,
		},
	},
	{
		def: SWIFT,
		path: pathOf('main.swift'),
		level: SWIFT_LEVEL_SETTING,
		view: 'asm',
		blurb: 'swift-frontend through SIL and LLVM, ahead of time, to WebAssembly.',
		files: {
			'main.swift': `func sumOfSquares(_ n: UInt32) -> UInt32 {
    var total: UInt32 = 0
    for i in 1...n {
        total += i * i
    }
    return total
}

print("sum of squares 1..100 = \\(sumOfSquares(100))")
`,
		},
	},
	{
		def: PYTHON,
		path: pathOf('main.py'),
		level: null,
		view: 'bytecode',
		blurb: 'CPython compiles to bytecode, then interprets it.',
		files: {
			'main.py': `def sum_of_squares(n):
    total = 0
    for i in range(1, n + 1):
        total += i * i
    return total


print(f"sum of squares 1..100 = {sum_of_squares(100)}")
`,
		},
	},
	{
		def: JAVASCRIPT,
		path: pathOf('main.js'),
		level: null,
		view: '',
		blurb: 'Compiled by the engine while it runs, out of sight.',
		files: {
			'main.js': `function sumOfSquares(n) {
    let total = 0;
    for (let i = 1; i <= n; i++) total += i * i;
    return total;
}

console.log(\`sum of squares 1..100 = \${sumOfSquares(100)}\`);
`,
		},
	},
];

const LANGUAGES = ENTRIES.map((e) => e.def);

/** The kind a tab without views asks for; never asked, since such a tab's explorer is disabled. */
const NO_VIEW: ViewKind = viewKind('none');

/** What a tab tells the scoreboard. */
interface Report {
	/** The program's first line of output, or null before it ran. */
	readonly printed: string | null;
	/** The run's status in a word. */
	readonly status: 'idle' | 'busy' | 'ok' | 'failed';
	/** The current view's instruction count and compile time, or null. */
	readonly compiled: { readonly view: string; readonly instructions: number; readonly ms: number } | null;
	/** Why the language cannot run or compile here, or null. */
	readonly missing: string | null;
}

/** One language's tab, as the module describes it; `onReport` hears what the scoreboard shows. */
function LanguagePanel({ yukibana, entry, hidden, near, onReport }: { readonly yukibana: Yukibana; readonly entry: Entry; readonly hidden: boolean; readonly near: boolean; readonly onReport: (report: Report) => void }): ReactNode {
	const { def, path, level } = entry;
	const project = useProject(entry.files);
	const views = def.explorer?.views.views ?? [];
	const [kind, setKind] = useState<ViewKind | null>(views.find((v) => v.kind === entry.view)?.kind ?? views[0]?.kind ?? null);
	const [toggles, setToggles] = useState<Readonly<Record<string, boolean>>>({});
	const options = (snapshot: ProjectSnapshot) => levelOptions(snapshot, level?.property ?? null);
	const run = useRun(yukibana, def, project, { snippet: `compare-${def.language.key}`, options });
	const state = useExplore(yukibana, def, project, { kind: kind ?? NO_VIEW, path, toggles, options, enabled: kind !== null && !hidden && near });
	const linked = useLinkedLines(state.result, path);
	const hasViews = yukibana.instance.has(def.subject, explore);

	const stdout = run.output.filter((p) => p.kind === 'stdout').map((p) => p.text).join('');
	const printed = stdout === '' ? null : (stdout.split('\n')[0] ?? null);
	const status: Report['status'] = run.busy ? 'busy' : run.state === null ? 'idle' : run.state.kind === 'ended' && run.state.code === 0 ? 'ok' : run.state.kind === 'stopped' ? 'idle' : 'failed';
	const result = state.result;
	const compiled = result?.kind === 'output' && kind !== null ? { view: state.view?.short ?? kind, instructions: instructionCount(result.text), ms: Math.round(result.ms) } : null;
	const missing = run.state?.kind === 'unavailable' ? run.state.problem.reason : result?.kind === 'broken' ? result.error : null;
	const key = JSON.stringify({ printed, status, compiled, missing });
	// The same object while what it says is the same, so the scoreboard is told only of changes.
	const report = useMemo<Report>(() => ({ printed, status, compiled, missing }), [key]);
	useEffect(() => onReport(report), [report, onReport]);

	return (
		<div className="tab-panel" role="tabpanel" id={`compare-${def.language.key}`} hidden={hidden} data-language={def.language.key}>
			<p className="tab-blurb">{entry.blurb}</p>
			<div className="split">
				<div className="pane">
					<div className="pane-title">{path}</div>
					<CodeEditor project={project} path={path} id={`compare-${def.language.key}`} language={def.monaco} label={`${def.language.label} source: ${path}`} bands={linked.bands} emphasised={linked.source} onHoverLine={linked.hoverSource} />
					<div className="pane-foot">
						<ActionButton availability={run.availability} onClick={run.run} busy={run.busy} name="run">
							Run
						</ActionButton>
						<RunStatus state={run.state} />
					</div>
					<RunOutput output={run.output} empty={`Run prints what the ${def.language.label} program says.`} label={`${def.language.label} program output`} />
				</div>
				<div className="pane">
					{hasViews && kind !== null ? (
						<>
							<div className="pane-bar">
								<Segmented label="View" name={`compare-view-${def.language.key}`} choices={views.map((v) => ({ value: v.kind, label: v.title, title: `The ${v.noun}` }))} value={kind} onChange={setKind} />
								{level !== null ? <LevelPicker project={project} setting={level} name={`compare-level-${def.language.key}`} /> : null}
							</div>
							<ExploreOutput state={state} toggles={toggles} onToggle={(k, on) => setToggles((t) => ({ ...t, [k]: on }))} bandOf={linked.bandOf} emphasised={linked.output} onHover={linked.hoverOutput} onPick={() => {}} />
						</>
					) : (
						<div className="explore-message no-views" data-result="no-views">
							<strong>No compiler output to show.</strong> {def.language.label} has no compiler output view in Yukibana: {def.language.label === 'JavaScript' ? 'its engine compiles it while it runs, and keeps what it made to itself.' : 'its package declares none.'}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

/** The widget, as the module describes it. */
export function CompareWidget(): ReactNode {
	const yukibana = useInstance(LANGUAGES);
	const figure = useRef<HTMLElement | null>(null);
	const near = useNearScreen(figure);
	const [open, setOpen] = useState(0);
	const [visited, setVisited] = useState<ReadonlySet<number>>(new Set([0]));
	const [reports, setReports] = useState<Readonly<Record<string, Report>>>({});
	const [reporters] = useState(() => new Map(ENTRIES.map((e) => [e.def.language.key, (report: Report) => setReports((r) => ({ ...r, [e.def.language.key]: report }))])));

	return (
		<figure className="widget" id="compare" data-widget="compare" ref={figure}>
			<div className="tabs" role="tablist" aria-label="Languages">
				{ENTRIES.map((entry, index) => (
					<button
						key={entry.def.language.key}
						type="button"
						role="tab"
						aria-selected={index === open}
						aria-controls={`compare-${entry.def.language.key}`}
						className="tab"
						data-language={entry.def.language.key}
						onClick={() => {
							setOpen(index);
							setVisited((v) => new Set([...v, index]));
						}}
					>
						{entry.def.language.label}
					</button>
				))}
			</div>
			{ENTRIES.map((entry, index) =>
				visited.has(index) ? <LanguagePanel key={entry.def.language.key} yukibana={yukibana} entry={entry} hidden={index !== open} near={near} onReport={reporters.get(entry.def.language.key) ?? (() => {})} /> : null,
			)}
			<table className="scoreboard">
				<caption>Across the tabs you have opened</caption>
				<thead>
					<tr>
						<th scope="col">Language</th>
						<th scope="col">Printed</th>
						<th scope="col">Compiled view</th>
					</tr>
				</thead>
				<tbody>
					{ENTRIES.map((entry) => {
						const report = reports[entry.def.language.key];
						return (
							<tr key={entry.def.language.key} data-language={entry.def.language.key}>
								<th scope="row">{entry.def.language.label}</th>
								<td className={`score-${report?.status ?? 'idle'}`}>{report?.missing ?? report?.printed ?? (report?.status === 'busy' ? 'running…' : '—')}</td>
								<td>{report?.compiled ? `${report.compiled.instructions} instructions of ${report.compiled.view}, ${report.compiled.ms} ms` : yukibana.instance.has(entry.def.subject, explore) ? '—' : 'none: compiled at run time'}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</figure>
	);
}
