/**
 * Puts a {@link HyloRunner} in the worker this module runs in: the one
 * place that touches the worker's global scope, shared by the runner the
 * page uses (runner.worker.ts) and the fixture page's runner whose program
 * worker reads input (fixture/runner.worker.ts), which differ only in the
 * program worker they start.
 */
import { HyloRunner, type Port } from './hylo-runner.ts';

/** The worker's global scope, as far as a runner uses it. */
interface WorkerScope {
	postMessage(message: unknown): void;
	onmessage: ((event: MessageEvent) => void) | null;
	reportError(error: unknown): void;
}

/**
 * Serves the page's runner protocol from this worker, with a compiler and
 * program workers made by `workers`. A failure the runner cannot recover
 * from is raised as the worker's error, which the page's session reports
 * by name and answers by terminating this worker; from then on this
 * worker answers nothing.
 */
export function serveRunner(workers: { compiler: () => Port; program: () => Port }): void {
	const scope = globalThis as unknown as WorkerScope;
	let failed = false;
	const runner = new HyloRunner({
		post: (message) => {
			if (!failed) scope.postMessage(message);
		},
		compiler: workers.compiler,
		program: workers.program,
		fail: (reason) => {
			if (failed) return;
			failed = true;
			scope.reportError(new Error(reason));
		},
	});
	scope.onmessage = (event) => {
		if (!failed) runner.receive(event.data);
	};
}
