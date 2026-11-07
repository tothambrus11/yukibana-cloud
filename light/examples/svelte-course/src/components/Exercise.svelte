<!--
@component
One graded exercise: its instructions, the student's file in an `<Editor>`,
Run with standard input, Check (the hidden tests through std's `test`
token, read into a checklist), Stop, and Show solution as a diff with Use
solution and Reset. Its runs go through the course's one instance
(`getCourse()`), named by the exercise's id in the page's runner pool.

The section carries what the end-to-end test reads: `id` (the exercise's),
`data-activity` (idle, running, checking), `data-verdict` (none, passed,
failed, broken) and `data-editor` on the editor.
-->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { getCourse } from '../lib/course.svelte.ts';
	import type { EditorHandle } from '../lib/editor.ts';
	import { ExerciseSession } from '../lib/exercise.svelte.ts';
	import type { ExerciseSpec } from '../lib/exercises.ts';
	import { segmentsOf } from '../lib/inline.ts';
	import Checklist from './Checklist.svelte';
	import DiffView from './DiffView.svelte';
	import Editor from './Editor.svelte';

	interface Props {
		/** The exercise. */
		spec: ExerciseSpec;
		/** Its number in the lesson, from 1. */
		number: number;
		/** Called once with its session, for a page that wants to drive it (the end-to-end test does, through `globalThis.course`). */
		onsession?: (session: ExerciseSession) => void;
	}

	let { spec, number, onsession }: Props = $props();

	const course = getCourse();
	// An exercise's spec is fixed for the component's life: its session is made once.
	const session = untrack(() => new ExerciseSession(course, spec));
	untrack(() => onsession?.(session));
	const entry = $derived(course.language(spec.language));
	const progress = $derived(course.progress[spec.id] ?? null);
	const lines = $derived(Math.min(24, Math.max(spec.starter.split('\n').length, spec.solution.split('\n').length) + 1));
	const busy = $derived(session.activity !== 'idle');
	const passing = $derived(session.checklist.filter((item) => item.outcome === 'passed').length);

	let stdin = $state(untrack(() => spec.stdin));
	let showSolution = $state(false);
	onDestroy(() => session.detach());

	function ready(editor: EditorHandle): void {
		session.attach(editor);
	}

	/** The card's badge: passed, the last score, or untried. */
	const badge = $derived(
		progress?.passed === true
			? { kind: 'passed', text: 'Passed' }
			: progress !== null && progress.total > 0
				? { kind: 'partial', text: `${progress.score} / ${progress.total}` }
				: { kind: 'new', text: 'Not checked yet' },
	);
</script>

<article class="exercise" id={spec.id} data-activity={session.activity} data-verdict={session.verdict} style:--lang={`var(--lang-${spec.language})`}>
	<header>
		<span class="number" aria-hidden="true">{String(number).padStart(2, '0')}</span>
		<div class="heading">
			<span class="tag">{entry.row.tag}</span>
			<h2>{spec.title}</h2>
		</div>
		<span class="badge {badge.kind}">{badge.text}</span>
	</header>

	<div class="instructions">
		{#each spec.instructions as paragraph, at (at)}
			<p>
				{#each segmentsOf(paragraph) as segment, index (index)}{#if segment.code}<code>{segment.text}</code>{:else}{segment.text}{/if}{/each}
			</p>
		{/each}
	</div>

	<div class="work">
		<div class="file">
			<div class="filebar"><span class="filename">{spec.file}</span><span class="langname">{entry.meta.label}</span></div>
			<Editor path={spec.file} text={session.initialText} hidden={spec.support} language={entry.row.monaco} label={`${spec.title}: ${spec.file}`} rows={lines} onready={ready} />
		</div>

		<aside class="side">
			<label class="stdin">
				<span>Standard input</span>
				<textarea bind:value={stdin} rows="4" spellcheck="false" class="stdin-text"></textarea>
			</label>
			<div class="buttons">
				<button class="run" disabled={session.runnable.kind === 'unavailable' || busy} title={session.runnable.kind === 'unavailable' ? session.runnable.reason : 'Run the program with this input'} onclick={() => session.run(stdin)}>
					<span aria-hidden="true">▶</span> Run
				</button>
				<button class="check primary" disabled={session.checkable.kind === 'unavailable' || busy} title={session.checkable.kind === 'unavailable' ? session.checkable.reason : 'Run the hidden tests'} onclick={() => session.check()}>
					<span aria-hidden="true">✓</span> Check
				</button>
				<button class="stop" disabled={!busy} onclick={() => session.stop()}>Stop</button>
			</div>
			<p class="status" role="status">{session.status}</p>
		</aside>
	</div>

	{#if session.output.length > 0}
		<pre class="output" aria-label="Output">{#each session.output as chunk, at (at)}<span class={chunk.stream}>{chunk.text}</span>{/each}</pre>
	{/if}

	<section class="checks" aria-label="Checks">
		<div class="checks-head">
			<h3>Checks</h3>
			<span class="score" data-verdict={session.verdict}>
				{#if session.verdict === 'passed'}All {session.checklist.length} pass. Well done.
				{:else if session.verdict === 'failed'}{passing} of {session.checklist.length} pass.
				{:else if session.verdict === 'broken'}The tests did not run to the end: the output says why.
				{:else if session.activity === 'checking'}Running the hidden tests…
				{:else}Press Check to run the hidden tests.{/if}
			</span>
		</div>
		<div class="meter" aria-hidden="true"><span style:width={`${(100 * passing) / Math.max(1, session.checklist.length)}%`}></span></div>
		<Checklist items={session.checklist} />
	</section>

	<footer>
		<button class="solution ghost" aria-expanded={showSolution} onclick={() => (showSolution = !showSolution)}>{showSolution ? 'Hide solution' : 'Show solution'}</button>
		<button class="reset ghost" onclick={() => session.reset()}>Reset to the starter</button>
	</footer>
	{#if showSolution}
		<div class="solution-panel">
			<DiffView before={session.text} after={spec.solution} file={spec.file} />
			<button class="use-solution" onclick={() => session.useSolution()}>Use the solution</button>
		</div>
	{/if}
</article>

<style>
	.exercise {
		position: relative;
		display: grid;
		gap: 18px;
		padding: 28px clamp(16px, 4vw, 36px) 24px;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 18px;
		box-shadow: var(--shadow);
		scroll-margin-top: 88px;
	}
	.exercise::before {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: 5px;
		border-radius: 18px 0 0 18px;
		background: var(--lang);
	}
	header {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 16px;
	}
	.number {
		font: 600 34px/1 var(--display);
		color: var(--lang);
		font-variant-numeric: tabular-nums;
	}
	.heading {
		display: grid;
		gap: 2px;
	}
	.tag {
		font: 600 11px/1 var(--mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--lang);
	}
	h2 {
		margin: 0;
		font: 600 clamp(20px, 3vw, 24px)/1.2 var(--display);
	}
	.badge {
		font-size: 12.5px;
		font-weight: 600;
		padding: 5px 10px;
		border-radius: 999px;
		white-space: nowrap;
		color: var(--muted);
		background: var(--panel);
	}
	.badge.passed {
		color: var(--on-pass);
		background: var(--pass);
	}
	.badge.partial {
		color: var(--warn);
		background: var(--warn-soft);
	}
	.instructions p {
		margin: 0 0 8px;
		max-width: 72ch;
		line-height: 1.6;
	}
	.instructions code,
	.filename {
		font: 0.9em var(--mono);
		padding: 1px 5px;
		border-radius: 5px;
		background: var(--panel);
	}
	.work {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 240px;
		gap: 16px;
		align-items: start;
	}
	.file {
		display: grid;
		gap: 6px;
		min-width: 0;
	}
	.filebar {
		display: flex;
		justify-content: space-between;
		font-size: 12.5px;
		color: var(--muted);
	}
	.side {
		display: grid;
		gap: 12px;
	}
	.stdin {
		display: grid;
		gap: 6px;
		font-size: 12.5px;
		color: var(--muted);
	}
	.stdin-text {
		box-sizing: border-box;
		width: 100%;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--code-bg);
		color: var(--ink);
		font: 13px/1.5 var(--mono);
		resize: vertical;
	}
	.stdin-text:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.buttons {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.buttons .stop {
		grid-column: 1 / -1;
	}
	button {
		font: 600 14px/1 var(--sans);
		padding: 10px 14px;
		border-radius: 10px;
		border: 1px solid var(--line-strong);
		background: var(--card);
		color: var(--ink);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			transform 80ms ease;
	}
	button:hover:not(:disabled) {
		background: var(--panel);
	}
	button:active:not(:disabled) {
		transform: translateY(1px);
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	button:focus-visible {
		outline: 3px solid var(--accent-soft);
		outline-offset: 1px;
	}
	button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	button.primary:hover:not(:disabled) {
		background: var(--accent-strong);
	}
	button.ghost {
		border-color: transparent;
		background: transparent;
		color: var(--accent-ink);
		padding: 8px 10px;
	}
	.status {
		margin: 0;
		min-height: 1.4em;
		font-size: 13px;
		color: var(--muted);
	}
	.output {
		margin: 0;
		max-height: 320px;
		overflow: auto;
		padding: 12px 14px;
		border-radius: var(--radius);
		background: var(--term-bg);
		color: var(--term-ink);
		font: 13px/1.5 var(--mono);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.output .stderr {
		color: var(--term-err);
	}
	.output .note {
		color: var(--term-note);
		font-style: italic;
	}
	.checks {
		display: grid;
		gap: 10px;
		padding: 16px;
		border-radius: 14px;
		background: var(--panel);
	}
	.checks-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 4px 16px;
	}
	h3 {
		margin: 0;
		font: 600 15px var(--sans);
		letter-spacing: 0.02em;
	}
	.score {
		font-size: 13.5px;
		color: var(--muted);
	}
	.score[data-verdict='passed'] {
		color: var(--pass-ink);
		font-weight: 600;
	}
	.score[data-verdict='broken'] {
		color: var(--warn);
	}
	.meter {
		height: 6px;
		border-radius: 999px;
		background: var(--line);
		overflow: hidden;
	}
	.meter span {
		display: block;
		height: 100%;
		background: var(--pass);
		border-radius: inherit;
		transition: width 400ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	footer {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin: -6px 0 0 -10px;
	}
	.solution-panel {
		display: grid;
		gap: 10px;
		justify-items: start;
	}
	.solution-panel :global(.diff) {
		justify-self: stretch;
	}
	@media (max-width: 760px) {
		.work {
			grid-template-columns: minmax(0, 1fr);
		}
		header {
			grid-template-columns: auto 1fr;
		}
		.badge {
			grid-column: 1 / -1;
			justify-self: start;
		}
	}
</style>
