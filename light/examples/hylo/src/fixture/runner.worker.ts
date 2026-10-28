/**
 * The fixture page's runner: Hylo's runner with the real compiler worker
 * and, in place of hylo-wasm's program worker, the stand-in that reads
 * input (program.worker.ts). Bundled with `?worker` like the real one.
 */
import CompilerWorker from '@hylo-lang/hylo-wasm/compiler-worker?worker';
import { serveRunner } from '../serve.ts';
import ReadingProgramWorker from './program.worker.ts?worker';

serveRunner({ compiler: () => new CompilerWorker(), program: () => new ReadingProgramWorker() });
