/**
 * The debugger, as the app shows it: a small Debug Adapter Protocol client
 * of lldb-dap, which runs in a worker of its own (packs/lldb, debugger.js),
 * and the state the Debug panel and the editors show of it: where the
 * program stopped, its call stack, the variables of the selected frame and
 * the project's breakpoints.
 *
 * A session is one debugged run. `start` starts the debugger's worker,
 * which hands back the channel its LLDB listens on; the run goes to the
 * language's runner with that channel (Runner.start's `debug`), the runner
 * posts the program as linked, and that is when LLDB is told to attach.
 * The program waits at its first statement until the breakpoints are set
 * (DAP's configurationDone), then runs to the first one.
 */
import type { DebugChannel, DebugProgram } from '@yukibana/protocol';

/** The workspace path of a project file in the program's debug info (packs/cpp: compiled in /workspace). */
const ROOT = '/workspace/';

/** Where the debugger's worker is: beside the page, as every pack (packs.ts). */
const debuggerUrl = (): URL => new URL('packs/lldb/debugger.js', document.baseURI);

/** One frame of the call stack, as the panel shows it. */
export interface Frame {
	id: number;
	/** The function, as LLDB names it (demangled). */
	name: string;
	/** The project file it is in, or null for a file of the toolchain's (libc++) or none. */
	path: string | null;
	/** The file as the debug info names it, for a frame outside the project. */
	file: string | null;
	line: number;
}

/** A variable, or a scope ("Locals"), whose children are fetched when it is opened. */
export interface Variable {
	name: string;
	value: string;
	type: string;
	/** Nonzero: it has children, fetched with this. */
	ref: number;
}

export type DebugStatus =
	/** No session. */
	| { kind: 'idle' }
	/** Loading LLDB, building, attaching. */
	| { kind: 'starting'; text: string }
	| { kind: 'running' }
	/** `reason` as DAP says it: breakpoint, step, pause, exception, entry. */
	| { kind: 'stopped'; reason: string; description: string }
	| { kind: 'ended'; text: string };

/** What a session asks of the app around it. */
export interface DebugHost {
	/** Starts the run with the channel (Runner.start's `debug`). */
	run(channel: DebugChannel): void;
	/** Stops the run, if it is still going. */
	stopRun(): void;
	/** Shows a project file at a line: the frame the user picked, or where the program stopped. */
	reveal(path: string, line: number): void;
	/** A line for the Log panel: everything LLDB says, its warnings among them. */
	log(text: string): void;
}

interface Pending {
	resolve(body: unknown): void;
	reject(error: Error): void;
}

type Message = { type: string; seq?: number; command?: string; event?: string; request_seq?: number; success?: boolean; message?: string; body?: Record<string, unknown> };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export class Debugger {
	status = $state<DebugStatus>({ kind: 'idle' });
	frames = $state<Frame[]>([]);
	/** The frame whose variables are shown, an index into `frames`. */
	selected = $state(0);
	/** The selected frame's scopes, each with its variables once opened. */
	scopes = $state<Variable[]>([]);
	/** Children fetched so far, by reference. */
	children = $state<Record<number, Variable[]>>({});
	/** Breakpoints, by project path: 1-based lines. Kept from one session to the next. */
	breakpoints = $state<Record<string, number[]>>({});

	#worker: Worker | null = null;
	#seq = 1;
	#pending = new Map<number, Pending>();
	#host: DebugHost | null = null;
	#thread = 1;
	/** Resolves the wait for lldb-dap's `initialized` event. */
	#initialized: (() => void) | null = null;
	/** Which session the worker's messages belong to; a replaced one's are dropped. */
	#generation = 0;

	constructor(private readonly makeWorker: () => Worker = () => new Worker(debuggerUrl(), { type: 'module' })) {}

	get active(): boolean {
		const kind = this.status.kind;
		return kind === 'starting' || kind === 'running' || kind === 'stopped';
	}

	/** The line the program is stopped at in `path` (the selected frame's), or null. */
	stoppedLine(path: string): number | null {
		if (this.status.kind !== 'stopped') return null;
		const frame = this.frames[this.selected];
		return frame && frame.path === path ? frame.line : null;
	}

	/** Starts a session: the debugger's worker, then the run (`host.run`). */
	start(host: DebugHost): void {
		this.end(false);
		this.#host = host;
		const generation = ++this.#generation;
		this.status = { kind: 'starting', text: 'Loading the debugger' };
		this.frames = [];
		this.scopes = [];
		this.children = {};
		let worker: Worker;
		try {
			worker = this.makeWorker();
		} catch (e) {
			this.status = { kind: 'ended', text: `The debugger could not start: ${e instanceof Error ? e.message : String(e)}` };
			return;
		}
		this.#worker = worker;
		worker.onerror = (e) => {
			if (generation !== this.#generation) return;
			host.log(`The debugger failed: ${e.message || 'its worker did not load'}`);
			this.#finish('The debugger failed; see the Log panel.');
		};
		worker.onmessage = ({ data }: MessageEvent<unknown>) => {
			if (generation !== this.#generation || !isRecord(data)) return;
			switch (data['type']) {
				case 'loading':
					this.status = { kind: 'starting', text: `Loading the debugger (${Math.round((num(data['loaded']) / Math.max(1, num(data['total']))) * 100)}%)` };
					break;
				case 'ready':
					this.status = { kind: 'starting', text: 'Building the program' };
					host.run(data['channel'] as DebugChannel);
					break;
				case 'dap':
					if (isRecord(data['message'])) this.#receive(data['message'] as Message);
					break;
				case 'log':
					host.log(str(data['text']).replace(/\n$/, ''));
					break;
				case 'exit':
					this.#finish('The debugger ended.');
					break;
			}
		};
	}

	/**
	 * The runner's program, as linked: LLDB loads it and attaches to the
	 * stub, which holds the program at its first statement until the
	 * breakpoints are set.
	 */
	async attach(program: DebugProgram): Promise<void> {
		const worker = this.#worker;
		if (!worker || this.status.kind !== 'starting') return;
		this.status = { kind: 'starting', text: 'Attaching' };
		worker.postMessage({ type: 'file', path: program.name, bytes: program.wasm });
		try {
			await this.#request('initialize', {
				clientID: 'yukibana-light',
				clientName: 'Yukibana Light',
				adapterID: 'lldb-dap',
				linesStartAt1: true,
				columnsStartAt1: true,
				pathFormat: 'path',
				supportsVariableType: true,
			});
			const initialized = new Promise<void>((resolve) => (this.#initialized = resolve));
			const attached = this.#request('attach', {
				program: program.name,
				attachCommands: ['process connect --plugin wasm yukibana://'],
				// Steps into the project's code only, as LLDB does for std:: (its default).
				initCommands: ['settings set target.process.thread.step-avoid-libraries true'],
			});
			// lldb-dap says `initialized` once the target exists, which is
			// when breakpoints can be set (DAP's launch sequence).
			await Promise.race([initialized, attached]);
			await this.#sendBreakpoints();
			await this.#request('configurationDone', {});
			await attached;
			if (this.status.kind === 'starting') this.status = { kind: 'running' };
		} catch (e) {
			this.#host?.log(`The debugger could not attach: ${e instanceof Error ? e.message : String(e)}`);
			this.#finish('The debugger could not attach to the program; see the Log panel.');
			this.#host?.stopRun();
		}
	}

	/** Turns the breakpoint at `line` of `path` on or off; sent at once to a running session. */
	toggleBreakpoint(path: string, line: number): void {
		const lines = this.breakpoints[path] ?? [];
		const next = lines.includes(line) ? lines.filter((l) => l !== line) : [...lines, line].sort((a, b) => a - b);
		this.breakpoints = { ...this.breakpoints, [path]: next };
		if (this.active && this.status.kind !== 'starting') void this.#sendBreakpoints([path]).catch(() => {});
	}

	/** The breakpoints of a file that was renamed or deleted (`to` null) follow it. */
	moveBreakpoints(from: string, to: string | null): void {
		if (!(from in this.breakpoints)) return;
		const { [from]: lines, ...rest } = this.breakpoints;
		this.breakpoints = to && lines ? { ...rest, [to]: lines } : rest;
	}

	continue(): void {
		if (this.status.kind === 'stopped') this.#resume('continue');
	}
	next(): void {
		if (this.status.kind === 'stopped') this.#resume('next');
	}
	stepIn(): void {
		if (this.status.kind === 'stopped') this.#resume('stepIn');
	}
	stepOut(): void {
		if (this.status.kind === 'stopped') this.#resume('stepOut');
	}
	pause(): void {
		if (this.status.kind === 'running') void this.#request('pause', { threadId: this.#thread }).catch(() => {});
	}

	/** Picks a frame of the call stack: its variables are shown, and its line. */
	async select(index: number): Promise<void> {
		const frame = this.frames[index];
		if (!frame) return;
		this.selected = index;
		if (frame.path) this.#host?.reveal(frame.path, frame.line);
		await this.#loadScopes(frame.id);
	}

	/** Fetches a variable's children (or a scope's variables), once. */
	async expand(ref: number): Promise<void> {
		if (ref === 0 || ref in this.children) return;
		const body = await this.#request('variables', { variablesReference: ref }).catch(() => null);
		const list = isRecord(body) && Array.isArray(body['variables']) ? body['variables'] : [];
		this.children = { ...this.children, [ref]: list.filter(isRecord).map(variableOf) };
	}

	/**
	 * Runs `expression` in LLDB's console (DAP `evaluate`, context `repl`)
	 * in the selected frame: an LLDB command, or a variable's name. Resolves
	 * to what LLDB answered, or rejects with its error.
	 */
	async evaluate(expression: string): Promise<string> {
		const frame = this.frames[this.selected];
		const body = await this.#request('evaluate', { expression, context: 'repl', ...(frame ? { frameId: frame.id } : {}) });
		return isRecord(body) ? str(body['result']) : '';
	}

	/** Ends the session and the program; `say` leaves a word in the panel. */
	end(say = true): void {
		const worker = this.#worker;
		if (!worker) return;
		// lldb-dap would end the program itself, but it may be the one stuck.
		this.#host?.stopRun();
		this.#finish(say ? 'Stopped.' : '');
	}

	async #resume(command: 'continue' | 'next' | 'stepIn' | 'stepOut'): Promise<void> {
		this.status = { kind: 'running' };
		this.children = {};
		await this.#request(command, { threadId: this.#thread }).catch((e: unknown) => this.#host?.log(`${command}: ${e instanceof Error ? e.message : String(e)}`));
	}

	async #sendBreakpoints(paths: string[] = Object.keys(this.breakpoints)): Promise<void> {
		for (const path of paths) {
			const lines = this.breakpoints[path] ?? [];
			await this.#request('setBreakpoints', { source: { name: path.split('/').pop(), path: ROOT + path }, breakpoints: lines.map((line) => ({ line })) });
		}
	}

	async #stopped(body: Record<string, unknown>): Promise<void> {
		this.#thread = num(body['threadId']) || this.#thread;
		const reason = str(body['reason']) || 'pause';
		const description = str(body['description']) || str(body['text']);
		const trace = await this.#request('stackTrace', { threadId: this.#thread, startFrame: 0, levels: 200 }).catch(() => null);
		const frames = isRecord(trace) && Array.isArray(trace['stackFrames']) ? trace['stackFrames'].filter(isRecord) : [];
		this.frames = frames.map((f): Frame => {
			const source = isRecord(f['source']) ? f['source'] : {};
			const file = str(source['path']) || null;
			return { id: num(f['id']), name: str(f['name']), path: file?.startsWith(ROOT) ? file.slice(ROOT.length) : null, file, line: num(f['line']) };
		});
		this.status = { kind: 'stopped', reason, description };
		this.children = {};
		// The innermost frame of the project's: a stop in a library shows where the project called it.
		const first = Math.max(0, this.frames.findIndex((f) => f.path !== null));
		await this.select(first);
	}

	async #loadScopes(frameId: number): Promise<void> {
		const body = await this.#request('scopes', { frameId }).catch(() => null);
		const scopes = isRecord(body) && Array.isArray(body['scopes']) ? body['scopes'].filter(isRecord) : [];
		this.scopes = scopes.map((s) => ({ name: str(s['name']), value: '', type: '', ref: num(s['variablesReference']) }));
		// Locals open at once, as in an IDE; the other scopes on demand.
		const locals = this.scopes.find((s) => /local/i.test(s.name)) ?? this.scopes[0];
		if (locals) await this.expand(locals.ref);
	}

	#receive(message: Message): void {
		if (message.type === 'response') {
			const pending = this.#pending.get(message.request_seq ?? -1);
			if (!pending) return;
			this.#pending.delete(message.request_seq ?? -1);
			if (message.success) pending.resolve(message.body ?? {});
			else pending.reject(new Error(message.message || `${message.command} failed`));
			return;
		}
		if (message.type !== 'event') return;
		const body = message.body ?? {};
		switch (message.event) {
			case 'initialized':
				this.#initialized?.();
				this.#initialized = null;
				break;
			case 'stopped':
				void this.#stopped(body);
				break;
			case 'continued':
				if (this.status.kind === 'stopped') this.status = { kind: 'running' };
				break;
			case 'output': {
				const category = str(body['category']);
				const text = str(body['output']);
				// The program's own output reaches the terminal from its runner;
				// what LLDB says goes to the Log, its warnings too (the terminal
				// is the program's: "no plugin for the language swift" there
				// would read as the program's output).
				if (category === 'stdout' || category === 'stderr') break;
				this.#host?.log(text.replace(/\n$/, ''));
				break;
			}
			case 'exited':
				this.#finish(`The program exited with code ${num(body['exitCode'])}.`);
				break;
			case 'terminated':
				if (this.active) this.#finish('The debugging session ended.');
				break;
		}
	}

	#request(command: string, args: Record<string, unknown>): Promise<unknown> {
		const worker = this.#worker;
		if (!worker) return Promise.reject(new Error('the debugger is not running'));
		const seq = this.#seq++;
		worker.postMessage({ type: 'dap', message: { seq, type: 'request', command, arguments: args } });
		return new Promise((resolve, reject) => this.#pending.set(seq, { resolve, reject }));
	}

	#finish(text: string): void {
		this.#generation++;
		this.#worker?.terminate();
		this.#worker = null;
		for (const pending of this.#pending.values()) pending.reject(new Error('the debugger ended'));
		this.#pending.clear();
		this.frames = [];
		this.scopes = [];
		this.children = {};
		this.status = text ? { kind: 'ended', text } : { kind: 'idle' };
	}
}

function variableOf(v: Record<string, unknown>): Variable {
	return { name: str(v['name']), value: str(v['value']), type: str(v['type']), ref: num(v['variablesReference']) };
}

/** What `decorate` needs of Monaco: passed in, so this module loads without it (the Node-run tests). */
interface MonacoLike {
	editor: { MouseTargetType: { GUTTER_GLYPH_MARGIN: number; GUTTER_LINE_NUMBERS: number } };
	Range: new (a: number, b: number, c: number, d: number) => unknown;
}

/**
 * Shows `dbg`'s breakpoints of the file `path` in `editor`'s glyph margin,
 * and the line the program is stopped at, and makes a click in the margin
 * (or F9) turn a breakpoint on or off. Kept in step with the session until
 * the returned function is called.
 */
export function decorate(
	editor: import('monaco-editor').editor.IStandaloneCodeEditor,
	path: string,
	dbg: Debugger,
	monaco: MonacoLike,
): () => void {
	const decorations = editor.createDecorationsCollection();
	const mouse = editor.onMouseDown((e) => {
		const type = e.target.type;
		if (type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
		const line = e.target.position?.lineNumber;
		if (line) dbg.toggleBreakpoint(path, line);
	});
	const stop = $effect.root(() => {
		$effect(() => {
			const lines = dbg.breakpoints[path] ?? [];
			const stopped = dbg.stoppedLine(path);
			const top = dbg.selected === 0;
			const range = (line: number) => new monaco.Range(line, 1, line, 1) as import('monaco-editor').IRange;
			decorations.set([
				...lines.map((line) => ({
					range: range(line),
					options: { glyphMarginClassName: 'debug-breakpoint', glyphMarginHoverMessage: { value: 'Breakpoint (click to remove)' }, stickiness: 1 },
				})),
				...(stopped !== null
					? [
							{
								range: range(stopped),
								options: {
									isWholeLine: true,
									className: top ? 'debug-stopped-line' : 'debug-frame-line',
									glyphMarginClassName: top ? 'debug-stopped' : 'debug-frame',
									stickiness: 1,
								},
							},
						]
					: []),
			]);
			if (stopped !== null) editor.revealLineInCenterIfOutsideViewport(stopped);
		});
	});
	return () => {
		stop();
		mouse.dispose();
		decorations.clear();
	};
}
