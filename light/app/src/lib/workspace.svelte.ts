/**
 * The state of the app: which language is selected, its project's files as
 * Monaco models, the language server's session serving them, and what the panels show
 * (problems, output, download progress). Components read it; only its
 * methods change it.
 */
import { monaco } from './monaco';
import { forgetUndo } from './workspace-edits';
import { type DebugChannel, type LoadingProgress, type PartStatus, type RunMode, type TestSelector } from '@yukibana/protocol';
import { LanguageSession, type LogLevel, type RunHandle, type ServerState } from '@yukibana/runtime';
import { MonacoBinding, toLspPosition } from '@yukibana/monaco';
import { internals } from './monaco-internals';
import { isLanguageId, languageOf, LANGUAGES, type LanguageId } from './languages';
import { Runner } from './run.svelte';
import { Preview } from './preview';
import { severityOf, worstFirst, type Severity } from './severity';
import type { ExportedProject, ExportOptions, OfferedBuild } from './export';
import { chooseTestFramework, detectTestFramework, TESTS_DIR, type TestFramework } from '@yukibana/lang-cpp/tests';
import { targetById, targetOf, type CppTargetId, type TargetChoice } from '@yukibana/lang-cpp/targets';
import { describeSanitizers, sanitizersOf, type SanitizerChoice } from '@yukibana/lang-cpp/sanitizers';
import { CARGO_CONFIG, isMiriTarget, MIRI_TARGETS, RUST_TARGETS, rustTargetOf, type MiriTarget, type RustTarget, type RustTargetChoice } from '@yukibana/lang-rust/targets';
import { cppLevelOf, defaultLevel, levelsOf, type LevelChoice } from './optimization';
import { describeStandard, standardOf, type Standard, type StandardChoice } from '@yukibana/lang-cpp/standards';
import { checksOf, TIDY_FILE, type CheckGlob } from '@yukibana/lang-cpp/tidy';
import type { Explorer } from './explorer.svelte';
import type { CallHierarchy } from './call-hierarchy.svelte';
import type { Debugger } from './debug.svelte';
import { Breakpoints } from './breakpoints.svelte';
import { registerTestLenses } from './test-lens';
import type { SelectionRange } from '@yukibana/protocol';
import { parentOf, pathProblem } from '@yukibana/runtime';
import { pathOf, writeProperty, type Disposable, type Outcome, type Files, type Project as CoreProject, type ProjectChange, type ProjectEdit, type ProjectSnapshot, type Property, type LanguageSubject } from '@yukibana/core';
import {
	DEFAULT_RUN_OPTIONS,
	debugTestCase,
	debugTokenOf,
	explore,
	failureStop,
	findTests,
	preview,
	runOptionsOf,
	test,
	testAt,
	testCase,
	tokenOf,
	warm,
	type DebugMode,
	type FailureStop,
	type FoundTest,
	type PreviewSession,
	type RunInput,
	type RunOptions,
	type ViewKind,
} from '@yukibana/std';
import { appPacks, packOf, runnerSourceOf } from './packs';
import { pageHost, releaseExplorer, subjectOf, viewOf, viewsOf, yukibana } from './yukibana';
import { runnerOptionsOf, settingsOf, type LanguageSettings } from './properties/index.ts';
import { COMPILE_FLAGS, standardSettingOf } from '@yukibana/lang-cpp/properties';
import { linkOf, loadLanguage, loadProject, projectOfLink, sampleProject, saveLanguage, saveProject, tabProject, WORKSPACE, type Project } from './project';
import { holdsProject } from './project-link';

/** The model URI of a project path. */
export function uriOf(path: string): monaco.Uri {
	return monaco.Uri.parse(WORKSPACE.uriOf(path));
}

/**
 * Who wrote a line of the Log panel: the language server (its own messages
 * and what the client says about it), a run's side channel (the guest
 * kernel, timings, a runner that broke the contract), or the app. The panel
 * shows it beside each line, so nothing there reads as the program's own
 * output, which only the terminal shows.
 */
export type LogSource = 'server' | 'run' | 'app';

/**
 * What Download makes of one project as it was when it was prepared
 * (`Workspace.downloadable`): the Download dialog's preview, and the zip.
 */
export interface Downloadable {
	/** The build systems that can build the project, the language's usual one first. */
	readonly builds: readonly OfferedBuild[];
	/** Returns the project as Download zips it with `options`. */
	exported(options: ExportOptions): ExportedProject;
}

/** One line of the Log panel. */
export interface LogLine {
	id: number;
	level: LogLevel;
	source: LogSource;
	text: string;
	time: Date;
}

/**
 * One diagnostic as the problems panel, the explorer and the status bar show
 * it, converted from a Monaco marker once so none of them needs the editor.
 */
export interface Problem {
	/** The project path of the file it is in. */
	path: string;
	/** How bad it is. */
	severity: Severity;
	/** What the language server (or the editor) said, as it said it. */
	message: string;
	/** Who said it, such as "clangd", or null when the marker names nobody. */
	source: string | null;
	/** Where in the file, in Monaco's 1-based lines and columns, end exclusive. */
	range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
}

/** What the workspace asks of the editor area, which owns the tabs. */
export interface EditorHost {
	/** Shows a file in a tab, opening one if needed, and optionally selects a range. */
	open(path: string, selection?: monaco.IRange): void;
	/** Closes a file's tab, if it has one. */
	close(path: string): void;
	/** Closes every tab, before the project is replaced. */
	closeAll(): void;
	/** Brings the terminal panel to the front. */
	showTerminal(): void;
	/** Brings the Log or Problems panel to the front: the status bar's server menu and problem counts. */
	showPanel(id: 'log' | 'problems'): void;
	/** Opens the Preview panel (a web project's page), creating it the first time. */
	showPreview(): void;
	/** Closes the Preview panel, if it is open. */
	hidePreview(): void;
	/**
	 * Opens a compiler output view (LLVM IR, assembly) right of the editors,
	 * or brings it to the front; its panel tells `explorer` it opened.
	 */
	showView(kind: ViewKind): void;
	/** Closes the compiler output views, if open: the language or project changed. */
	hideViews(): void;
	/** Closes one compiler output view, if open: its toggle in the top bar was pressed again. */
	hideView(kind: ViewKind): void;
	/** Opens the Call Hierarchy panel beside Problems, or brings it to the front. */
	showCallHierarchy(): void;
	/** Opens the Debug panel beside Problems, or brings it to the front. */
	showDebug(): void;
}

const SAVE_DELAY_MS = 400;
/**
 * The longest link the URL is given, in characters. Chromium takes 2 MB
 * and Firefox about 1 MB; past this a project is still saved in the
 * browser, but its link is left as it was, and the Log panel says so.
 */
const MAX_LINK = 1_000_000;
const MAX_LOG_LINES = 2000;

/**
 * The app's state, and its project as the core sees it (`Project`): the
 * snapshot the providers read, and every change of the project's files and
 * saved settings, which the language server's binding follows.
 */
export class Workspace implements CoreProject {
	language = $state<LanguageId>('python');
	/** File paths, sorted. */
	files = $state<string[]>([]);
	/** Explicit folders (empty ones included), sorted. */
	folders = $state<string[]>([]);
	active = $state<string | null>(null);
	clientState = $state<ServerState>({ kind: 'stopped' });
	progress = $state<LoadingProgress | null>(null);
	log = $state<LogLine[]>([]);
	problems = $state<Problem[]>([]);
	/**
	 * A C++ project's test framework, as its tests/ files include it
	 * (lang-cpp/tests.ts): `mixed` when they include more than one, null when
	 * none (or the project is not C++).
	 */
	testFramework = $state<TestFramework | 'mixed' | null>(null);
	/**
	 * A C or C++ project's target, as its compile_flags.txt says
	 * (lang-cpp/targets.ts); null when the project is neither.
	 */
	target = $state<TargetChoice | null>(null);
	/**
	 * A Rust project's target, as its .cargo/config.toml says
	 * (lang-rust/targets.ts); null when the project is not Rust.
	 */
	rustTarget = $state<RustTargetChoice | null>(null);
	/**
	 * The sanitizers a C or C++ project has on, as its compile_flags.txt
	 * says (lang-cpp/sanitizers.ts); null when the project is not C or C++.
	 */
	sanitizers = $state<SanitizerChoice | null>(null);
	/**
	 * How Run runs a C++ program built for a Linux target; saved with the
	 * project once changed. The defaults for any other project.
	 */
	runOptions = $state<RunOptions>({ ...DEFAULT_RUN_OPTIONS });
	/**
	 * The project's optimisation level (optimization.ts): a C or C++
	 * project's as its compile_flags.txt says, another's as chosen and saved
	 * with the project; null for a language without levels.
	 */
	optimization = $state<LevelChoice | null>(null);
	/**
	 * A C or C++ project's language standard, as its compile_flags.txt says
	 * (lang-cpp/standards.ts); null when the project is neither.
	 */
	standard = $state<StandardChoice | null>(null);
	/**
	 * Whether clang-tidy runs on a C or C++ project, as it was set with the
	 * project (Project.clangTidy): on unless turned off. Its rules are the
	 * project's .clang-tidy (`tidyChecks`) either way.
	 */
	clangTidy = $state(true);
	/**
	 * The target a Rust project's Run and Test interpret it for under Miri,
	 * which checks for undefined behaviour, instead of compiling it
	 * (Project.miri), or null when Miri is off, as it is unless turned on.
	 */
	miri = $state<MiriTarget['id'] | null>(null);
	/**
	 * A C or C++ project's clang-tidy rules: the `Checks` of its .clang-tidy
	 * (lang-cpp/tidy.ts), null when the file has no such key or there is no
	 * file (clangd's own few checks then), and for any other project.
	 */
	tidyChecks = $state<CheckGlob[] | null>(null);
	/**
	 * Where the language server's clang-tidy is, as it last reported it
	 * (`yukibana/status`): null before the first report, and for a server
	 * without one.
	 */
	tidyStatus = $state<PartStatus | null>(null);
	/**
	 * The program run from this project, if any, and the terminal's
	 * contents. The guest kernel's log and the run's timings go to the
	 * Log panel.
	 */
	readonly runner = new Runner(pageHost(), {
		kernel: (line) => this.write('log', `[kernel] ${line}`, 'run'),
		mark: (name, ms) => this.write('log', `timing: ${name} ${(ms / 1000).toFixed(2)} s`, 'run'),
		problem: (text) => this.write('warning', text, 'run'),
	});
	/**
	 * The compiler output views' client (languages with views, modules/lang-<pack>), loaded
	 * with the views the first time one opens: null until then, so the app
	 * shell carries none of it.
	 */
	explorer: Explorer | null = null;
	private explorerLoad: Promise<Explorer> | null = null;
	/**
	 * The compiler output views whose panel is open, as the dock reports it
	 * (`viewsChanged`): the top bar's LLVM IR and Assembly toggles show it as
	 * pressed. Open, not visible: a view behind another tab is still open.
	 */
	viewsOpen = $state<readonly ViewKind[]>([]);
	/** A web project's page, shown in the Preview panel; its console goes to the terminal. */
	readonly preview = new Preview(this.runner, (signal) => this.projectErrors(signal));
	/**
	 * The call hierarchy the Call Hierarchy panel shows: of the function
	 * last asked about (Show Call Hierarchy), null before that and once the
	 * server that answered it has stopped (its items mean nothing to the
	 * next one).
	 */
	callHierarchy = $state.raw<CallHierarchy | null>(null);
	/** The project's breakpoints, set in the editors' margins before and during a session. */
	readonly breakpoints = new Breakpoints();
	/**
	 * The debugger (Debug) and the session the Debug panel shows: null until
	 * Debug is first clicked, when its code loads (`loadDebugger`), then the
	 * same one for the rest of the page's life.
	 */
	debugger = $state.raw<Debugger | null>(null);
	/**
	 * Whether Debug tests stops at each failed assertion: the Debug panel's
	 * "Stop on failed assertion", offered where the language's runner stops
	 * there (std's `failureStop`). The page's, not the project's: it is
	 * not saved.
	 */
	stopOnFailure = $state(false);
	/** True while the first Debug waits for the debugger's code: Debug is not offered twice. */
	private debuggerLoading = $state(false);
	/** The debugger's code, loading or loaded; null before the first Debug and after a load that failed. */
	private debuggerLoad: Promise<Debugger> | null = null;

	/** The selected language's server, while one runs: its session, which the editor's binding (`MonacoBinding`) is the client of. */
	private session: LanguageSession | null = null;
	/** Who `onChange` calls, in the order they subscribed. */
	private readonly changeListeners = new Set<(change: ProjectChange) => void>();
	private readonly models = new Map<string, monaco.editor.ITextModel>();
	private open: string[] = [];
	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private logId = 0;
	private host: EditorHost | null = null;
	/**
	 * Changes on every change to the project's files or saved settings, so
	 * a snapshot (`snapshot`) says which project it answers for. State, so
	 * that what derives from a snapshot follows the project; cheap to follow,
	 * since an availability that does not change re-renders nothing.
	 */
	private revision = $state(0);
	/** Whether the user chose run options for this project: only then are they saved with it. */
	private runOptionsChosen = false;
	/** The level chosen for a language whose level no project file holds (Swift, Scala), saved with the project; null: the default. */
	private chosenLevel: string | null = null;
	/**
	 * Whether the project was changed in this tab since it was loaded: only
	 * then is it saved for the next new tab (`localStorage`), so opening a
	 * link someone shared, or a tab restored with the browser, does not
	 * replace the project a new tab starts from until it is edited. Moving
	 * between tabs is not a change.
	 */
	private changed = false;
	/** Bumped by every write of the URL, so a slower one overtaken by a later one is not written. */
	private linkWrites = 0;
	/** The URL write under way, which Share waits for. */
	private linkWriting: Promise<void> = Promise.resolve();
	/** The fragment this tab last wrote, to tell its own writes from a link pasted into its address bar. */
	private written: string | null = null;
	/** Whether the last write of the URL put the project there: false when it was too large or failed, and the URL is older. */
	private linkCurrent = false;
	/** Whether the Log panel already said that this project is too large for its link. */
	private tooLongSaid = false;
	/** Bumped by every language switch, so a switch overtaken by a later one is skipped. */
	private generation = 0;
	/**
	 * Switching, resetting and restarting run one after another on this
	 * chain, so none of them sees the half-done state of another.
	 */
	private transitions: Promise<void> = Promise.resolve();

	constructor() {
		monaco.editor.onDidChangeMarkers(() => this.refreshProblems());
		// "Run test | Debug test" above each test, where the language finds them (test-lens.ts).
		registerTestLenses(this);
	}

	/**
	 * Connects the editor area and loads the project the URL holds, else the
	 * language chosen last (or the first) with its saved project.
	 */
	attach(host: EditorHost): void {
		this.host = host;
		const saved = tabProject(location.hash);
		if (saved) {
			// Reloaded, or restored with the browser, after a save its URL did not catch.
			const generation = ++this.generation;
			void this.serially(async () => {
				if (generation !== this.generation) return;
				this.language = saved.language;
				saveLanguage(saved.language);
				this.load(saved.project);
				this.startClient();
			});
			return;
		}
		if (holdsProject(location.hash)) {
			void this.openLink(location.hash);
			return;
		}
		const chosen = loadLanguage();
		void this.switchTo(isLanguageId(chosen) ? chosen : LANGUAGES[0]!.id);
	}

	/**
	 * Opens the project a URL fragment holds, in place of the current one
	 * (which is saved first): this tab was opened with a link, or one was
	 * pasted into its address bar. A fragment this tab wrote itself is
	 * ignored. A damaged link is reported and the tab keeps what it has, or
	 * on first load starts from the saved project, as without a link.
	 */
	openLink(hash: string): Promise<void> {
		if (hash === this.written || !holdsProject(hash)) return Promise.resolve();
		const generation = ++this.generation;
		return this.serially(async () => {
			if (generation !== this.generation) return;
			let opened;
			try {
				opened = await projectOfLink(hash);
			} catch (e) {
				this.write('error', `Could not open the project in this link: ${e instanceof Error ? e.message : String(e)}`);
				if (this.models.size === 0) {
					const saved = loadLanguage();
					this.language = isLanguageId(saved) ? saved : LANGUAGES[0]!.id;
					this.load(loadProject(this.language, (m) => this.write('warning', m)));
					this.startClient();
				} else void this.writeLink();
				return;
			}
			await this.closeProject();
			this.language = opened.language;
			saveLanguage(opened.language);
			this.load(opened.project);
			this.startClient();
		});
	}

	/**
	 * The link to this tab's project as it is now, for Share: whoever opens
	 * it gets a copy of their own. Null when the project is too large for a
	 * link (the Log panel says so).
	 */
	async shareLink(): Promise<string | null> {
		clearTimeout(this.saveTimer);
		if (this.models.size) this.saveNow();
		await this.linkWriting;
		return this.linkCurrent ? location.href : null;
	}

	/**
	 * Selects a language: saves and closes the current project, stops its
	 * server, then loads the language's project and starts its server.
	 */
	switchTo(language: LanguageId): Promise<void> {
		const generation = ++this.generation;
		return this.serially(async () => {
			if (generation !== this.generation) return; // a later switch replaces this one
			await this.closeProject();
			this.language = language;
			saveLanguage(language);
			this.load(loadProject(language, (m) => this.write('warning', m)));
			this.startClient();
		});
	}

	/** Replaces the current project with the language's sample, after the user confirmed. */
	resetProject(): Promise<void> {
		return this.serially(async () => {
			this.preview.stop();
			this.closeViews();
			await this.stopClient();
			this.disposeModels();
			this.load(sampleProject(this.language));
			this.changed = true;
			this.saveNow();
			this.startClient();
		});
	}

	/** Restarts the language server on the same files. */
	restartServer(): Promise<void> {
		return this.serially(async () => {
			await this.stopClient();
			this.startClient();
		});
	}

	/**
	 * The project as the core sees it (@yukibana/core's `ProjectSnapshot`),
	 * over the editor's models: nothing is read until a provider asks, and
	 * every file only when one dispatches (`files`), never per keystroke.
	 * It reads through to the models, so it answers for the project only
	 * while `revision` is the one it was made at: a read after the project
	 * has changed throws, rather than answer for a newer project under an
	 * older revision. Reading `revision` here makes whatever derives from a
	 * snapshot (the top bar's availability) derive again after each change.
	 * The same snapshot is returned while the revision is the same, so that
	 * what a rule reads of it is read once per revision however many buttons
	 * ask (lang-cpp/refusals.ts keeps what it found per snapshot).
	 */
	snapshot(): ProjectSnapshot {
		const models = this.models;
		const revision = this.revision;
		if (this.live?.revision === revision) return this.live;
		this.live = this.liveSnapshot(models, revision);
		return this.live;
	}

	/** The last snapshot `snapshot` made; not reactive, so that making one changes nothing a `$derived` reads. */
	private live: ProjectSnapshot | null = null;

	/** Returns a snapshot that reads through to `models` while the project is at `revision` (see `snapshot`). */
	private liveSnapshot(models: ReadonlyMap<string, monaco.editor.ITextModel>, revision: number): ProjectSnapshot {
		const current = (): void => {
			if (this.revision !== revision) throw new Error(`A snapshot of revision ${revision} of the project was read at revision ${this.revision}: it no longer says what the project holds.`);
		};
		return {
			revision,
			paths: () => {
				current();
				return [...models.keys()].map(pathOf);
			},
			file: (path) => {
				current();
				return models.get(path)?.getValue() ?? null;
			},
			files: () => {
				current();
				const files: Record<string, string> = {};
				for (const [path, model] of models) files[pathOf(path)] = model.getValue();
				return files;
			},
			meta: (binding) => {
				current();
				const stored: unknown = new Map<string, unknown>(Object.entries(this.savedSettings())).get(binding.key);
				return stored === undefined ? null : binding.parse(stored);
			},
		};
	}

	/**
	 * The project as `files` and the saved settings are now, as a snapshot
	 * that never goes stale: for a provider performed after something that
	 * changes the project (showing the terminal moves the tabs), or later
	 * still (a debugged run starts once the debugger's worker is ready).
	 * `files` are read once, by the caller, from the live snapshot.
	 */
	private frozen(files: Files): ProjectSnapshot {
		const revision = this.revision;
		const meta = new Map<string, unknown>(Object.entries(this.savedSettings()));
		return {
			revision,
			paths: () => Object.keys(files).map(pathOf),
			file: (path) => (Object.hasOwn(files, path) ? (files[path] ?? null) : null),
			files: () => files,
			meta: (binding) => {
				const stored = meta.get(binding.key);
				return stored === undefined ? null : binding.parse(stored);
			},
		};
	}

	/**
	 * Runs the project: the language's entry file when the project has one,
	 * else the file shown; `mode` 'test' runs its tests instead, 'mutate'
	 * mutation-tests the project against them, where the language's
	 * providers offer that (modules/lang-<pack>/index.ts). Every file goes along, as last
	 * edited. A web project's Run previews its page instead, where the
	 * language has a provider of `preview` (lang-javascript/index.ts).
	 */
	run(mode: RunMode = 'run'): void {
		const subject = subjectOf(this.language);
		const token = tokenOf(mode);
		const snapshot = this.snapshot();
		const availability = yukibana().availability(subject, token, snapshot);
		if (availability.kind === 'unavailable') {
			// Ctrl+Shift+Enter and the editors' actions reach here with the button disabled: say why, where the language has the mode at all.
			if (yukibana().has(subject, token)) this.write('warning', availability.reason);
			return;
		}
		if (mode === 'run' && yukibana().has(subject, preview)) {
			this.startPreview(subject, snapshot);
			return;
		}
		this.startRun(mode, snapshot, (input, frozen) => yukibana().perform(subject, token, input, frozen, new AbortController().signal));
	}

	/**
	 * Runs one of the project's tests alone, `test` (the code lens's Run
	 * test, Run Test at Cursor), where the language's providers offer that
	 * (std's `testCase`): its test run, with the test named, so the runner
	 * runs that test and no other.
	 */
	runTest(selector: TestSelector): void {
		const subject = subjectOf(this.language);
		const snapshot = this.snapshot();
		const availability = yukibana().availability(subject, testCase, snapshot);
		if (availability.kind === 'unavailable') {
			if (yukibana().has(subject, testCase)) this.write('warning', availability.reason);
			return;
		}
		this.startRun('test', snapshot, (input, frozen) => yukibana().perform(subject, testCase, { ...input, test: selector }, frozen, new AbortController().signal));
	}

	/**
	 * Starts a run in the terminal: the entry, the run options and a frozen
	 * snapshot are read from `snapshot` before the terminal is shown, and
	 * `perform` is handed them with the terminal's listener; what it gives
	 * is shown, and a refusal or failure is said in the Log panel.
	 */
	private startRun(mode: RunMode, snapshot: ProjectSnapshot, perform: (input: RunInput, frozen: ProjectSnapshot) => Promise<Outcome<RunHandle>>): void {
		const language = languageOf(this.language);
		const entry = this.models.has(language.entry) ? language.entry : this.active;
		if (!entry) {
			this.write('warning', `There is no ${language.entry} to run.`);
			return;
		}
		// On a Linux target the runner runs GoogleTest tests (and RapidCheck)
		// under QEMU, and refuses Catch2 and doctest by name (packs/cpp README).
		const files = snapshot.files();
		// A C or C++ runner reads its level from compile_flags.txt; Swift's is
		// sent. A Rust program on a Linux target runs under QEMU with the C++
		// pack's Run options. The language's properties say which (properties/).
		// Read before the terminal is shown: showing it moves the tabs, which
		// is a change of the project, and the snapshot is then stale.
		const options = runnerOptionsOf(this.settings, snapshot);
		const frozen = this.frozen(files);
		this.host?.showTerminal();
		const listener = this.runner.begin();
		const input = { files, entry: pathOf(entry), options, ...listener };
		// The provider is eager: the run is handed to the pool within this
		// task, before the next event, as when the app asked the pool itself.
		perform(input, frozen).then(
			(outcome) => {
				if (outcome.kind === 'done') this.runner.start(outcome.value);
				else this.write('warning', outcome.reason);
			},
			(e: unknown) => this.write('error', `Could not ${mode} the project: ${e instanceof Error ? e.message : String(e)}`),
		);
	}

	/**
	 * Returns the tests of the project file `path` (std's `findTests`), where
	 * the language finds them and one can be run alone; empty anywhere
	 * else, and when finding them failed (said in the Log panel).
	 */
	async testsIn(path: string): Promise<readonly FoundTest[]> {
		const subject = subjectOf(this.language);
		if (!yukibana().has(subject, findTests)) return [];
		const snapshot = this.snapshot();
		if (yukibana().availability(subject, findTests, snapshot).kind !== 'available') return [];
		try {
			const outcome = await yukibana().perform(subject, findTests, { path: pathOf(path) }, snapshot, new AbortController().signal);
			return outcome.kind === 'done' ? outcome.value : [];
		} catch (e) {
			this.write('error', `Could not find the tests of ${path}: ${e instanceof Error ? e.message : String(e)}`);
			return [];
		}
	}

	/**
	 * Returns the test the cursor on `line` of `path` is in (Run Test at
	 * Cursor, Debug Test at Cursor), or null, having said in the Log panel
	 * that there is none.
	 */
	async testAt(path: string, line: number): Promise<TestSelector | null> {
		const found = testAt(await this.testsIn(path), line);
		if (found === null) this.write('warning', `There is no test at line ${line} of ${path}.`);
		return found?.selector ?? null;
	}

	/**
	 * Shows the project's page in the Preview panel, built by the session of
	 * the language's provider of `preview`: the session already showing it,
	 * if there is one, so the runner (and TypeScript) is loaded once.
	 */
	private startPreview(subject: LanguageSubject, snapshot: ProjectSnapshot): void {
		const show = (session: PreviewSession): void => {
			this.host?.showPreview();
			this.host?.showTerminal();
			this.runner.attach(`Previewing ${session.entry}. Its console appears here; edits reload the page, and a stylesheet edit is applied without a reload.`);
			this.preview.start(subject.id, session, () => this.currentFiles());
		};
		const shown = this.preview.sessionOf(subject.id);
		if (shown !== null) {
			show(shown);
			return;
		}
		yukibana()
			.perform(subject, preview, { report: (text) => this.runner.print('stderr', text) }, snapshot, new AbortController().signal)
			.then(
				(outcome) => {
					if (outcome.kind === 'done') show(outcome.value);
					else this.write('warning', outcome.reason);
				},
				(e: unknown) => this.write('error', `Could not preview the project: ${e instanceof Error ? e.message : String(e)}`),
			);
	}

	/**
	 * `true` iff a debugging session is starting or running, or Debug is
	 * waiting for the debugger's code: what disables Debug.
	 */
	get debugging(): boolean {
		return this.debuggerLoading || (this.debugger?.active ?? false);
	}

	/**
	 * Returns the debugger, loading its code (debug.svelte.ts) the first
	 * time; rejects when that code does not load, and the next call tries
	 * again.
	 */
	loadDebugger(): Promise<Debugger> {
		this.debuggerLoad ??= import('./debug.svelte').then(
			({ Debugger }) => (this.debugger ??= new Debugger(this.breakpoints)),
			(e: unknown) => {
				this.debuggerLoad = null;
				throw e;
			},
		);
		return this.debuggerLoad;
	}

	/**
	 * Runs the project under the debugger, where the language's providers
	 * offer that (modules/lang-<pack>/index.ts): its program, or with `what`
	 * 'test' its tests, or with a test's selector that test alone (Debug
	 * test). Where the language's runner stops at a failed assertion (std's
	 * `failureStop`), its tests stop there while `stopOnFailure` is set, in
	 * the way that provider says.
	 * The debugger's worker starts, then the run, with the channel it
	 * listens on; the program stops at the breakpoints set in the editors'
	 * margins. The terminal shows the program's output and takes its input,
	 * as for a run; ending the run ends the session, and the other way round.
	 * What is run, and whether it may be, is decided at the click: the run
	 * starts later, once the debugger is ready, on the project as it was.
	 * The first Debug of the page loads the debugger's code first.
	 */
	async debug(what: DebugMode | TestSelector = 'run'): Promise<void> {
		const language = languageOf(this.language);
		const subject = subjectOf(this.language);
		// Debug tests is narrowed (one test, or a stop at each failed
		// assertion) where the language provides that, and then always
		// performs `debugTestCase`, which with neither is Debug tests exactly.
		const selected = typeof what === 'string' ? null : what;
		const mode: DebugMode = typeof what === 'string' ? what : 'test';
		const narrowed = mode === 'test' && yukibana().has(subject, debugTestCase);
		if (selected !== null && !narrowed) return;
		const token = narrowed ? debugTestCase : debugTokenOf(mode);
		const snapshot = this.snapshot();
		const availability = yukibana().availability(subject, token, snapshot);
		if (availability.kind === 'unavailable') {
			// F5 reaches here with the Debug button disabled: say why, where the language debugs at all.
			if (yukibana().has(subject, token)) this.write('warning', availability.reason);
			return;
		}
		const entry = this.models.has(language.entry) ? language.entry : this.active;
		if (!entry) {
			this.write('warning', `There is no ${language.entry} to debug.`);
			return;
		}
		const files = snapshot.files();
		// What a debugged run is sent of these, the provider says (C and C++
		// the run options, Swift none, as they always were).
		const options = runnerOptionsOf(this.settings, snapshot);
		const frozen = this.frozen(files);
		const generation = this.generation;
		this.debuggerLoading = true;
		let dbg: Debugger;
		let stop: FailureStop | null;
		try {
			// How the runner stops at a failed assertion is the language's to
			// say, asked of the project as it was at the click.
			stop = narrowed && this.stopOnFailure ? await this.failureStopOf(subject, snapshot) : null;
			dbg = await this.loadDebugger();
		} catch (e) {
			this.write('error', `The debugger could not be loaded: ${e instanceof Error ? e.message : String(e)}`);
			return;
		} finally {
			this.debuggerLoading = false;
		}
		// The language changed while the debugger's code downloaded: the click was for the old project.
		if (generation !== this.generation) return;
		const breakOnFailure = stop !== null;
		this.host?.showTerminal();
		this.host?.showDebug();
		this.runner.ended = () => {
			if (dbg.active) dbg.end(false);
		};
		const start = (channel: DebugChannel): void => {
			const listener = this.runner.begin();
			const input = { files, entry: pathOf(entry), options, ...listener, channel };
			const signal = new AbortController().signal;
			const session = narrowed
				? yukibana().perform(subject, debugTestCase, { ...input, test: selected, breakOnFailure }, frozen, signal)
				: yukibana().perform(subject, debugTokenOf(mode), input, frozen, signal);
			session.then(
				(outcome) => {
					if (outcome.kind !== 'done') {
						this.write('warning', outcome.reason);
						dbg.end(false);
						return;
					}
					const { run, program } = outcome.value;
					this.runner.start(run);
					// Only to the session of the run the terminal still shows.
					void program.then((linked) => {
						if (linked !== null && this.runner.shows(run)) void dbg.attach(linked);
					});
				},
				(e: unknown) => {
					// The provider's body did not load (it is lazy) or threw: no run started, so the session ends.
					this.write('error', `Could not debug the project: ${e instanceof Error ? e.message : String(e)}`);
					dbg.end(false);
				},
			);
		};
		dbg.start({
			run: start,
			stopRun: () => this.runner.stop(false),
			// Set before the program runs, for `breakOnFailure` (std's `failureStop`).
			failureStop: stop,
			// A frame in a file of the runner's own (its failed-assertion hook) is not the project's.
			inProject: (path) => Object.hasOwn(files, path),
			reveal: (path, line) => this.show(path, { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }),
			log: (text) => this.write('info', text, 'run'),
		});
	}

	/**
	 * Returns how `subject`'s runner stops at a failed assertion on
	 * `snapshot` (std's `failureStop`), or null where it does not, or the
	 * provider is unavailable or fails; says why on the Log panel when it
	 * is the language's and refused.
	 */
	private async failureStopOf(subject: LanguageSubject, snapshot: ProjectSnapshot): Promise<FailureStop | null> {
		if (!yukibana().has(subject, failureStop)) return null;
		try {
			const outcome = await yukibana().perform(subject, failureStop, null, snapshot, new AbortController().signal);
			if (outcome.kind === 'done') return outcome.value;
			this.write('warning', `The tests run without stopping at a failed assertion: ${outcome.reason}`);
		} catch (e) {
			this.write('error', `The tests run without stopping at a failed assertion: ${e instanceof Error ? e.message : String(e)}`);
		}
		return null;
	}

	/**
	 * Opens a compiler output view of the active C or C++ source (languages
	 * with that view, modules/lang-<pack>); does nothing for another language.
	 */
	async showView(kind: ViewKind): Promise<void> {
		if (!viewOf(subjectOf(this.language), kind)) return;
		const generation = this.generation;
		try {
			await this.loadExplorer();
		} catch (e) {
			this.write('error', `The compiler output views could not be loaded: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		// The language changed while the views' code downloaded: the request was for the old one.
		if (generation === this.generation) this.host?.showView(kind);
	}

	/**
	 * Opens view `kind` when it is closed and closes it when it is open: what
	 * the top bar's toggles do.
	 */
	toggleView(kind: ViewKind): void {
		if (this.viewsOpen.includes(kind)) this.host?.hideView(kind);
		else void this.showView(kind);
	}

	/** Brings the Log or Problems panel to the front. */
	showPanel(id: 'log' | 'problems'): void {
		this.host?.showPanel(id);
	}

	/** The dock opened or closed a view's panel; `open` is every view open now. */
	viewsChanged(open: readonly ViewKind[]): void {
		if (open.length !== this.viewsOpen.length || open.some((k) => !this.viewsOpen.includes(k))) this.viewsOpen = open;
	}

	/** The explorer, loading its code the first time. */
	private loadExplorer(): Promise<Explorer> {
		this.explorerLoad ??= import('./explorer.svelte').then(({ Explorer }) => {
			const explorer = new Explorer({
				language: () => subjectOf(this.language).id,
				views: (language) => viewsOf({ kind: 'language', id: language }),
				files: () => this.currentFiles(),
				snapshot: (files) => this.frozen(files),
				explore: (language, input, snapshot, signal) => yukibana().perform({ kind: 'language', id: language }, explore, input, snapshot, signal),
				release: (language, holder) => releaseExplorer({ kind: 'language', id: language }, holder),
				// C and C++ views read the level from compile_flags.txt, as their runner does; Swift's is sent, as with Run.
				options: () => {
					const o = this.optimization;
					return this.settings.level?.storage.kind === 'meta' && o && o.kind !== 'other' ? { optimization: o.level.flag } : {};
				},
			});
			explorer.activeChanged(this.active);
			this.explorer = explorer;
			return explorer;
		});
		// A failed download may succeed on the next try.
		this.explorerLoad.catch(() => (this.explorerLoad = null));
		return this.explorerLoad;
	}

	/**
	 * Puts a C or C++ project on target `id` (lang-cpp/targets.ts): compile_flags.txt
	 * is rewritten (or created) as one edit, which Undo takes back, then
	 * saved; clangd, Run and the views follow the file. The Log panel
	 * says what changed.
	 */
	chooseTarget(id: CppTargetId): void {
		if (!this.choose(this.settings.target, id)) return;
		const target = targetById(id);
		this.refreshTarget();
		const how = target.default ? `no --target line in ${COMPILE_FLAGS}` : `--target=${target.triple} in ${COMPILE_FLAGS}`;
		this.write('info', `Target: ${target.label} (${how}).${target.runtime === 'linux' ? ' Run compiles for Linux and runs the program under QEMU, and Test its GoogleTest tests (Catch2 and doctest run on WebAssembly only).' : ''}`);
		this.scheduleSave();
	}

	/**
	 * Turns the C or C++ project's sanitizers on or off as `choice` says
	 * (lang-cpp/sanitizers.ts): compile_flags.txt's -fsanitize= line is
	 * rewritten (or the file created) as one edit, which Undo takes back,
	 * then saved; clangd, Run, Test, the views and Download follow the file.
	 * The Log panel says what changed.
	 */
	chooseSanitizers(choice: SanitizerChoice): void {
		if (!this.choose(this.settings.sanitizers, choice)) return;
		this.refreshTarget();
		this.write('info', describeSanitizers(choice));
		this.scheduleSave();
	}

	/**
	 * Puts the project on the optimisation level `flag` (optimization.ts).
	 * For C and C++ compile_flags.txt's `-O` line is rewritten (or the file
	 * created) as one edit, which Undo takes back, so clangd, Run and the
	 * views follow the file; for Swift and Scala the level is saved with the
	 * project and goes with Run (and Test). The Log panel says what changed.
	 */
	chooseOptimization(flag: string): void {
		const property = this.settings.level;
		const level = levelsOf(this.language)?.find((l) => l.flag === flag);
		if (!property || !level || !this.choose(property, flag)) return;
		if (property.storage.kind === 'file') {
			const how = level.default ? `no -O line in ${COMPILE_FLAGS}: Run and the views add ${flag}` : `${flag} in ${COMPILE_FLAGS}`;
			this.write('info', `Optimization: ${flag} (${how}).`);
		} else {
			const what = yukibana().has(subjectOf(this.language), test) ? 'Run and Test' : 'Run';
			this.write('info', `Optimization: ${level.label}, for ${what}${level.default ? ' (the default)' : ''}.`);
		}
		this.refreshOptimization();
		this.explorer?.settingsChanged();
		this.scheduleSave();
	}

	/**
	 * Puts a C or C++ project on a language standard (lang-cpp/standards.ts):
	 * compile_flags.txt's `-std=` line for the project's language is
	 * rewritten (removed for `'default'`, or the file created) as one edit,
	 * which Undo takes back, then saved; clangd, Run, the views and Download
	 * follow the file. The Log panel says what changed.
	 */
	chooseStandard(choice: { standard: Standard; gnu: boolean } | 'default'): void {
		const standard = this.settings.standard;
		if (!standard || !this.choose(standard.property, standardSettingOf(choice))) return;
		this.refreshTarget();
		const now = standardOf(this.models.get(COMPILE_FLAGS)?.getValue(), standard.language);
		this.write('info', `Standard: ${describeStandard(now)}${choice === 'default' ? ` (no -std= line in ${COMPILE_FLAGS})` : ` (-std=${choice.gnu ? choice.standard.gnu : choice.standard.iso} in ${COMPILE_FLAGS})`}.`);
		this.explorer?.settingsChanged();
		this.scheduleSave();
	}

	/**
	 * Turns clang-tidy on or off for a C or C++ project: saved with the
	 * project (and its link), and sent to the running server, which adds or
	 * removes its diagnostics without a restart. The rules in .clang-tidy
	 * stay as they are, for when it is turned on again.
	 */
	setClangTidy(on: boolean): void {
		if (on === this.clangTidy || !this.choose(this.settings.clangTidy, on)) return;
		this.session?.configure(this.serverOptions());
		this.write('info', on ? `clang-tidy is on: its rules are in ${TIDY_FILE}.` : `clang-tidy is off; ${TIDY_FILE} is kept for when it is turned on.`);
		this.scheduleSave();
	}

	/**
	 * Sets a C or C++ project's clang-tidy rules: .clang-tidy's `Checks`
	 * rewritten (lang-cpp/tidy.ts `withChecks`; every other line kept, the file
	 * created if missing) as one edit, which Undo takes back, then saved.
	 * clangd reads the file again and diagnoses with the new rules.
	 */
	setTidyChecks(globs: readonly CheckGlob[]): void {
		if (!this.choose(this.settings.tidyChecks, globs)) return;
		this.refreshTidy();
		this.scheduleSave();
	}

	/**
	 * Puts a Rust project on target `id` (lang-rust/targets.ts): the `[build]`
	 * table's `target` of .cargo/config.toml is rewritten (or the file
	 * created) as one edit, which Undo takes back, then saved; Run, Test
	 * and Download follow the file. The Log panel says what changed.
	 */
	chooseRustTarget(id: RustTarget['id']): void {
		const target = RUST_TARGETS.find((t) => t.id === id);
		if (!target || !this.choose(this.settings.rustTarget, id)) return;
		this.refreshTarget();
		const how = target.default ? `no [build] target in ${CARGO_CONFIG}` : `target = "${target.triple}" in ${CARGO_CONFIG}`;
		this.write('info', `Target: ${target.label} (${how}).${target.runtime === 'linux' ? ' Run and Test compile for Linux and run the program under QEMU; the first build downloads the cross compiler.' : ''}`);
		this.scheduleSave();
	}

	/**
	 * Turns Miri on for a Rust project, on Miri target `id`, or off (null):
	 * saved with the project (and its link); the next Run or Test
	 * interprets the program under Miri as if on that target, or compiles
	 * it.
	 */
	setMiri(id: MiriTarget['id'] | null): void {
		if (id === this.miri || !this.choose(this.settings.miri, id ?? 'off')) return;
		const target = MIRI_TARGETS.find((t) => t.id === id);
		this.write(
			'info',
			target
				? `Miri is on, as on ${target.label} (${target.detail}): Run and Test interpret the program and stop at undefined behaviour (much slower than the compiled program).`
				: 'Miri is off: Run and Test compile the program.',
		);
		this.scheduleSave();
	}

	/** What a C or C++ pack's server is told about the project: `initializationOptions`, and `configure` later. */
	private serverOptions(): { yukibana: { language: LanguageId; clangTidy: boolean } } {
		return { yukibana: { language: this.language, clangTidy: this.clangTidy } };
	}

	/**
	 * Changes how Run runs a program built for a Linux target; saved with
	 * the project. Not for a language without run options: it is ignored.
	 */
	setRunOptions(options: Partial<RunOptions>): void {
		if (!this.choose(this.settings.runOptions, { ...this.runOptions, ...options })) return;
		this.scheduleSave();
	}

	/** The build settings of the project's language (properties/), each null where it has none. */
	private get settings(): LanguageSettings {
		return settingsOf(this.language);
	}

	/**
	 * Makes `property` hold `value` (@yukibana/core's `writeProperty`), and
	 * returns `true` iff it did: false, and nothing is changed, when the
	 * language has no such property (null) or `value` is not one of its
	 * choices, which the pickers never offer. Saving and saying so are the
	 * caller's.
	 */
	private choose<V>(property: Property<V> | null, value: V): boolean {
		if (property === null) return false;
		const snapshot = this.snapshot();
		const choices = property.choices(snapshot);
		if (choices !== null && !choices.includes(value)) return false;
		this.apply(writeProperty(snapshot, property, value));
		return true;
	}

	/**
	 * Applies `edit`: a file's text as one edit, which Undo takes back
	 * (`replaceFile`), or a field of the saved project, which is saved with
	 * it and has no Undo (it never had). The fields are those of `Project`
	 * the properties bind (properties/), each read back here at the one
	 * boundary where a stored value becomes the workspace's.
	 *
	 * - Requires: a meta edit's key is one of `runOptions`, `optimization`, `clangTidy` and `miri`.
	 */
	private apply(edit: ProjectEdit): void {
		if (edit.kind === 'file') {
			this.replaceFile(edit.path, edit.text);
			return;
		}
		const value = edit.value;
		switch (edit.key) {
			case 'runOptions':
				this.runOptions = runOptionsOf(value);
				this.runOptionsChosen = true;
				break;
			case 'optimization':
				this.chosenLevel = typeof value === 'string' ? value : null;
				break;
			case 'clangTidy':
				this.clangTidy = value !== false;
				break;
			case 'miri':
				this.miri = isMiriTarget(value) ? value : null;
				break;
			default:
				throw new RangeError(`The workspace saves no project field "${edit.key}".`);
		}
		this.announce({ kind: 'meta', key: edit.key });
	}

	/** Opens the Download dialog; the page sets it. Without one, Download asks for nothing beyond the build files. */
	exportDialog: (() => void) | null = null;

	/** Download, as the explorer's and the menu's buttons ask for it: the dialog, which then calls `download`. */
	requestDownload(): void {
		if (this.exportDialog) this.exportDialog();
		else void this.download();
	}

	/**
	 * Returns what Download makes of the project as it is now (export.ts):
	 * the build systems that can build it and the project as each option
	 * zips it, loaded through the instance (the language's providers of
	 * std's `exportBuild` and `exportTooling`) with the Download code itself
	 * on the first call. Null, said in the Log panel, when the language has
	 * no download or its code did not load.
	 */
	async downloadable(): Promise<Downloadable | null> {
		const label = languageOf(this.language).label;
		const files = this.currentFiles();
		const snapshot = this.frozen(files);
		// A level compile_flags.txt holds is carried by the file itself.
		const level = this.settings.level?.storage.kind === 'meta' ? this.chosenLevel : null;
		try {
			const { downloadOf, exportProject } = await import('./export');
			const download = await downloadOf(yukibana(), subjectOf(this.language), snapshot, new AbortController().signal);
			if (download === null) {
				this.write('warning', `${label} projects cannot be downloaded: nothing provides their build files.`);
				return null;
			}
			return { builds: download.builds, exported: (options) => exportProject(download, files, level, options) };
		} catch (e) {
			this.write('error', `Could not load what downloads a ${label} project: ${e instanceof Error ? e.message : String(e)}`);
			return null;
		}
	}

	/**
	 * Downloads the project as `<language>-project.zip`, for an IDE: its files
	 * as last edited and its empty folders, in a folder of the same name, plus
	 * the build files, README and .gitignore it lacks, and the CI, dev
	 * container and .gitattributes `options` ask for (export.ts), as
	 * `prepared` makes them, or as the project is now when no dialog
	 * prepared it (`downloadable`). Says in the Log panel what was generated.
	 */
	async download(options: ExportOptions = {}, prepared: Downloadable | null = null): Promise<void> {
		const language = languageOf(this.language);
		const downloadable = prepared ?? (await this.downloadable());
		if (downloadable === null) return;
		const exported = downloadable.exported(options);
		const paths = Object.keys(exported.files).sort();
		const empty = this.allFolders().filter((f) => !paths.some((p) => p.startsWith(f + '/')) && !this.folders.some((g) => g.startsWith(f + '/')));
		const name = `${language.id}-project`;
		try {
			const { zip } = await import('./zip');
			const archive = await zip([
				...empty.map((f) => ({ path: `${name}/${f}/` })),
				...paths.map((p) => ({ path: `${name}/${p}`, text: exported.files[p] ?? '' })),
			]);
			const url = URL.createObjectURL(archive);
			const link = Object.assign(document.createElement('a'), { href: url, download: `${name}.zip` });
			link.click();
			// The download has its own copy once it starts; a minute is ample.
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
		} catch (e) {
			this.write('error', `Could not make the zip archive: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		const generated = exported.generated.length ? `, with ${exported.generated.join(', ')} generated` : '';
		this.write('info', `Downloaded ${name}.zip${generated}.`);
	}

	/**
	 * Switches a C++ project's tests to `framework` (lang-cpp/tests.ts): the
	 * sample's tests are rewritten for it, or a sample test file is added,
	 * and the Log panel says which. Each rewritten file changes as one
	 * edit of its own, which Undo in that file takes back without touching
	 * what was typed before it. (It once skipped the undo stops, so Undo
	 * merged the switch with the user's last typing and took both back.)
	 */
	chooseTestFramework(framework: TestFramework): void {
		const change = chooseTestFramework(this.currentFiles(), framework, languageOf('cpp').sample);
		for (const [path, text] of Object.entries(change.write)) this.replaceFile(path, text);
		if (change.show) this.host?.open(change.show);
		this.write(change.mixed ? 'warning' : 'info', change.message);
		this.scheduleSave();
	}

	/** Saves now instead of after the debounce: the page is being hidden or reloaded. */
	flush(): void {
		if (this.models.size) this.saveNow();
	}

	/** Every file of the project as last edited. */
	private currentFiles(): Record<string, string> {
		const files: Record<string, string> = {};
		for (const [path, model] of this.models) files[path] = model.getValue();
		return files;
	}

	/** Shows a file in the editor. */
	show(path: string, selection?: monaco.IRange): void {
		this.host?.open(path, selection);
	}

	/**
	 * Shows the place `range` of the file a language server named by `uri`
	 * (a call hierarchy's call site); nothing when it is not a project file.
	 */
	showSite(uri: string, range: monaco.IRange): void {
		const path = WORKSPACE.pathOf(monaco.Uri.parse(uri));
		if (path !== null && this.models.has(path)) this.host?.open(path, range);
	}

	/** The model of a project file. */
	model(path: string): monaco.editor.ITextModel | undefined {
		return this.models.get(path);
	}

	/**
	 * Returns the language server's selection ranges at `positions` of
	 * project file `path` (`LanguageSession.selectionRanges`), or null: no
	 * such file, no server, or a server without them.
	 */
	async selectionRanges(path: string, positions: monaco.IPosition[]): Promise<readonly SelectionRange[] | null> {
		const model = this.models.get(path);
		return model && this.session ? this.session.selectionRanges(model.uri.toString(), positions.map(toLspPosition), new AbortController().signal) : null;
	}

	/** Calls `listener` after each change of the project's files or saved settings, until disposed (core's `Project`). */
	onChange(listener: (change: ProjectChange) => void): Disposable {
		const own = (change: ProjectChange) => listener(change);
		this.changeListeners.add(own);
		return { dispose: () => this.changeListeners.delete(own) };
	}

	/** Tells every `onChange` listener of `change`. */
	private announce(change: ProjectChange): void {
		for (const listener of this.changeListeners) listener(change);
	}

	/** Called by the editor area when tabs change, so they are restored next time. */
	tabsChanged(open: string[], active: string | null): void {
		this.open = open;
		this.active = active;
		this.explorer?.activeChanged(active);
		this.scheduleSave(undefined, false);
	}

	/** Why a new file or folder cannot be called `path`, or `null`. */
	nameProblem(path: string): string | null {
		const problem = pathProblem(path);
		if (problem) return problem;
		if (this.models.has(path) || this.folders.includes(path) || this.isImpliedFolder(path)) return `"${path}" already exists.`;
		// A server mirrors the project into a file system, where a file cannot also be a folder.
		for (let p = parentOf(path); p; p = parentOf(p)) if (this.models.has(p)) return `"${p}" is a file, not a folder.`;
		return null;
	}

	/** Creates an empty file (and its folders) and opens it. */
	createFile(path: string): void {
		const problem = this.nameProblem(path);
		if (problem) throw new Error(problem);
		this.addModel(path, '', 'created');
		this.files = [...this.models.keys()].sort();
		this.host?.open(path);
		this.explorer?.edited();
		this.scheduleSave();
	}

	/** Creates an empty folder. */
	createFolder(path: string): void {
		const problem = this.nameProblem(path);
		if (problem) throw new Error(problem);
		this.folders = [...this.folders, path].sort();
		this.scheduleSave();
	}

	/**
	 * Renames a file or a folder with everything in it. The server sees each
	 * moved file deleted and created, which is what a rename on disk is.
	 */
	rename(from: string, to: string): void {
		if (from === to) return;
		const problem = this.nameProblem(to);
		if (problem) throw new Error(problem);
		const moved = this.models.has(from) ? [[from, to] as const] : [...this.models.keys()].filter((p) => p.startsWith(from + '/')).map((p) => [p, to + p.slice(from.length)] as const);
		const reopen: string[] = [];
		for (const [oldPath, newPath] of moved) {
			const text = this.models.get(oldPath)!.getValue();
			if (this.open.includes(oldPath)) reopen.push(newPath);
			this.removeModel(oldPath, 'moved');
			this.addModel(newPath, text, 'moved');
			this.announce({ kind: 'renamed', from: pathOf(oldPath), to: pathOf(newPath) });
		}
		this.folders = this.folders.map((f) => (f === from || f.startsWith(from + '/') ? to + f.slice(from.length) : f)).sort();
		this.files = [...this.models.keys()].sort();
		for (const p of reopen) this.host?.open(p);
		this.explorer?.edited();
		this.scheduleSave();
	}

	/** Deletes a file, or a folder with everything in it. */
	delete(path: string): void {
		const doomed = this.models.has(path) ? [path] : [...this.models.keys()].filter((p) => p.startsWith(path + '/'));
		for (const p of doomed) this.removeModel(p, 'deleted');
		this.folders = this.folders.filter((f) => f !== path && !f.startsWith(path + '/'));
		this.files = [...this.models.keys()].sort();
		this.explorer?.edited();
		this.scheduleSave();
	}

	/** Every folder to show: explicit ones and the parents of files. */
	allFolders(): string[] {
		const all = new Set(this.folders);
		for (const f of [...this.files, ...this.folders]) for (let p = parentOf(f); p; p = parentOf(p)) all.add(p);
		return [...all].sort();
	}

	/** Writes a line to the Log panel, as `source` (the app's own, unless named). */
	write(level: LogLevel, text: string, source: LogSource = 'app'): void {
		const line = { id: this.logId++, level, source, text, time: new Date() };
		this.log = this.log.length >= MAX_LOG_LINES ? [...this.log.slice(-MAX_LOG_LINES + 1), line] : [...this.log, line];
	}

	clearLog(): void {
		this.log = [];
	}

	private isImpliedFolder(path: string): boolean {
		return [...this.models.keys()].some((p) => p.startsWith(path + '/'));
	}

	private load(project: Project): void {
		for (const [path, text] of Object.entries(project.files)) this.addModel(path, text, 'loaded');
		this.files = [...this.models.keys()].sort();
		this.folders = [...project.folders].sort();
		this.runOptions = { ...(project.runOptions ?? DEFAULT_RUN_OPTIONS) };
		this.runOptionsChosen = project.runOptions !== undefined;
		this.chosenLevel = project.optimization ?? null;
		this.clangTidy = project.clangTidy !== false;
		this.miri = project.miri ?? null;
		this.host?.closeAll();
		const entry = languageOf(this.language).entry;
		const open = project.open.length ? project.open : this.models.has(entry) ? [entry] : this.files.slice(0, 1);
		for (const p of open) this.host?.open(p);
		const active = project.active ?? open[0];
		if (active) this.host?.open(active);
		this.refreshTestFramework();
		this.refreshTarget();
		this.refreshOptimization();
		this.refreshTidy();
		// The tab holds its project from the start, before any edit: reopened or shared now, it is this one.
		clearTimeout(this.saveTimer);
		this.changed = false;
		this.tooLongSaid = false;
		void this.writeLink();
	}

	/**
	 * Makes the file at `path` hold `text`, as a change the app makes on the
	 * user's behalf: an open file is rewritten as one edit with an undo stop
	 * before and after, so Undo takes back exactly this change and neither
	 * the typing before it nor the typing after it; a missing file is
	 * created. A file that already holds `text` is left alone (no empty undo
	 * step), and a missing file is not created empty. The file list and the
	 * open views follow; saving is the caller's.
	 */
	private replaceFile(path: string, text: string): void {
		const model = this.models.get(path);
		if (model) {
			if (model.getValue() === text) return;
			model.pushStackElement();
			model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
			model.pushStackElement();
		} else {
			if (!text) return;
			this.addModel(path, text, 'created');
		}
		this.files = [...this.models.keys()].sort();
		// A new model fires no content change, which is how an edit reaches the open views.
		this.explorer?.edited();
	}

	/**
	 * Makes the model of project file `path`, holding `text`: a file of a
	 * project being loaded, one just made, or the new place of one a rename
	 * moved (whose `renamed` the caller announces). The language server
	 * hears of it through `onChange`, and of its edits from its binding.
	 */
	private addModel(path: string, text: string, origin: 'loaded' | 'created' | 'moved'): void {
		const model = monaco.editor.createModel(text, undefined, uriOf(path));
		model.onDidChangeContent(() => {
			this.scheduleSave(path);
			this.preview.changed(path);
			this.explorer?.edited();
			this.announce({ kind: 'edited', path: pathOf(path), version: model.getVersionId() });
		});
		this.models.set(path, model);
		this.revision += 1;
		if (origin !== 'loaded') this.preview.changed(path);
		if (origin !== 'moved') this.announce({ kind: 'created', path: pathOf(path) });
	}

	/**
	 * Disposes the model of project file `path`: one deleted, or the old
	 * place of one a rename moved (whose `renamed` the caller announces).
	 * A deletion is announced before the model is disposed, so that a
	 * listener still finds it.
	 */
	private removeModel(path: string, why: 'deleted' | 'moved'): void {
		const model = this.models.get(path);
		if (!model) return;
		this.host?.close(path);
		this.models.delete(path);
		this.revision += 1;
		if (why === 'deleted') this.announce({ kind: 'deleted', path: pathOf(path) });
		this.preview.changed(path);
		model.dispose();
		// The file was deleted or renamed: an edit across files that
		// included it can no longer be undone across them (workspace-edits.ts).
		forgetUndo(model.uri);
	}

	private disposeModels(): void {
		this.host?.closeAll();
		const doomed = [...this.models];
		this.models.clear();
		this.revision += 1;
		for (const [path] of doomed) this.announce({ kind: 'deleted', path: pathOf(path) });
		for (const [, model] of doomed) model.dispose();
		this.files = [];
		this.problems = [];
	}

	private serially(transition: () => Promise<void>): Promise<void> {
		const next = this.transitions.then(transition);
		this.transitions = next.catch((e: unknown) => this.write('error', e instanceof Error ? e.message : String(e)));
		return this.transitions;
	}

	/** Stops the compiler output views' worker and closes their panels. */
	private closeViews(): void {
		this.explorer?.reset();
		this.host?.hideViews();
	}

	/** Saves the project, stops its server, and removes its files from the editor. */
	private async closeProject(): Promise<void> {
		this.runner.stop(false);
		this.runner.release(runnerSourceOf(languageOf(this.language)));
		this.runner.clear();
		this.preview.stop();
		this.host?.hidePreview();
		this.closeViews();
		this.flush();
		await this.stopClient();
		this.flush(); // edits typed while the server was shutting down
		this.disposeModels();
	}

	/**
	 * Starts the language's server on the current files. Does not wait for
	 * it: a pack may take a while to download, and a switch away meanwhile
	 * must not queue behind it. Stopping the session cancels the download.
	 */
	private startClient(): void {
		const language = languageOf(this.language);
		const serverUrl = appPacks().url(packOf(language), 'server.js');
		const session: LanguageSession = new LanguageSession(new Worker(serverUrl, { type: 'module', name: serverUrl.pathname }), {
			rootUri: WORKSPACE.uri,
			settings: language.settings,
			// The C and C++ pack's server is told whether clang-tidy runs.
			initializationOptions: settingsOf(language.id).clangTidy ? this.serverOptions() : null,
			clientName: 'Yukibana Light',
			locale: navigator.language,
			// `?trace` in the page's URL logs every message to the console.
			trace: new URLSearchParams(location.search).has('trace') ? (direction, message) => console.debug(`lsp ${direction}`, JSON.stringify(message).slice(0, 2000)) : null,
			events: {
				state: (s) => {
					if (this.session !== session) return;
					this.clientState = s;
					// A C++ pack with clang-tidy reports it before it answers `initialize`; an older one never does.
					if (s.kind === 'running' && settingsOf(language.id).clangTidy && this.tidyStatus === null)
						this.tidyStatus = { id: 'clang-tidy', label: 'clang-tidy', state: 'failed', detail: 'this build of the C and C++ language server has no clang-tidy yet' };
				},
				loading: (p) => {
					if (this.session === session) this.progress = p;
				},
				log: (level, text) => this.write(level, text, 'server'),
				status: (part) => {
					if (this.session === session && part.id === 'clang-tidy') this.tidyStatus = part;
				},
			},
		});
		const binding = new MonacoBinding({
			monaco,
			internals,
			session,
			project: this,
			documentUri: (path) => uriOf(path).toString(),
			languages: language.monacoLanguages,
			rootUri: WORKSPACE.uri,
			events: {
				log: (level, text) => this.write(level, text, 'server'),
				open: (uri, selection) => {
					const path = WORKSPACE.pathOf(uri);
					if (path && this.models.has(path)) this.host?.open(path, selection ?? undefined);
				},
				callHierarchy: (item) => {
					// The tree's code loads on the first Show Call Hierarchy, with its panel's.
					void import('./call-hierarchy.svelte').then(
						({ CallHierarchy }) => {
							if (this.session !== session) return;
							// In the direction chosen last, as VS Code's view keeps it.
							this.callHierarchy = new CallHierarchy(item, (direction, it) => session.calls(direction, it, new AbortController().signal), this.callHierarchy?.direction);
							this.host?.showCallHierarchy();
						},
						(e: unknown) => this.write('error', `The call hierarchy could not be loaded: ${e instanceof Error ? e.message : String(e)}`),
					);
				},
			},
		});
		this.session = session;
		this.write('info', `Starting the ${language.label} language server`);
		// A runner kept warm starts once the server has: both load the same
		// compiler, and the editor's answers come first.
		this.runner.keepWarm(null);
		binding.start().then(
			() => {
				if (this.session !== session) return;
				// The runner to keep warm is the one the language's runs use, as
				// its provider of `warm` says, where it has one and Run is available.
				const subject = subjectOf(language.id);
				const snapshot = this.snapshot();
				if (yukibana().availability(subject, warm, snapshot).kind !== 'available') return;
				yukibana()
					.perform(subject, warm, null, snapshot, new AbortController().signal)
					.then(
						(outcome) => {
							if (this.session === session && outcome.kind === 'done') this.runner.keepWarm(outcome.value);
						},
						(e: unknown) => this.write('error', `Could not keep a ${language.label} runner warm: ${e instanceof Error ? e.message : String(e)}`),
					);
			},
			async (e: unknown) => {
				if (this.session !== session) return;
				this.write('error', `${language.label} language server: ${e instanceof Error ? e.message : String(e)}`);
				// A worker that fails to load says nothing about why; a missing pack is the usual reason.
				const status = await fetch(serverUrl, { method: 'HEAD' }).then((r) => r.status, () => 0);
				if (status === 404) this.write('error', `The ${language.label} pack is not installed: ${serverUrl.pathname} was not found. Build it with packs/${packOf(language)}/build.sh.`);
			},
		);
	}

	private async stopClient(): Promise<void> {
		const session = this.session;
		this.session = null;
		this.progress = null;
		this.callHierarchy = null;
		this.tidyStatus = null;
		this.clientState = { kind: 'stopped' };
		await session?.stop();
	}

	/**
	 * The project's errors for the web preview, which reloads only without
	 * them, as `path:line:column: message`. Asked of the language server
	 * (`LanguageSession.workspaceErrors`), which answers for the edits made so far. A server
	 * that cannot be asked (one without workspace diagnostics, or none
	 * running yet) leaves the editor's error markers, which may lag the
	 * latest edit.
	 */
	private async projectErrors(signal: AbortSignal): Promise<string[]> {
		const pulled = this.session ? await this.session.workspaceErrors(signal) : null;
		const errors = pulled
			? pulled.errors.map(({ uri, diagnostic: d }) => ({ uri: monaco.Uri.parse(uri), line: d.range.start.line + 1, column: d.range.start.character + 1, message: d.message }))
			: monaco.editor
					.getModelMarkers({})
					.filter((m) => m.severity === monaco.MarkerSeverity.Error)
					.map((m) => ({ uri: m.resource, line: m.startLineNumber, column: m.startColumn, message: m.message }));
		return errors.flatMap(({ uri, line, column, message }) => {
			const path = WORKSPACE.pathOf(uri);
			return path !== null && this.models.has(path) ? [`${path}:${line}:${column}: ${message}`] : [];
		});
	}

	private refreshProblems(): void {
		const problems: Problem[] = [];
		for (const marker of monaco.editor.getModelMarkers({})) {
			const path = WORKSPACE.pathOf(marker.resource);
			if (path === null || !this.models.has(path)) continue;
			const { startLineNumber, startColumn, endLineNumber, endColumn } = marker;
			problems.push({
				path,
				severity: severityOf(marker.severity),
				message: marker.message,
				source: marker.source ?? null,
				range: { startLineNumber, startColumn, endLineNumber, endColumn },
			});
		}
		this.problems = problems.sort((a, b) => a.path.localeCompare(b.path) || worstFirst(a.severity, b.severity) || a.range.startLineNumber - b.range.startLineNumber);
	}

	private refreshTestFramework(): void {
		if (this.language !== 'cpp') {
			this.testFramework = null;
			return;
		}
		// Only tests/ decides, so a keystroke elsewhere reads no other file.
		const tests: Record<string, string> = {};
		for (const [path, model] of this.models) if (path.startsWith(TESTS_DIR)) tests[path] = model.getValue();
		const detected = detectTestFramework(tests);
		this.testFramework = detected.mixed ? 'mixed' : detected.framework;
	}

	/** The target, the sanitizers and the standard, which compile_flags.txt says. */
	private refreshTarget(): void {
		const flags = this.models.get(COMPILE_FLAGS)?.getValue();
		const settings = this.settings;
		this.target = settings.target ? targetOf(flags) : null;
		this.sanitizers = settings.sanitizers ? sanitizersOf(flags) : null;
		this.standard = settings.standard ? standardOf(flags, settings.standard.language) : null;
		this.rustTarget = settings.rustTarget ? rustTargetOf(this.models.get(CARGO_CONFIG)?.getValue()) : null;
	}

	/** The clang-tidy rules, which .clang-tidy says. */
	private refreshTidy(): void {
		this.tidyChecks = this.settings.tidyChecks ? checksOf(this.models.get(TIDY_FILE)?.getValue()) : null;
	}

	private refreshOptimization(): void {
		const levels = levelsOf(this.language);
		const property = this.settings.level;
		if (!levels || !property) this.optimization = null;
		else if (property.storage.kind === 'file') this.optimization = cppLevelOf(this.models.get(COMPILE_FLAGS)?.getValue());
		else {
			const level = levels.find((l) => l.flag === this.chosenLevel);
			this.optimization = level ? { kind: 'level', level } : { kind: 'default', level: defaultLevel(levels) };
		}
	}

	/**
	 * Saves shortly. `edited` is the file whose text changed, if that is all
	 * that did: the test framework is then looked at again only when it is
	 * under tests/, the target only when it is compile_flags.txt and the
	 * clang-tidy rules only when it is .clang-tidy, not on
	 * every keystroke in any file.
	 */
	private scheduleSave(edited?: string, change = true): void {
		this.revision += 1;
		if (change) this.changed = true;
		if (edited === undefined || edited.startsWith(TESTS_DIR)) this.refreshTestFramework();
		if (edited === undefined || edited === COMPILE_FLAGS || edited === CARGO_CONFIG) {
			this.refreshTarget();
			this.refreshOptimization();
		}
		if (edited === undefined || edited === TIDY_FILE) this.refreshTidy();
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => this.saveNow(), SAVE_DELAY_MS);
	}

	private saveNow(): void {
		clearTimeout(this.saveTimer);
		const project = this.currentProject();
		saveProject(this.language, project, { browser: this.changed }, (m) => this.write('error', m));
		void this.writeLink(project);
	}

	/** The project as it is now, as it is saved. */
	private currentProject(): Project {
		const files = this.currentFiles();
		return { files, folders: this.folders, open: this.open.filter((p) => p in files), active: this.active, ...this.savedSettings() };
	}

	/** The settings saved with the project beside its files, as they are now: only those set. */
	private savedSettings(): Pick<Project, 'runOptions' | 'optimization' | 'clangTidy' | 'miri'> {
		const settings = this.settings;
		return { ...(this.runOptionsChosen ? { runOptions: { ...this.runOptions } } : {}), ...(this.chosenLevel ? { optimization: this.chosenLevel } : {}), ...(settings.clangTidy && !this.clangTidy ? { clangTidy: false as const } : {}), ...(settings.miri && this.miri ? { miri: this.miri } : {}) };
	}

	/**
	 * Puts the project into this tab's URL, replacing the history entry
	 * rather than adding one, so Back still leaves the app instead of
	 * stepping through edits. History's own API, not SvelteKit's
	 * `replaceState`: that one updates the page's state on every save, and
	 * nothing reads the fragment through the router (which in `vite dev`
	 * warns once about it).
	 */
	private writeLink(project = this.currentProject()): Promise<void> {
		const write = ++this.linkWrites;
		this.linkWriting = linkOf(this.language, project).then(
			(hash) => {
				if (write !== this.linkWrites) return; // a later write overtook this one
				if (hash.length > MAX_LINK) {
					if (!this.tooLongSaid) this.write('warning', `This project is too large for a link (${Math.round(hash.length / 1000)} kB of the ${MAX_LINK / 1000} kB a URL may hold): this tab's link keeps an older version and cannot share it, and only this browser has the project as it is. Download it to keep it.`);
					this.tooLongSaid = true;
					this.linkCurrent = false;
					return;
				}
				this.tooLongSaid = false;
				this.written = hash;
				history.replaceState(history.state, '', hash);
				this.linkCurrent = true;
			},
			(e: unknown) => {
				if (write === this.linkWrites) this.linkCurrent = false;
				this.write('error', `Could not put the project into the link: ${e instanceof Error ? e.message : String(e)}`);
			},
		);
		return this.linkWriting;
	}
}

/** The file name shown on a tab. */
