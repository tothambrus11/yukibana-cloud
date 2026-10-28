// What a snippet's status line says (src/status.ts), for every state a run
// can be in.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statusOf } from '../src/status.ts';

const titleOf = (snippet) => ({ greet: 'Greeting', forever: 'A loop that never ends' })[snippet] ?? snippet;

test('a queued snippet names the snippet it waits for by its title, and offers to stop it', () => {
	assert.deepEqual(statusOf({ kind: 'queued', behind: { snippet: 'forever', waitingForInput: false } }, titleOf), {
		text: 'Waiting for “A loop that never ends” to finish.',
		stoppable: 'forever',
		final: false,
	});
});

test('a queued snippet says when the one it waits for is waiting for input, so the reader knows typing or stopping it will free the runner', () => {
	assert.equal(statusOf({ kind: 'queued', behind: { snippet: 'greet', waitingForInput: true } }, titleOf).text, 'Waiting for “Greeting”, which is waiting for input.');
});

test('the compiler download is shown in megabytes, with its total when the server says it', () => {
	assert.equal(statusOf({ kind: 'loading', progress: { label: 'Hylo compiler', loaded: 3_500_000, total: 14_000_000 } }, titleOf).text, 'Loading the Hylo compiler: 3.5 MB of 14.0 MB…');
	assert.equal(statusOf({ kind: 'loading', progress: { label: 'Hylo compiler', loaded: 3_500_000, total: 0 } }, titleOf).text, 'Loading the Hylo compiler: 3.5 MB…');
	assert.equal(statusOf({ kind: 'loading', progress: null }, titleOf).text, 'Starting the runner…');
});

test('a running snippet shows its phase, and says when it waits for input', () => {
	assert.equal(statusOf({ kind: 'running', phase: 'Compiling', waiting: false }, titleOf).text, 'Compiling…');
	assert.equal(statusOf({ kind: 'running', phase: 'Running', waiting: true }, titleOf).text, 'Running: waiting for input.');
});

test('a finished run says how it ended and how long it took, and offers nothing to stop', () => {
	assert.deepEqual(statusOf({ kind: 'ended', code: 42, seconds: 0.31 }, titleOf), { text: 'Exited with code 42 after 0.3 s.', stoppable: null, final: true });
	assert.equal(statusOf({ kind: 'stopped', seconds: 2 }, titleOf).text, 'Stopped after 2.0 s.');
	assert.equal(statusOf({ kind: 'failed', failure: { kind: 'load', reason: 'Could not load the runner.', url: null }, seconds: 1 }, titleOf).text, 'Could not load the runner.');
	assert.equal(statusOf({ kind: 'unavailable', problem: { kind: 'isolation', reason: 'This page cannot run it.' } }, titleOf).final, true);
});
