/**
 * A stand-in for a Hylo program that reads its input, which today's Hylo
 * cannot be written as: its standard library has no reading or printing
 * (README.md, "What the spike found"). The fixture page (fixture.html)
 * runs it in place of hylo-wasm's program worker, behind the real compiler,
 * so that a snippet can wait for input on a real page and the plan's
 * "a snippet waiting on stdin tells a queued snippet why it waits, and
 * stopping it keeps the compiler worker" is checked in a browser, through
 * the same runner (hylo-runner.ts) and the same nested-worker shape.
 *
 * Every program it is given first asks for a name and greets each line it
 * reads; at end of file (Ctrl-D) it runs the executable the compiler made,
 * with hylo-wasm's own `run`, and exits as that program does. It reads
 * with protocol/stdin.ts's `readStdin`, which blocks this worker, not the
 * runner, which stays free to take a `cancel`.
 */
import { run } from '@hylo-lang/hylo-wasm';
import { readStdin } from '@yukibana/protocol';
import type { ProgramMessage, ProgramRequest } from '../hylo-runner.ts';

const scope = globalThis as unknown as { postMessage(message: ProgramMessage): void; onmessage: ((event: MessageEvent<ProgramRequest>) => void) | null };

scope.onmessage = async ({ data: { id, executable, input } }) => {
	scope.postMessage({ type: 'stdout', id, text: 'What is your name?\n' });
	for (;;) {
		const bytes = input === null ? null : readStdin(input, () => scope.postMessage({ type: 'stdin', id }));
		if (bytes === null) break;
		scope.postMessage({ type: 'stdout', id, text: `Hello, ${new TextDecoder().decode(bytes).trimEnd()}!\n` });
	}
	try {
		scope.postMessage({ type: 'ran', id, execution: await run(executable) });
	} catch (thrown) {
		scope.postMessage({ type: 'failed', id, error: thrown instanceof Error ? thrown.message : String(thrown) });
	}
};
