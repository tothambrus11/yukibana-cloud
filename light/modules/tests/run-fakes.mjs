// Stand-ins for what a run session touches: a clock with timers, a
// transport whose runners the test drives by hand, a Worker, and sources.
// Shared by run-session.test.mjs, run-pool.test.mjs and transport.test.mjs.

/** Timers that fire only when the test moves the clock. */
export function fakeClock() {
	let now = 0;
	let nextId = 1;
	const timers = new Map();
	return {
		now: () => now,
		timers: {
			set(callback, ms) {
				const id = nextId++;
				timers.set(id, { at: now + ms, callback });
				return id;
			},
			clear(id) {
				timers.delete(id);
			},
		},
		/** Moves the clock by `ms`, firing every timer due on the way, in order. */
		advance(ms) {
			const end = now + ms;
			for (;;) {
				const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
				if (due === undefined) break;
				timers.delete(due[0]);
				now = due[1].at;
				due[1].callback();
			}
			now = end;
		},
		get pending() {
			return timers.size;
		},
	};
}

/** Lets promise callbacks and microtasks (a session's `onfree`) run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A transport whose runners the test speaks for: `runners` holds every one
 * started, in order, each recording what it was sent and whether it was
 * terminated, with `post(...messages)` to deliver a batch and `fail(text)`
 * to raise an error.
 */
export function fakeTransport({ crossOriginIsolated = true, origin = 'https://docs.example' } = {}) {
	const runners = [];
	const transport = {
		name: 'fake',
		context: { origin, crossOriginIsolated },
		stdin: crossOriginIsolated,
		starts: 0,
		failNextStart: null,
		async start(source) {
			transport.starts += 1;
			if (transport.failNextStart !== null) {
				const error = transport.failNextStart;
				transport.failNextStart = null;
				throw error;
			}
			const runner = {
				source,
				sent: [],
				inputs: [],
				terminated: false,
				onmessages: null,
				onerror: null,
				onproblem: null,
				url: 'pack' in source ? new URL(`${source.pack.id}/runner.js`, source.locator.base) : null,
				send(message) {
					if (!runner.terminated) runner.sent.push(message);
				},
				input(line) {
					runner.inputs.push(line);
				},
				terminate() {
					runner.terminated = true;
				},
				post(...batch) {
					if (!runner.terminated) runner.onmessages?.(batch);
				},
				fail(text) {
					if (!runner.terminated) runner.onerror?.(text);
				},
				/** The run messages it was sent, without the cancels. */
				get runs() {
					return runner.sent.filter((m) => m.type !== 'cancel');
				},
				get cancels() {
					return runner.sent.filter((m) => m.type === 'cancel').length;
				},
			};
			runners.push(runner);
			return runner;
		},
		close() {},
	};
	return { transport, runners };
}

/** What a runner of these tests needs: input is optional, the packs may be anywhere. */
export const OPTIONAL_STDIN = { runner: { default: { crossOriginIsolated: 'optional-stdin', sameOriginPacks: false } } };

/** A runner a host bundled itself, as Hylo's site does. */
export function hostBuilt(name = 'Hylo', requires = OPTIONAL_STDIN) {
	return { name, worker: () => new FakeWorker(), requires };
}

/** A served pack whose locator answers `stillCurrent` with `currency` and counts every call. */
export function served({ id = 'cpp', name = 'C++', requires = OPTIONAL_STDIN, currency = 'current', base = 'https://light.example/packs/' } = {}) {
	const calls = { file: 0, packInfo: 0, stillCurrent: 0 };
	const locator = {
		base: new URL(base),
		calls,
		async file(pack, file) {
			calls.file += 1;
			return new URL(`${pack}/${file}`, base);
		},
		async packInfo() {
			calls.packInfo += 1;
			throw new Error('not used');
		},
		async stillCurrent() {
			calls.stillCurrent += 1;
			return currency;
		},
	};
	return { pack: { id, name, protocol: 1, build: 'b1', requires }, locator };
}

/** A run request of a one-file project. */
export const request = (type = 'run', text = 'print 1') => ({ type, files: { 'main.hylo': text }, entry: 'main.hylo' });

/** Every event a run is told, and its states alone. */
export function recorder() {
	const events = [];
	const listener = (event) => events.push(event);
	return {
		events,
		listener,
		get states() {
			return events.filter((e) => e.type === 'state').map((e) => e.state);
		},
		get state() {
			return this.states.at(-1);
		},
		/** The text of one stream, as a terminal would show it. */
		text(stream = 'stdout') {
			return events.filter((e) => e.type === 'output' && e.stream === stream).flatMap((e) => e.pieces).join('');
		},
	};
}

/** A Worker of the page, as far as the in-page transport uses one. */
export class FakeWorker {
	constructor(url = null, options = {}) {
		this.url = url;
		this.options = options;
		this.posted = [];
		this.terminated = false;
		this.listeners = { message: [], messageerror: [], error: [] };
	}
	addEventListener(type, listener) {
		this.listeners[type].push(listener);
	}
	removeEventListener(type, listener) {
		this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
	}
	postMessage(message) {
		this.posted.push(message);
	}
	terminate() {
		this.terminated = true;
	}
	/** The runner posts `data`. */
	emit(data) {
		for (const listener of this.listeners.message) listener({ data });
	}
	/** The worker raises an error; returns whether the transport kept it off the console. */
	raise(message) {
		let prevented = false;
		for (const listener of this.listeners.error) listener({ message, preventDefault: () => (prevented = true) });
		return prevented;
	}
	unreadable() {
		for (const listener of this.listeners.messageerror) listener({});
	}
}
