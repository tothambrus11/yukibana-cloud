/**
 * The docs page (index.html): its snippets run on Hylo's runner, one for
 * the whole page, and the page says how many runners it has started.
 */
import { mountPage } from './page.ts';
import HyloRunnerWorker from './runner.worker.ts?worker';
import { HYLO_REQUIRES, hostBuiltSource } from './source.ts';
import { countRunners } from './started.ts';

mountPage(hostBuiltSource('Hylo', () => new HyloRunnerWorker(), HYLO_REQUIRES, countRunners()));
