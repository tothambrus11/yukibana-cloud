/**
 * The fixture page (fixture.html): snippets on Hylo's runner whose program
 * worker is the stand-in that reads input (program.worker.ts), for what
 * today's Hylo programs cannot do. Not a page for readers.
 */
import { mountPage } from '../page.ts';
import { READING_REQUIRES, hostBuiltSource } from '../source.ts';
import { countRunners } from '../started.ts';
import ReadingRunnerWorker from './runner.worker.ts?worker';

mountPage(hostBuiltSource('Hylo (reading stand-in)', () => new ReadingRunnerWorker(), READING_REQUIRES, countRunners()));
