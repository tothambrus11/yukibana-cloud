// Stand-ins for the workers around Hylo's runner, so its rules are tested
// in Node in milliseconds: a compiler worker and program workers the test
// speaks for, and a runner worker that hosts the real HyloRunner in this
// thread, as the in-page transport sees a Worker.
import { HyloRunner } from '../src/hylo-runner.ts';

/** Lets queued messages and promise callbacks run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A Port (hylo-runner.ts) the test speaks for: `posted` holds what the
 * runner sent it, `say(data)` answers as the worker would, `terminated`
 * says whether the runner ended it.
 */
export class FakePort {
	constructor(kind) {
		this.kind = kind;
		this.posted = [];
		this.terminated = false;
		this.onmessage = null;
		this.onerror = null;
	}
	postMessage(message) {
		if (!this.terminated) this.posted.push(message);
	}
	terminate() {
		this.terminated = true;
	}
	say(data) {
		if (!this.terminated) this.onmessage?.({ data });
	}
	crash(message) {
		this.onerror?.({ message, preventDefault() {} });
	}
	/** The last request it was sent. */
	get last() {
		return this.posted.at(-1);
	}
}

/**
 * Every compiler and program worker any runner of a test made, in order,
 * with what each runner posted to the page and whether it failed.
 */
export function workshop() {
	const compilers = [];
	const programs = [];
	const host = () => {
		const posted = [];
		const failures = [];
		return {
			posted,
			failures,
			post: (message) => posted.push(message),
			compiler: () => {
				const port = new FakePort('compiler');
				compilers.push(port);
				return port;
			},
			program: () => {
				const port = new FakePort('program');
				programs.push(port);
				return port;
			},
			fail: (reason) => failures.push(reason),
		};
	};
	return { compilers, programs, host };
}

/**
 * The compiler worker answers request `request` (CompilerWorkerRequest):
 * an executable unless `diagnostics` holds an error, as hylo-wasm's does
 * with `run: false`.
 */
export function compiled(request, { diagnostics = [], error } = {}) {
	const failed = diagnostics.some((d) => d.level === 'error') || error !== undefined;
	const compilation = { diagnostics, artifacts: {}, milliseconds: 5, ...(error !== undefined ? { error } : {}) };
	return failed
		? { type: 'result', id: request.id, compilation, execution: null }
		: { type: 'result', id: request.id, compilation: { ...compilation, executableByteCount: 3 }, execution: null, executable: new Uint8Array([0, 97, 115]) };
}

/** A diagnostic as hylo-wasm reports one. */
export const diagnostic = (file, message) => ({
	level: 'error',
	message,
	file,
	site: { line: 1, column: 1, endLine: 1, endColumn: 2 },
	rendered: `hylo:///${file}:1.1-2: error: ${message}`,
	notes: [],
});

/**
 * A Worker of the page (as workerTransport uses one) whose inside is the
 * real HyloRunner over `host`. Messages each way are delivered on a later
 * task, as a worker's are.
 */
export class InPageRunnerWorker {
	constructor(host) {
		this.listeners = { message: [], messageerror: [], error: [] };
		this.terminated = false;
		this.host = host;
		this.runner = new HyloRunner({
			...host,
			post: (message) => {
				host.post(message);
				setTimeout(() => {
					if (!this.terminated) for (const listener of this.listeners.message) listener({ data: message });
				}, 0);
			},
			fail: (reason) => {
				host.fail(reason);
				setTimeout(() => {
					if (!this.terminated) for (const listener of this.listeners.error) listener({ message: reason, preventDefault() {} });
				}, 0);
			},
		});
	}
	addEventListener(type, listener) {
		this.listeners[type].push(listener);
	}
	removeEventListener(type, listener) {
		this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
	}
	postMessage(message) {
		setTimeout(() => {
			if (!this.terminated) this.runner.receive(message);
		}, 0);
	}
	terminate() {
		this.terminated = true;
	}
}
