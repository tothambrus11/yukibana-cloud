<!--
@component
The lesson page: its title, the progress bar, and each exercise, all
over one course store (one instance of @yukibana/core, one runner pool).
Keeps the store and the exercises' sessions in `globalThis.course`, which
the end-to-end test (test.mjs) reads.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import Exercise from './components/Exercise.svelte';
	import ProgressBar from './components/ProgressBar.svelte';
	import { setCourse, type Course } from './lib/course.svelte.ts';
	import type { ExerciseSession } from './lib/exercise.svelte.ts';
	import type { ExerciseSpec } from './lib/exercises.ts';
	import { theme } from './lib/theme.svelte.ts';

	interface Props {
		/** The page's store, made by main.ts. */
		course: Course;
		/** The lesson's text. */
		lesson: { readonly title: string; readonly kicker: string; readonly intro: string };
		/** Its exercises, in order. */
		exercises: readonly ExerciseSpec[];
		/** Called with each exercise's session as it is made. */
		onsession: (session: ExerciseSession) => void;
	}

	let { course, lesson, exercises, onsession }: Props = $props();
	setCourse(untrack(() => course));

	const THEME_LABELS = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' } as const;

	function resetProgress(): void {
		if (confirm('Forget your progress and drafts of this lesson? The editors keep their text until you reload.')) course.reset();
	}
</script>

<div class="page">
	<header class="masthead">
		<div class="bar">
			<span class="brand"><span class="flake" aria-hidden="true">❄</span> Yukibana Course</span>
			<button class="theme" onclick={() => theme.cycle()} aria-label={`${THEME_LABELS[theme.choice]} (change)`}>{theme.dark ? '☾' : '☀'} <span>{theme.choice}</span></button>
		</div>
		<p class="kicker">{lesson.kicker}</p>
		<h1>{lesson.title}</h1>
		<p class="intro">{lesson.intro}</p>
	</header>

	<nav class="sticky" aria-label="Progress">
		<ProgressBar {exercises} />
		{#if !course.saved}<p class="unsaved">This browser does not keep data for this page: your progress lasts until you reload.</p>{/if}
	</nav>

	<main>
		{#each exercises as spec, at (spec.id)}
			<Exercise {spec} number={at + 1} {onsession} />
		{/each}
	</main>

	<footer class="colophon">
		<p>
			Every program runs in your browser, compiled by the language's pack: Pyodide, Node's test runner and fast-check, rustc, clang and GoogleTest, swiftc and XCTest. Nothing is sent to a server.
		</p>
		<button class="ghost" onclick={resetProgress}>Reset this lesson's progress</button>
	</footer>
</div>

<style>
	.page {
		max-width: 1040px;
		margin: 0 auto;
		padding: 0 16px 64px;
	}
	.masthead {
		padding: 20px 0 28px;
	}
	.bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 40px;
	}
	.brand {
		font: 600 14px var(--sans);
		letter-spacing: 0.04em;
		color: var(--muted);
	}
	.flake {
		color: var(--accent);
	}
	.theme {
		font: 13px var(--sans);
		padding: 6px 12px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--card);
		color: var(--ink);
		cursor: pointer;
	}
	.theme span {
		text-transform: capitalize;
		color: var(--muted);
	}
	.kicker {
		margin: 0 0 8px;
		font: 600 12px var(--mono);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent-ink);
	}
	h1 {
		margin: 0 0 14px;
		font: 600 clamp(32px, 6vw, 52px)/1.05 var(--display);
		letter-spacing: -0.015em;
		max-width: 18ch;
	}
	.intro {
		margin: 0;
		max-width: 64ch;
		font-size: 17px;
		line-height: 1.6;
		color: var(--muted);
	}
	.sticky {
		position: sticky;
		top: 0;
		z-index: 5;
		margin: 0 -16px 24px;
		padding: 14px 16px;
		background: color-mix(in srgb, var(--bg) 86%, transparent);
		backdrop-filter: blur(10px);
		border-bottom: 1px solid var(--line);
	}
	.unsaved {
		margin: 8px 0 0;
		font-size: 13px;
		color: var(--warn);
	}
	main {
		display: grid;
		gap: 28px;
	}
	.colophon {
		margin-top: 48px;
		padding-top: 20px;
		border-top: 1px solid var(--line);
		font-size: 13.5px;
		color: var(--muted);
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 12px;
		align-items: center;
	}
	.colophon p {
		margin: 0;
		max-width: 70ch;
	}
	.ghost {
		font: 600 13px var(--sans);
		border: 0;
		background: transparent;
		color: var(--accent-ink);
		cursor: pointer;
		padding: 6px 0;
	}
</style>
