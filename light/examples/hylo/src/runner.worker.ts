/**
 * The Hylo runner worker as the page bundles it: `import HyloRunnerWorker
 * from './runner.worker.ts?worker'` (source.ts). It starts hylo-wasm's own
 * compiler and program workers, which Vite bundles beside it from the same
 * `?worker` imports, and serves the page's protocol with {@link HyloRunner}.
 *
 * No pack URL, pack.json or locator is involved: the host built this
 * worker with its page (a host-built source, RR1 in the architecture plan),
 * and its needs are declared beside it, in source.ts.
 */
import CompilerWorker from '@hylo-lang/hylo-wasm/compiler-worker?worker';
import ProgramWorker from '@hylo-lang/hylo-wasm/program-worker?worker';
import { serveRunner } from './serve.ts';

serveRunner({ compiler: () => new CompilerWorker(), program: () => new ProgramWorker() });
