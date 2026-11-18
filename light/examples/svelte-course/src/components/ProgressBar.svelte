<!--
@component
The lesson's progress: one segment per exercise, filled when it passed
and tinted by its last score otherwise, each a link to its exercise; and
"n of m passed". Reads the course store, so it follows every Check.
-->
<script lang="ts">
	import { getCourse } from '../lib/course.svelte.ts';
	import type { ExerciseSpec } from '../lib/exercises.ts';

	interface Props {
		/** The lesson's exercises, in order. */
		exercises: readonly ExerciseSpec[];
	}

	let { exercises }: Props = $props();
	const course = getCourse();
</script>

<div class="progress" role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={course.summary.total} aria-valuenow={course.summary.passed} aria-valuetext={`${course.summary.passed} of ${course.summary.total} exercises passed`}>
	<ol class="segments">
		{#each exercises as exercise (exercise.id)}
			{@const progress = course.progress[exercise.id]}
			<li style:--lang={`var(--lang-${exercise.language})`} style:--fill={progress === undefined || progress.total === 0 ? 0 : progress.passed ? 1 : progress.score / progress.total} data-passed={progress?.passed === true}>
				<a href={`#${exercise.id}`} title={exercise.title}><span class="sr">{exercise.title}</span></a>
			</li>
		{/each}
	</ol>
	<span class="count"><strong>{course.summary.passed}</strong> of {course.summary.total} passed</span>
</div>

<style>
	.progress {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.segments {
		flex: 1;
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		position: relative;
		height: 10px;
		border-radius: 999px;
		background: var(--line);
		overflow: hidden;
	}
	li::after {
		content: '';
		position: absolute;
		inset: 0;
		transform-origin: left;
		transform: scaleX(var(--fill));
		background: color-mix(in srgb, var(--lang) 45%, transparent);
		transition: transform 500ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	li[data-passed='true']::after {
		background: var(--lang);
	}
	a {
		position: absolute;
		inset: -6px 0;
		z-index: 1;
	}
	a:focus-visible {
		outline: 2px solid var(--accent);
		border-radius: 999px;
	}
	.count {
		font-size: 13.5px;
		color: var(--muted);
		white-space: nowrap;
	}
	strong {
		color: var(--ink);
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
