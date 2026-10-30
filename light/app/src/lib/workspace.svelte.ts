/**
 * The state of the app: which language is selected, its project's files as
 * Monaco models, the language client serving them, and what the panels show
 * (problems, output, download progress). Components read it; only its
 * methods change it.
 */
import { monaco } from './monaco';
import { forgetUndo } from './workspace-edits';
import type { LoadingProgress, PartStatus, RunMode } from '@yukibana/protocol';
import { LanguageClient, type ClientState, type LogLevel } from './lsp/client';
import { isCFamily, isLanguageId, languageOf, LANGUAGES, type LanguageId } from './languages';
import { viewOf, viewsOf, type ExploreKind } from './explore-views';
import { Runner } from './run.svelte';
import { Preview } from './preview';
import { severityOf, worstFirst, type Severity } from './severity';
import { buildSystems, exportProject, type BuildSystem, type ExportOptions } from './export';
import { zip } from './zip';
import { chooseTestFramework, detectTestFramework, TESTS_DIR, type TestFramework } from './cpp-tests';
import { DEFAULT_RUN_OPTIONS, targetById, targetOf, withTarget, type CppTargetId, type RunOptions, type TargetChoice } from './cpp-targets';
import { describeSanitizers, sanitizersOf, withSanitizers, type SanitizerChoice } from './cpp-sanitizers';
import { cppLevelOf, defaultLevel, levelsOf, withCppLevel, type LevelChoice } from './optimization';
import { describeStandard, standardOf, withStandard, type Standard, type StandardChoice } from './cpp-standards';
import { checksOf, TIDY_FILE, withChecks, type CheckGlob } from './tidy-config';
import type { Explorer } from './explorer.svelte';
import { CallHierarchy } from './call-hierarchy.svelte';
import { Debugger } from './debug.svelte';
import type * as lsp from 'vscode-languageserver-protocol';
import { parentOf, pathProblem } from '@yukibana/runtime';
import { appPacks, packOf, runnerSourceOf } from './packs';
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
	showView(kind: ExploreKind): void;
	/** Closes the compiler output views, if open: the language or project changed. */
	hideViews(): void;
	/** Closes one compiler output view, if open: its toggle in the top bar was pressed again. */
	hideView(kind: ExploreKind): void;
	/** Opens the Call Hierarchy panel beside Problems, or brings it to the front. */
	showCallHierarchy(): void;
	/** Opens the Debug panel beside Problems, or brings it to the front. */
	showDebug(): void;
}

/** The file that holds a C or C++ project's flags: its target, standard, level and sanitizers among them. */
const COMPILE_FLAGS = 'compile_flags.txt';

const SAVE_DELAY_MS = 400;
/**
 * The longest link the URL is given, in characters. Chromium takes 2 MB
 * and Firefox about 1 MB; past this a project is still saved in the
 * browser, but its link is left as it was, and the Log panel says so.
 */
const MAX_LINK = 1_000_000;
const MAX_LOG_LINES = 2000;

export class Workspace {
	language = $state<LanguageId>('python');
	/** File paths, sorted. */
	files = $state<string[]>([]);
	/** Explicit folders (empty ones included), sorted. */
	folders = $state<string[]>([]);
	active = $state<string | null>(null);
	clientState = $state<ClientState>({ kind: 'stopped' });
	progress = $state<LoadingProgress | null>(null);
	log = $state<LogLine[]>([]);
	problems = $state<Problem[]>([]);
	/**
	 * A C++ project's test framework, as its tests/ files include it
	 * (cpp-tests.ts): `mixed` when they include more than one, null when
	 * none (or the project is not C++).
	 */
	testFramework = $state<TestFramework | 'mixed' | null>(null);
	/**
	 * A C or C++ project's target, as its compile_flags.txt says
	 * (cpp-targets.ts); null when the project is neither.
	 */
	target = $state<TargetChoice | null>(null);
	/**
	 * The sanitizers a C or C++ project has on, as its compile_flags.txt
	 * says (cpp-sanitizers.ts); null when the project is not C or C++.
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
	 * (cpp-standards.ts); null when the project is neither.
	 */
	standard = $state<StandardChoice | null>(null);
	/**
	 * Whether clang-tidy runs on a C or C++ project, as it was set with the
	 * project (Project.clangTidy): on unless turned off. Its rules are the
	 * project's .clang-tidy (`tidyChecks`) either way.
	 */
	clangTidy = $state(true);
	/**
	 * A C or C++ project's clang-tidy rules: the `Checks` of its .clang-tidy
	 * (tidy-config.ts), null when the file has no such key or there is no
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
	readonly runner = new Runner({
		kernel: (line) => this.write('log', `[kernel] ${line}`, 'run'),
		mark: (name, ms) => this.write('log', `timing: ${name} ${(ms / 1000).toFixed(2)} s`, 'run'),
		problem: (text) => this.write('warning', text, 'run'),
	});
	/**
	 * The compiler output views' client (languages with views, explore-views.ts), loaded
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
	viewsOpen = $state<readonly ExploreKind[]>([]);
	/** A web project's page, shown in the Preview panel; its console goes to the terminal. */
	readonly preview = new Preview(this.runner, (signal) => this.projectErrors(signal));
	/**
	 * The call hierarchy the Call Hierarchy panel shows: of the function
	 * last asked about (Show Call Hierarchy), null before that and once the
	 * server that answered it has stopped (its items mean nothing to the
	 * next one).
	 */
	callHierarchy = $state.raw<CallHierarchy | null>(null);
	/** The debugger (Debug), its breakpoints and the session the Debug panel shows. */
	readonly debugger = new Debugger();

	private client: LanguageClient | null = null;
	private readonly models = new Map<string, monaco.editor.ITextModel>();
	private open: string[] = [];
	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private logId = 0;
	private host: EditorHost | null = null;
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
	 * Runs the project: the language's entry file when the project has one,
	 * else the file shown; `mode` 'test' runs its tests instead (languages with
	 * `tests`), 'mutate' mutation-tests the project against them (languages
	 * with `mutates`). Every file goes along, as last edited.
	 */
	run(mode: RunMode = 'run'): void {
		const language = languageOf(this.language);
		if (mode === 'run' ? !language.runs : mode === 'test' ? !language.tests : !language.mutates) return;
		if (mode === 'run' && language.preview) {
			this.host?.showPreview();
			this.host?.showTerminal();
			this.runner.attach(`Previewing ${language.preview}. Its console appears here; edits reload the page, and a stylesheet edit is applied without a reload.`);
			this.preview.start(packOf(language), language.preview, () => this.currentFiles());
			return;
		}
		const entry = this.models.has(language.entry) ? language.entry : this.active;
		if (!entry) {
			this.write('warning', `There is no ${language.entry} to run.`);
			return;
		}
		// On a Linux target the runner runs GoogleTest tests (and RapidCheck)
		// under QEMU, and refuses Catch2 and doctest by name (packs/cpp README).
		const files = this.currentFiles();
		this.host?.showTerminal();
		// A C or C++ runner reads its level from compile_flags.txt; Swift's is sent.
		const cFamily = isCFamily(this.language);
		const level = !cFamily && this.optimization ? (this.optimization.kind === 'other' ? null : this.optimization.level.flag) : null;
		this.runner.start(runnerSourceOf(language), files, entry, mode, cFamily ? { ...this.runOptions } : level ? { optimization: level } : undefined);
	}

	/**
	 * Runs the project under the debugger (languages with `debugs`): the
	 * debugger's worker starts, then the run, with the channel it listens
	 * on; the program stops at the breakpoints set in the editors' margins.
	 * The terminal shows the program's output and takes its input, as for
	 * a run; ending the run ends the session, and the other way round.
	 */
	debug(): void {
		const language = languageOf(this.language);
		if (!language.debugs) return;
		const entry = this.models.has(language.entry) ? language.entry : this.active;
		if (!entry) {
			this.write('warning', `There is no ${language.entry} to debug.`);
			return;
		}
		const files = this.currentFiles();
		const source = runnerSourceOf(language);
		const options = isCFamily(this.language) ? { ...this.runOptions } : undefined;
		this.host?.showTerminal();
		this.host?.showDebug();
		this.runner.debugProgram = (program) => void this.debugger.attach(program);
		this.runner.ended = () => {
			if (this.debugger.active) this.debugger.end(false);
		};
		this.debugger.start({
			run: (channel) => this.runner.start(source, files, entry, 'run', options, channel),
			stopRun: () => this.runner.stop(false),
			reveal: (path, line) => this.show(path, { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }),
			log: (text) => this.write('info', text, 'run'),
			console: (text) => this.runner.print('info', text),
		});
	}

	/**
	 * Opens a compiler output view of the active C or C++ source (languages
	 * with that view, explore-views.ts); does nothing for another language.
	 */
	async showView(kind: ExploreKind): Promise<void> {
		if (!viewOf(this.language, kind)) return;
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
	toggleView(kind: ExploreKind): void {
		if (this.viewsOpen.includes(kind)) this.host?.hideView(kind);
		else void this.showView(kind);
	}

	/** Brings the Log or Problems panel to the front. */
	showPanel(id: 'log' | 'problems'): void {
		this.host?.showPanel(id);
	}

	/** The dock opened or closed a view's panel; `open` is every view open now. */
	viewsChanged(open: readonly ExploreKind[]): void {
		if (open.length !== this.viewsOpen.length || open.some((k) => !this.viewsOpen.includes(k))) this.viewsOpen = open;
	}

	/** The explorer, loading its code the first time. */
	private loadExplorer(): Promise<Explorer> {
		this.explorerLoad ??= import('./explorer.svelte').then(({ Explorer }) => {
			const explorer = new Explorer({
				language: () => this.language,
				pack: () => (viewsOf(this.language) ? packOf(languageOf(this.language)) : null),
				files: () => this.currentFiles(),
				// C and C++ views read the level from compile_flags.txt, as their runner does; Swift's is sent, as with Run.
				options: () => {
					const o = this.optimization;
					return !isCFamily(this.language) && o && o.kind !== 'other' ? { optimization: o.level.flag } : {};
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
	 * Puts a C or C++ project on target `id` (cpp-targets.ts): compile_flags.txt
	 * is rewritten (or created) as one edit, which Undo takes back, then
	 * saved; clangd, Run and the views follow the file. The Log panel
	 * says what changed.
	 */
	chooseTarget(id: CppTargetId): void {
		if (!isCFamily(this.language)) return;
		const target = targetById(id);
		this.replaceFile(COMPILE_FLAGS, withTarget(this.models.get(COMPILE_FLAGS)?.getValue(), id));
		this.refreshTarget();
		const how = target.default ? `no --target line in ${COMPILE_FLAGS}` : `--target=${target.triple} in ${COMPILE_FLAGS}`;
		this.write('info', `Target: ${target.label} (${how}).${target.runtime === 'linux' ? ' Run compiles for Linux and runs the program under QEMU, and Test its GoogleTest tests (Catch2 and doctest run on WebAssembly only).' : ''}`);
		this.scheduleSave();
	}

	/**
	 * Turns the C or C++ project's sanitizers on or off as `choice` says
	 * (cpp-sanitizers.ts): compile_flags.txt's -fsanitize= line is
	 * rewritten (or the file created) as one edit, which Undo takes back,
	 * then saved; clangd, Run, Test, the views and Download follow the file.
	 * The Log panel says what changed.
	 */
	chooseSanitizers(choice: SanitizerChoice): void {
		if (!isCFamily(this.language)) return;
		this.replaceFile(COMPILE_FLAGS, withSanitizers(this.models.get(COMPILE_FLAGS)?.getValue(), choice));
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
		const levels = levelsOf(this.language);
		const level = levels?.find((l) => l.flag === flag);
		if (!levels || !level) return;
		if (isCFamily(this.language)) {
			this.replaceFile(COMPILE_FLAGS, withCppLevel(this.models.get(COMPILE_FLAGS)?.getValue(), flag));
			const how = level.default ? `no -O line in ${COMPILE_FLAGS}: Run and the views add ${flag}` : `${flag} in ${COMPILE_FLAGS}`;
			this.write('info', `Optimization: ${flag} (${how}).`);
		} else {
			this.chosenLevel = level.default ? null : flag;
			const what = languageOf(this.language).tests ? 'Run and Test' : 'Run';
			this.write('info', `Optimization: ${level.label}, for ${what}${level.default ? ' (the default)' : ''}.`);
		}
		this.refreshOptimization();
		this.explorer?.settingsChanged();
		this.scheduleSave();
	}

	/**
	 * Puts a C or C++ project on a language standard (cpp-standards.ts):
	 * compile_flags.txt's `-std=` line for the project's language is
	 * rewritten (removed for `'default'`, or the file created) as one edit,
	 * which Undo takes back, then saved; clangd, Run, the views and Download
	 * follow the file. The Log panel says what changed.
	 */
	chooseStandard(choice: { standard: Standard; gnu: boolean } | 'default'): void {
		const language = this.language;
		if (language !== 'c' && language !== 'cpp') return;
		this.replaceFile(COMPILE_FLAGS, withStandard(this.models.get(COMPILE_FLAGS)?.getValue(), language, choice));
		this.refreshTarget();
		const now = standardOf(this.models.get(COMPILE_FLAGS)?.getValue(), language);
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
		if (!isCFamily(this.language) || on === this.clangTidy) return;
		this.clangTidy = on;
		this.client?.configure(this.serverOptions());
		this.write('info', on ? `clang-tidy is on: its rules are in ${TIDY_FILE}.` : `clang-tidy is off; ${TIDY_FILE} is kept for when it is turned on.`);
		this.scheduleSave();
	}

	/**
	 * Sets a C or C++ project's clang-tidy rules: .clang-tidy's `Checks`
	 * rewritten (tidy-config.ts `withChecks`; every other line kept, the file
	 * created if missing) as one edit, which Undo takes back, then saved.
	 * clangd reads the file again and diagnoses with the new rules.
	 */
	setTidyChecks(globs: readonly CheckGlob[]): void {
		if (!isCFamily(this.language)) return;
		this.replaceFile(TIDY_FILE, withChecks(this.models.get(TIDY_FILE)?.getValue(), globs));
		this.refreshTidy();
		this.scheduleSave();
	}

	/** What a C or C++ pack's server is told about the project: `initializationOptions`, and `configure` later. */
	private serverOptions(): { yukibana: { language: LanguageId; clangTidy: boolean } } {
		return { yukibana: { language: this.language, clangTidy: this.clangTidy } };
	}

	/** Changes how Run runs a program built for a Linux target; saved with the project. */
	setRunOptions(options: Partial<RunOptions>): void {
		this.runOptions = { ...this.runOptions, ...options };
		this.runOptionsChosen = true;
		this.scheduleSave();
	}

	/** Opens the Download dialog; the page sets it. Without one, Download asks for nothing beyond the build files. */
	exportDialog: (() => void) | null = null;

	/** Download, as the explorer's and the menu's buttons ask for it: the dialog, which then calls `download`. */
	requestDownload(): void {
		if (this.exportDialog) this.exportDialog();
		else void this.download();
	}

	/**
	 * What Download would add to the project with `options` (export.ts): the
	 * build systems that fit it, and the paths it would generate.
	 */
	exportPreview(options: ExportOptions): { buildSystems: BuildSystem[]; generated: string[] } {
		const language = languageOf(this.language);
		const files = this.currentFiles();
		return { buildSystems: buildSystems(language, files), generated: this.exported(options).generated };
	}

	/** The project as Download zips it, with `options` (export.ts). */
	private exported(options: ExportOptions) {
		return exportProject(languageOf(this.language), this.currentFiles(), isCFamily(this.language) ? null : this.chosenLevel, options);
	}

	/**
	 * Downloads the project as `<language>-project.zip`, for an IDE: its files
	 * as last edited and its empty folders, in a folder of the same name, plus
	 * the build files, README and .gitignore it lacks, and the CI, dev
	 * container and .gitattributes `options` ask for (export.ts). Says in the
	 * Log panel what was generated.
	 */
	async download(options: ExportOptions = {}): Promise<void> {
		const language = languageOf(this.language);
		const exported = this.exported(options);
		const paths = Object.keys(exported.files).sort();
		const empty = this.allFolders().filter((f) => !paths.some((p) => p.startsWith(f + '/')) && !this.folders.some((g) => g.startsWith(f + '/')));
		const name = `${language.id}-project`;
		try {
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
	 * Switches a C++ project's tests to `framework` (cpp-tests.ts): the
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
	 * The language server's selection ranges at `positions` of project file
	 * `path` (LanguageClient.selectionRanges), or null: no such file, no
	 * server, or a server without them.
	 */
	async selectionRanges(path: string, positions: monaco.IPosition[]): Promise<lsp.SelectionRange[] | null> {
		const model = this.models.get(path);
		return model && this.client ? this.client.selectionRanges(model, positions) : null;
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
		this.addModel(path, '', true);
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
			this.removeModel(oldPath);
			this.addModel(newPath, text, true);
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
		for (const p of doomed) this.removeModel(p);
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
		for (const [path, text] of Object.entries(project.files)) this.addModel(path, text, false);
		this.files = [...this.models.keys()].sort();
		this.folders = [...project.folders].sort();
		this.runOptions = { ...(project.runOptions ?? DEFAULT_RUN_OPTIONS) };
		this.runOptionsChosen = project.runOptions !== undefined;
		this.chosenLevel = project.optimization ?? null;
		this.clangTidy = project.clangTidy !== false;
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
			this.addModel(path, text, true);
		}
		this.files = [...this.models.keys()].sort();
		// A new model fires no content change, which is how an edit reaches the open views.
		this.explorer?.edited();
	}

	private addModel(path: string, text: string, created: boolean): void {
		const model = monaco.editor.createModel(text, undefined, uriOf(path));
		model.onDidChangeContent(() => {
			this.scheduleSave(path);
			this.preview.changed(path);
			this.explorer?.edited();
		});
		this.models.set(path, model);
		if (created) this.preview.changed(path);
		this.client?.addModel(model, created);
	}

	private removeModel(path: string): void {
		const model = this.models.get(path);
		if (!model) return;
		this.host?.close(path);
		this.client?.removeModel(model);
		this.models.delete(path);
		this.preview.changed(path);
		model.dispose();
		// The file was deleted or renamed: an edit across files that
		// included it can no longer be undone across them (workspace-edits.ts).
		forgetUndo(model.uri);
	}

	private disposeModels(): void {
		this.host?.closeAll();
		for (const model of this.models.values()) model.dispose();
		this.models.clear();
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
	 * must not queue behind it. Stopping the client cancels the download.
	 */
	private startClient(): void {
		const language = languageOf(this.language);
		const client = new LanguageClient({
			serverUrl: appPacks().url(packOf(language), 'server.js'),
			languages: language.monacoLanguages,
			rootUri: WORKSPACE.uri,
			settings: language.settings,
			...(isCFamily(language.id) ? { initializationOptions: this.serverOptions() } : {}),
			events: {
				state: (s) => {
					if (this.client !== client) return;
					this.clientState = s;
					// A C++ pack with clang-tidy reports it before it answers `initialize`; an older one never does.
					if (s.kind === 'running' && isCFamily(language.id) && this.tidyStatus === null)
						this.tidyStatus = { id: 'clang-tidy', label: 'clang-tidy', state: 'failed', detail: 'this build of the C and C++ language server has no clang-tidy yet' };
				},
				loading: (p) => {
					if (this.client === client) this.progress = p;
				},
				log: (level, text) => this.write(level, text, 'server'),
				open: (uri, selection) => {
					const path = WORKSPACE.pathOf(uri);
					if (path && this.models.has(path)) this.host?.open(path, selection);
				},
				callHierarchy: (item) => {
					if (this.client !== client) return;
					// In the direction chosen last, as VS Code's view keeps it.
					this.callHierarchy = new CallHierarchy(item, (direction, it) => client.calls(direction, it), this.callHierarchy?.direction);
					this.host?.showCallHierarchy();
				},
				status: (part) => {
					if (this.client === client && part.id === 'clang-tidy') this.tidyStatus = part;
				},
			},
		});
		this.client = client;
		this.write('info', `Starting the ${language.label} language server`);
		// A runner kept warm starts once the server has: both load the same
		// compiler, and the editor's answers come first.
		this.runner.keepWarm(null);
		client.start(() => this.models.values()).then(
			() => {
				if (this.client === client && language.warmRunner && language.runs) this.runner.keepWarm(runnerSourceOf(language));
			},
			async (e: unknown) => {
				if (this.client !== client) return;
				this.write('error', `${language.label} language server: ${e instanceof Error ? e.message : String(e)}`);
				// A worker that fails to load says nothing about why; a missing pack is the usual reason.
				const status = await fetch(client.serverUrl, { method: 'HEAD' }).then((r) => r.status, () => 0);
				if (status === 404) this.write('error', `The ${language.label} pack is not installed: ${client.serverUrl.pathname} was not found. Build it with packs/${packOf(language)}/build.sh.`);
			},
		);
	}

	private async stopClient(): Promise<void> {
		const client = this.client;
		this.client = null;
		this.progress = null;
		this.callHierarchy = null;
		this.tidyStatus = null;
		this.clientState = { kind: 'stopped' };
		await client?.stop();
	}

	/**
	 * The project's errors for the web preview, which reloads only without
	 * them, as `path:line:column: message`. Asked of the language server
	 * (`workspaceErrors`), which answers for the edits made so far. A server
	 * that cannot be asked (one without workspace diagnostics, or none
	 * running yet) leaves the editor's error markers, which may lag the
	 * latest edit.
	 */
	private async projectErrors(signal: AbortSignal): Promise<string[]> {
		const pulled = this.client ? await this.client.workspaceErrors(signal) : null;
		const errors = pulled
			? pulled.map(({ uri, diagnostic: d }) => ({ uri, line: d.range.start.line + 1, column: d.range.start.character + 1, message: d.message }))
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
		const language = this.language;
		const cFamily = language === 'c' || language === 'cpp';
		this.target = cFamily ? targetOf(flags) : null;
		this.sanitizers = cFamily ? sanitizersOf(flags) : null;
		this.standard = cFamily ? standardOf(flags, language) : null;
	}

	/** The clang-tidy rules, which .clang-tidy says. */
	private refreshTidy(): void {
		this.tidyChecks = isCFamily(this.language) ? checksOf(this.models.get(TIDY_FILE)?.getValue()) : null;
	}

	private refreshOptimization(): void {
		const levels = levelsOf(this.language);
		if (!levels) this.optimization = null;
		else if (isCFamily(this.language)) this.optimization = cppLevelOf(this.models.get(COMPILE_FLAGS)?.getValue());
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
		if (change) this.changed = true;
		if (edited === undefined || edited.startsWith(TESTS_DIR)) this.refreshTestFramework();
		if (edited === undefined || edited === COMPILE_FLAGS) {
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
		return { files, folders: this.folders, open: this.open.filter((p) => p in files), active: this.active, ...(this.runOptionsChosen ? { runOptions: { ...this.runOptions } } : {}), ...(this.chosenLevel ? { optimization: this.chosenLevel } : {}), ...(isCFamily(this.language) && !this.clangTidy ? { clangTidy: false as const } : {}) };
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
