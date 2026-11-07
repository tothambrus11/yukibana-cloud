/**
 * A small Debug Adapter Protocol client of lldb-dap, which runs in a
 * worker of its own (packs/lldb, `debugger.js`), and the state a debugger
 * panel shows of it: where the program stopped, its call stack, the
 * variables of the selected frame. Framework-free: `useDebug` subscribes to
 * it. It is the article's copy of what Light's app has
 * (light/app/src/lib/debug.svelte.ts), since @yukibana/runtime has no DAP
 * client of its own yet; the protocol it speaks to the worker is the lldb
 * pack's (packs/lldb/README.md, "How it fits together").
 *
 * This module is loaded on the first Debug (`useDebug` imports it), so a
 * page that never debugs downloads none of it.
 *
 * A session is one debugged run. `start` starts the debugger's worker,
 * which hands back the channel its LLDB listens on; the host runs the
 * project with that channel (std's `debug` token), the runner posts the
 * program as linked, and that is when `attach` tells LLDB to attach. The
 * program waits at its first statement until the breakpoints are set
 * (DAP's `configurationDone`), then runs to the first one.
 */
import type { DebugChannel, DebugProgram } from '@yukibana/protocol';

/** The directory a project's files are compiled in, as the program's debug info names them (packs/cpp, packs/swift). */
const ROOT = '/workspace/';

/** One frame of the call stack. */
export interface Frame {
	/** DAP's id of the frame, for its scopes. */
	readonly id: number;
	/** The function, as LLDB names it (demangled). */
	readonly name: string;
	/** The project file it is in, or null for one of the toolchain's (libc++) or none. */
	readonly path: string | null;
	/** The line, from 1. */
	readonly line: number;
}

/** A variable, or a scope ("Locals"), whose children are fetched when it is opened. */
export interface Variable {
	/** Its name. */
	readonly name: string;
	/** Its value as LLDB prints it (`{...}` for an aggregate). */
	readonly value: string;
	/** Its type as LLDB names it; '' for a scope. */
	readonly type: string;
	/** Nonzero: it has children, fetched with this reference (`expand`). */
	readonly ref: number;
}

/** Where a session is. */
export type DebugStatus =
	/** No session. */
	| { readonly kind: 'idle' }
	/** Loading LLDB, building, attaching; `text` says which. */
	| { readonly kind: 'starting'; readonly text: string }
	/** The program runs. */
	| { readonly kind: 'running' }
	/** The program is stopped; `reason` as DAP says it (breakpoint, step, pause, exception, entry). */
	| { readonly kind: 'stopped'; readonly reason: string; readonly description: string }
	/** The session is over; `text` says how. */
	| { readonly kind: 'ended'; readonly text: string };

/** Everything a panel shows of a session, replaced as a whole at each change. */
export interface DebugView {
	/** Where the session is. */
	readonly status: DebugStatus;
	/** The call stack while stopped, innermost first; empty otherwise. */
	readonly frames: readonly Frame[];
	/** The frame whose variables are shown, an index into `frames`. */
	readonly selected: number;
	/** The selected frame's scopes. */
	readonly scopes: readonly Variable[];
	/** Children fetched so far, by reference (a scope's variables, an aggregate's members). */
	readonly children: Readonly<Record<number, readonly Variable[]>>;
	/** What LLDB said that is not the program's output, newest last. */
	readonly log: readonly string[];
}

/** What a session asks of the page around it. */
export interface DebugHost {
	/** Starts the run with the debugger's channel (std's `debug`). */
	run(channel: DebugChannel): void;
	/** Stops the run, if it is still going. */
	stopRun(): void;
	/** The breakpoints to set, by project path: lines from 1. */
	breakpoints(): Readonly<Record<string, readonly number[]>>;
}

/** A DAP message as the client reads it; every field checked where read. */
interface Message {
	readonly type: string;
	readonly command: string;
	readonly event: string;
	readonly requestSeq: number;
	readonly success: boolean;
	readonly message: string;
	readonly body: Readonly<Record<string, unknown>>;
}

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const records = (v: unknown): readonly Readonly<Record<string, unknown>>[] => (Array.isArray(v) ? v.filter(isRecord) : []);

/** Returns `data` as a DAP message, or null when it is none: the one place the worker's DAP traffic is trusted. */
function messageOf(data: unknown): Message | null {
	if (!isRecord(data) || typeof data['type'] !== 'string') return null;
	return {
		type: data['type'],
		command: str(data['command']),
		event: str(data['event']),
		requestSeq: num(data['request_seq']),
		success: data['success'] === true,
		message: str(data['message']),
		body: isRecord(data['body']) ? data['body'] : {},
	};
}

/** Returns `data` as the debugger's channel, or null when it is not one (a SharedArrayBuffer and an address). */
function channelOf(data: unknown): DebugChannel | null {
	if (!isRecord(data)) return null;
	const buffer = data['buffer'];
	const address = data['address'];
	return buffer instanceof SharedArrayBuffer && typeof address === 'number' ? { buffer, address } : null;
}

function variableOf(v: Readonly<Record<string, unknown>>): Variable {
	return { name: str(v['name']), value: str(v['value']), type: str(v['type']), ref: num(v['variablesReference']) };
}

const IDLE: DebugView = { status: { kind: 'idle' }, frames: [], selected: 0, scopes: [], children: {}, log: [] };

interface Pending {
	readonly resolve: (body: Readonly<Record<string, unknown>>) => void;
	readonly reject: (error: Error) => void;
}

/**
 * One page's debugger of one widget: at most one session at a time, a new
 * `start` ending the previous one.
 *
 * Invariant: `view` changes only by replacement, and every listener is
 * told after each replacement.
 */
export class Debugger {
	#view: DebugView = IDLE;
	readonly #listeners = new Set<() => void>();
	#worker: Worker | null = null;
	#seq = 1;
	readonly #pending = new Map<number, Pending>();
	#host: DebugHost | null = null;
	#thread = 1;
	#initialized: (() => void) | null = null;
	/** Which session the worker's messages belong to; a replaced one's are dropped. */
	#generation = 0;

	/** Where the lldb pack's worker is. */
	readonly url: URL;

	/** Makes the debugger of a page whose lldb pack's worker is at `url` (`<packs>lldb/debugger.js`). */
	constructor(url: URL) {
		this.url = url;
	}

	/** What a panel shows now. */
	get view(): DebugView {
		return this.#view;
	}

	/** Calls `listener` after every change of `view`; returns the unsubscribe. */
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => void this.#listeners.delete(listener);
	}

	/** `true` iff a session is starting, running or stopped. */
	get active(): boolean {
		const kind = this.#view.status.kind;
		return kind === 'starting' || kind === 'running' || kind === 'stopped';
	}

	/** Starts a session: the debugger's worker, then, once LLDB is ready, the run (`host.run`). */
	start(host: DebugHost): void {
		this.end(false);
		this.#host = host;
		const generation = ++this.#generation;
		this.#set({ ...IDLE, status: { kind: 'starting', text: 'Loading the debugger' } });
		let worker: Worker;
		try {
			worker = new Worker(this.url, { type: 'module' });
		} catch (error) {
			this.#finish(`The debugger could not start: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		this.#worker = worker;
		worker.onerror = (event) => {
			if (generation !== this.#generation) return;
			event.preventDefault();
			this.#say(event.message ? `The debugger failed: ${event.message}` : `The debugger's worker did not load from ${this.url.href}: is the lldb pack installed?`);
			this.#finish('The debugger failed to load; the log says why.');
		};
		worker.onmessage = ({ data }: MessageEvent<unknown>) => {
			if (generation !== this.#generation || !isRecord(data)) return;
			switch (data['type']) {
				case 'loading':
					this.#set({ ...this.#view, status: { kind: 'starting', text: `Loading the debugger (${Math.round((num(data['loaded']) / Math.max(1, num(data['total']))) * 100)}%)` } });
					return;
				case 'ready': {
					const channel = channelOf(data['channel']);
					if (channel === null) {
						this.#say('The debugger said it was ready without a channel.');
						this.#finish('The debugger failed; the log says why.');
						return;
					}
					this.#set({ ...this.#view, status: { kind: 'starting', text: 'Building the program with debug information' } });
					host.run(channel);
					return;
				}
				case 'dap': {
					const message = messageOf(data['message']);
					if (message !== null) this.#receive(message);
					return;
				}
				case 'log':
					this.#say(str(data['text']).replace(/\n$/, ''));
					return;
				case 'exit':
					this.#finish('The debugger ended.');
					return;
			}
		};
	}

	/**
	 * Hands LLDB the runner's program, as linked, and attaches to the stub,
	 * which holds the program at its first statement until the breakpoints
	 * are set; then lets it run.
	 */
	async attach(program: DebugProgram): Promise<void> {
		const worker = this.#worker;
		if (worker === null || this.#view.status.kind !== 'starting') return;
		this.#set({ ...this.#view, status: { kind: 'starting', text: 'Attaching' } });
		worker.postMessage({ type: 'file', path: program.name, bytes: program.wasm });
		try {
			await this.#request('initialize', { clientID: 'yukibana-react-explorer', clientName: 'Yukibana React explorer', adapterID: 'lldb-dap', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path', supportsVariableType: true });
			const initialized = new Promise<void>((resolve) => (this.#initialized = resolve));
			const attached = this.#request('attach', {
				program: program.name,
				attachCommands: ['process connect --plugin wasm yukibana://'],
				// Steps into the project's code only, as LLDB does for std:: by default.
				initCommands: ['settings set target.process.thread.step-avoid-libraries true'],
			});
			// lldb-dap says `initialized` once the target exists, which is when breakpoints can be set.
			await Promise.race([initialized, attached]);
			await this.#sendBreakpoints();
			await this.#request('configurationDone', {});
			await attached;
			if (this.#view.status.kind === 'starting') this.#set({ ...this.#view, status: { kind: 'running' } });
		} catch (error) {
			this.#say(`The debugger could not attach: ${error instanceof Error ? error.message : String(error)}`);
			this.#finish('The debugger could not attach to the program; the log says why.');
			this.#host?.stopRun();
		}
	}

	/** The run ended without a program to debug (it did not compile): the session ends, saying so. */
	noProgram(): void {
		if (this.#view.status.kind === 'starting') this.#finish('The program did not build; its output says why.');
	}

	/** The breakpoints of `path` changed: sent at once to a session past attaching. */
	breakpointsChanged(path: string): void {
		const kind = this.#view.status.kind;
		if (kind === 'running' || kind === 'stopped') void this.#sendBreakpoints([path]).catch(() => {});
	}

	/** Continues to the next breakpoint or the end. */
	continue(): void {
		this.#resume('continue');
	}
	/** Steps over the current line. */
	next(): void {
		this.#resume('next');
	}
	/** Steps into the call on the current line. */
	stepIn(): void {
		this.#resume('stepIn');
	}
	/** Runs until the current function returns. */
	stepOut(): void {
		this.#resume('stepOut');
	}

	/** Shows the variables of frame `index` of the call stack. */
	async select(index: number): Promise<void> {
		const frame = this.#view.frames[index];
		if (frame === undefined) return;
		this.#set({ ...this.#view, selected: index });
		const body = await this.#request('scopes', { frameId: frame.id }).catch(() => null);
		const scopes = records(body?.['scopes']).map((s) => ({ name: str(s['name']), value: '', type: '', ref: num(s['variablesReference']) }));
		this.#set({ ...this.#view, scopes });
		// Locals open at once, as in an IDE; the other scopes on demand.
		const locals = scopes.find((s) => /local/i.test(s.name)) ?? scopes[0];
		if (locals !== undefined) await this.expand(locals.ref);
	}

	/** Fetches the children of reference `ref` (a scope's variables, an aggregate's members), once. */
	async expand(ref: number): Promise<void> {
		if (ref === 0 || ref in this.#view.children) return;
		const body = await this.#request('variables', { variablesReference: ref }).catch(() => null);
		this.#set({ ...this.#view, children: { ...this.#view.children, [ref]: records(body?.['variables']).map(variableOf) } });
	}

	/** Ends the session and the program; `say` leaves "Stopped." in the panel, else it goes idle. */
	end(say = true): void {
		if (this.#worker === null) return;
		// lldb-dap would end the program itself, but it may be the one stuck.
		this.#host?.stopRun();
		this.#finish(say ? 'Stopped.' : '');
	}

	#resume(command: 'continue' | 'next' | 'stepIn' | 'stepOut'): void {
		if (this.#view.status.kind !== 'stopped') return;
		this.#set({ ...this.#view, status: { kind: 'running' }, children: {} });
		void this.#request(command, { threadId: this.#thread }).catch((error: unknown) => this.#say(`${command}: ${error instanceof Error ? error.message : String(error)}`));
	}

	async #sendBreakpoints(only?: readonly string[]): Promise<void> {
		const all = this.#host?.breakpoints() ?? {};
		for (const path of only ?? Object.keys(all)) {
			const lines = all[path] ?? [];
			await this.#request('setBreakpoints', { source: { name: path.split('/').pop(), path: ROOT + path }, breakpoints: lines.map((line) => ({ line })) });
		}
	}

	async #stopped(body: Readonly<Record<string, unknown>>): Promise<void> {
		this.#thread = num(body['threadId']) || this.#thread;
		const reason = str(body['reason']) || 'pause';
		const description = str(body['description']) || str(body['text']);
		const trace = await this.#request('stackTrace', { threadId: this.#thread, startFrame: 0, levels: 200 }).catch(() => null);
		const frames = records(trace?.['stackFrames']).map((f): Frame => {
			const source = isRecord(f['source']) ? f['source'] : {};
			const file = str(source['path']);
			return { id: num(f['id']), name: str(f['name']), path: file.startsWith(ROOT) ? file.slice(ROOT.length) : null, line: num(f['line']) };
		});
		this.#set({ ...this.#view, status: { kind: 'stopped', reason, description }, frames, children: {}, scopes: [] });
		// The innermost frame of the project's: a stop in a library shows where the project called it.
		await this.select(Math.max(0, frames.findIndex((f) => f.path !== null)));
	}

	#receive(message: Message): void {
		if (message.type === 'response') {
			const pending = this.#pending.get(message.requestSeq);
			if (pending === undefined) return;
			this.#pending.delete(message.requestSeq);
			if (message.success) pending.resolve(message.body);
			else pending.reject(new Error(message.message || `${message.command} failed`));
			return;
		}
		if (message.type !== 'event') return;
		const body = message.body;
		switch (message.event) {
			case 'initialized':
				this.#initialized?.();
				this.#initialized = null;
				return;
			case 'stopped':
				void this.#stopped(body);
				return;
			case 'continued':
				if (this.#view.status.kind === 'stopped') this.#set({ ...this.#view, status: { kind: 'running' } });
				return;
			case 'output': {
				// The program's own output reaches the page from its runner; what LLDB says goes to the log.
				const category = str(body['category']);
				if (category !== 'stdout' && category !== 'stderr') this.#say(str(body['output']).replace(/\n$/, ''));
				return;
			}
			case 'exited':
				this.#finish(`The program exited with code ${num(body['exitCode'])}.`);
				return;
			case 'terminated':
				if (this.active) this.#finish('The debugging session ended.');
				return;
		}
	}

	#request(command: string, args: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>> {
		const worker = this.#worker;
		if (worker === null) return Promise.reject(new Error('the debugger is not running'));
		const seq = this.#seq++;
		worker.postMessage({ type: 'dap', message: { seq, type: 'request', command, arguments: args } });
		return new Promise((resolve, reject) => this.#pending.set(seq, { resolve, reject }));
	}

	#say(text: string): void {
		if (text !== '') this.#set({ ...this.#view, log: [...this.#view.log.slice(-199), text] });
	}

	#finish(text: string): void {
		this.#generation++;
		this.#worker?.terminate();
		this.#worker = null;
		for (const pending of this.#pending.values()) pending.reject(new Error('the debugger ended'));
		this.#pending.clear();
		this.#set({ ...IDLE, log: this.#view.log, status: text === '' ? { kind: 'idle' } : { kind: 'ended', text } });
	}

	#set(view: DebugView): void {
		this.#view = view;
		for (const listener of [...this.#listeners]) listener();
	}
}
