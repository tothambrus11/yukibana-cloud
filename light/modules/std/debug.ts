/**
 * Running a program, or its tests, under the debugger: two tokens of one
 * shape, and the helper that makes a language's provider of one.
 *
 * A debugged run is a run (std/run.ts) whose message carries one more
 * field, the channel the debugger's LLDB listens on (packs/CONTRACT.md,
 * "Debugging"; protocol/runner.ts `RunMessage.debug`). The runner builds
 * the program with debug information, posts it as linked (a `debug` event)
 * and runs it under the stub. A provider made by `debugProvider` sends
 * exactly that message to the page's runner pool, and gives back the run's
 * handle and the program, for the host to hand its debugger.
 *
 * Two tokens and not one with a mode in its input: an availability is
 * asked of a token, never of an input, so one token could not offer Debug
 * for a language whose runner debugs only its program while refusing
 * Debug tests.
 */

import { defineToken, type Provider, type Token } from '../core/index.ts';
import type { DebugChannel, DebugProgram } from '../protocol/index.ts';
import type { RunEvent, RunHandle, SessionRequest } from '../runtime/index.ts';
import type { PackLanguage } from './language.ts';
import { runMessage, sourceOf, type RunAvailability, type RunHost, type RunInput } from './run.ts';

/**
 * What a debugged run is performed with: a run's input, and the channel of
 * the debugger the program is to talk to.
 *
 * Invariant: `channel` is the one the debugger's worker said it listens on
 * for this session; a runner given another would talk to the wrong LLDB.
 */
export interface DebugInput extends RunInput {
	/** Where the debugger's LLDB listens for the program's stub (packs/lldb/README.md). */
	readonly channel: DebugChannel;
}

/** A debugged run: its handle, as any run's, and the program the debugger loads. */
export interface DebugSession {
	/** The run, which the terminal shows and stops as it does any run. */
	readonly run: RunHandle;
	/**
	 * Resolves to the program as linked, with its DWARF, when the runner posts
	 * it, which is when the debugger is to attach; or to null when the run
	 * ends without posting one (it did not compile, or the runner cannot
	 * debug and ran it plainly). Never rejects.
	 */
	readonly program: Promise<DebugProgram | null>;
}

/** Runs the project's program under the debugger: a runner's `type: 'run'` with `debug`. */
export const debug: Token<DebugInput, DebugSession, 'one'> = /* @__PURE__ */ defineToken<DebugInput, DebugSession>()('@yukibana/std#debug');

/**
 * Builds and runs the project's tests under the debugger: a runner's
 * `type: 'test'` with `debug`. A provider of it requires `test` and `debug`
 * for the same language: a runner that debugs a program and runs tests
 * still need not debug its tests (Swift's runs them uninstrumented), so a
 * language says it by providing this token.
 */
export const debugTest: Token<DebugInput, DebugSession, 'one'> = /* @__PURE__ */ defineToken<DebugInput, DebugSession>()('@yukibana/std#debug-test');

/** What is debugged: the program (`run`) or the tests (`test`). */
export type DebugMode = 'run' | 'test';

/** Returns the token that debugs a project in `mode`. */
export function debugTokenOf(mode: DebugMode): Token<DebugInput, DebugSession, 'one'> {
	switch (mode) {
		case 'run':
			return debug;
		case 'test':
			return debugTest;
	}
}

/**
 * Which runner options a debugged run is sent: those of the input, as a
 * Run of the same project is sent them (`as-run`), or none (`none`).
 */
export type DebugOptions = 'as-run' | 'none';

/** When a debug provider can be performed, and what its runs are sent. */
export interface DebugAvailability extends RunAvailability {
	/**
	 * Whether the input's runner options go along. `none` for a runner that
	 * was never sent them for a debugged run (Swift's compiles it at -Onone
	 * whatever the level), so that its message stays the one it was.
	 */
	readonly options: DebugOptions;
}

/**
 * Returns the message a runner is sent to debug `input` in `mode`: the run
 * message of that mode (`runMessage`), without its options when `options`
 * is `none`, and with the debugger's channel as `debug`.
 */
export function debugMessage(mode: DebugMode, input: DebugInput, options: DebugOptions): SessionRequest {
	return { ...runMessage(mode, options === 'none' ? { ...input, options: null } : input), debug: input.channel };
}

/** `true` iff `event` ends the run it belongs to, however it ends. */
function ends(event: RunEvent): boolean {
	if (event.type !== 'state') return false;
	const kind = event.state.kind;
	return kind === 'ended' || kind === 'stopped' || kind === 'unavailable' || kind === 'failed';
}

/**
 * Returns `language`'s provider of the token of `mode` (`debugTokenOf`): an
 * eager one that hands the pool of its host the debug message
 * (`debugMessage`) for its pack (`sourceOf`), passes every event of the run
 * on to the input's `onEvent`, and resolves the session's `program` with
 * the run's `debug` event, or with null once the run ends without one.
 */
export function debugProvider(mode: DebugMode, language: PackLanguage, when: DebugAvailability): Provider<DebugInput, DebugSession, RunHost, 'one'> {
	return {
		token: debugTokenOf(mode),
		subject: { kind: 'language', id: language.key },
		entry: { kind: 'one' },
		requires: when.requires,
		available: when.available,
		body: {
			kind: 'eager',
			perform: (input, { host }) => {
				const { promise, resolve } = Promise.withResolvers<DebugProgram | null>();
				const onEvent = (event: RunEvent): void => {
					if (event.type === 'debug') resolve(event);
					else if (ends(event)) resolve(null);
					input.onEvent(event);
				};
				const run = host.pool.run({ snippet: input.snippet, source: sourceOf(language, host.packs, host.requires), request: debugMessage(mode, input, when.options), onEvent });
				return { run, program: promise };
			},
		},
	};
}
