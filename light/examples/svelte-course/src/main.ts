/**
 * The page: one course store over the lesson's exercises (one instance of
 * @yukibana/core, one runner pool), mounted as Svelte's `<App>`. Nothing
 * of Light's app is imported; the packs are served under `packs/` beside
 * the page.
 *
 * The page keeps the store and the exercises' sessions in
 * `globalThis.course`, which the end-to-end test (test.mjs) reads.
 */
import { mount } from 'svelte';
import App from './App.svelte';
import { Course } from './lib/course.svelte.ts';
import type { ExerciseSession } from './lib/exercise.svelte.ts';
import { EXERCISES, LESSON, LESSON_ID } from './lib/exercises.ts';
import { theme } from './lib/theme.svelte.ts';
import './page.css';

/** What the page made, for the end-to-end test. */
interface CoursePage {
	/** The page's one store. */
	readonly store: Course;
	/** Each exercise's session, by exercise id, as the components make them. */
	readonly sessions: Map<string, ExerciseSession>;
}

declare global {
	/** The page's store and sessions (main.ts). */
	var course: CoursePage | undefined;
}

/** The browser's storage, or null where reading it throws (some private windows). */
function storage(): Storage | null {
	try {
		return localStorage;
	} catch {
		return null;
	}
}

theme.apply();
const store = new Course({ lesson: LESSON_ID, exercises: EXERCISES, packs: new URL('packs/', document.baseURI), storage: storage() });
const sessions = new Map<string, ExerciseSession>();
globalThis.course = { store, sessions };

const target = document.getElementById('app');
if (target === null) throw new Error('index.html has no #app: the page cannot mount.');
mount(App, { target, props: { course: store, lesson: LESSON, exercises: EXERCISES, onsession: (session) => void sessions.set(session.spec.id, session) } });
