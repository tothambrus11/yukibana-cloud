/**
 * The course store: one instance of @yukibana/core for the whole page,
 * over one host (one runner pool), and the student's progress, kept in the
 * browser. Every `<Exercise>` takes its instance and its language from
 * here, so many exercises share one pool: two Python exercises share one
 * Python runner, and a Check waits for another exercise's Run of the same
 * pack instead of starting a second one.
 *
 * A component finds the store with `getCourse()`, under the `<App>` that
 * made it with `setCourse()`.
 */
import { createInstance, type Instance, type LanguageMeta } from '@yukibana/core';
import type { PackHost, PackLanguage } from '@yukibana/std';
import { getContext, setContext } from 'svelte';
import type { ExerciseSpec } from './exercises.ts';
import { PageHost } from './host.ts';
import { LANGUAGE_ROWS, languageOf, type CourseLanguage, type LanguageRow } from './languages.ts';
import { loadProgress, saveProgress, summaryOf, type ExerciseProgress, type KeyValueStore, type Progress } from './progress.ts';

/** What a course is made from. */
export interface CourseOptions {
	/** The lesson's id: its progress is kept under it (progress.ts `storageKey`). */
	readonly lesson: string;
	/** Its exercises; the instance has exactly the languages they use. */
	readonly exercises: readonly ExerciseSpec[];
	/** Where the packs are served, a directory URL (`<packs><pack>/runner.js`). */
	readonly packs: URL;
	/** Where progress is kept: `localStorage`, or null for nowhere (a test, a browser that refuses it). */
	readonly storage: KeyValueStore | null;
}

/** One language of the course: its meta as the instance has it, and its row (grammar, report format). */
export interface CourseLanguageEntry {
	readonly meta: PackLanguage;
	readonly row: LanguageRow;
}

/**
 * A lesson's page state. Making one starts nothing: the pool is made at
 * the first Run or Check, each runner at the first run of its pack, and
 * each language's body only if something asks for it.
 *
 * Invariant: `instance.languages` are exactly the languages of the
 * exercises, each once; `progress` is what `storage` holds, as far as it
 * accepted it (`saved` says when it did not).
 */
export class Course {
	/** The one host of the page: its pool, its packs' locator, its runners' needs. */
	readonly host: PageHost;
	/** The one instance of the page, with every exercise's language and that language's providers. */
	readonly instance: Instance<PackHost>;
	readonly lesson: string;
	/** The exercises' ids, in order. */
	readonly ids: readonly string[];
	readonly #languages: ReadonlyMap<CourseLanguage, CourseLanguageEntry>;
	readonly #storage: KeyValueStore | null;

	/** Every exercise's progress, by id; replaced (never mutated) on each change, so a component reading it updates. */
	progress: Progress = $state.raw({});
	/** False after the storage refused a write: the page says progress will not survive a reload. */
	saved: boolean = $state(true);

	/** Makes the course of `options`; throws `Incoherent` (core) if two exercises' languages' providers conflict, which would be a package bug. */
	constructor(options: CourseOptions) {
		this.lesson = options.lesson;
		this.ids = options.exercises.map((exercise) => exercise.id);
		this.#storage = options.storage;
		this.host = new PageHost(options.packs);
		const languages = new Map<CourseLanguage, CourseLanguageEntry>();
		for (const exercise of options.exercises) {
			if (languages.has(exercise.language)) continue;
			const row = LANGUAGE_ROWS[exercise.language];
			languages.set(exercise.language, { meta: languageOf(row), row });
		}
		this.#languages = languages;
		const metas = [...languages.values()].map((entry) => entry.meta);
		this.instance = createInstance<PackHost>({ languages: metas, providers: [...languages.values()].flatMap((entry) => entry.row.providers(entry.meta)), host: this.host });
		this.progress = loadProgress(options.storage, options.lesson);
	}

	/** Returns the course's entry for `language`. Throws `RangeError` for a language no exercise uses, which the constructor would have added. */
	language(language: CourseLanguage): CourseLanguageEntry {
		const entry = this.#languages.get(language);
		if (entry === undefined) throw new RangeError(`No exercise of this course is in ${language}.`);
		return entry;
	}

	/** How many exercises have passed, of how many; read in a component, it follows `progress`. */
	get summary(): { readonly passed: number; readonly total: number } {
		return summaryOf(this.progress, this.ids);
	}

	/** Every language of the course, as the instance has them. */
	get languages(): readonly LanguageMeta[] {
		return this.instance.languages;
	}

	/** Returns exercise `id`'s progress, or null before its first Check or draft. */
	progressOf(id: string): ExerciseProgress | null {
		return this.progress[id] ?? null;
	}

	/**
	 * Records a Check of exercise `id`: `score` of `total` checks passed,
	 * and whether it passed (`verdictOf`). An exercise that passed once
	 * stays passed, so the progress bar never goes back because a student
	 * kept experimenting.
	 */
	recordCheck(id: string, score: number, total: number, passed: boolean): void {
		const before = this.progressOf(id);
		this.#write(id, { passed: (before?.passed ?? false) || passed, score, total, draft: before?.draft ?? null });
	}

	/** Keeps exercise `id`'s draft, or forgets it (`null`) when the file is the starter again. */
	saveDraft(id: string, draft: string | null): void {
		const before = this.progressOf(id);
		if ((before?.draft ?? null) === draft) return;
		this.#write(id, { passed: before?.passed ?? false, score: before?.score ?? 0, total: before?.total ?? 0, draft });
	}

	/** Forgets the whole lesson's progress and drafts. Editors already open keep their text until the page reloads. */
	reset(): void {
		this.progress = {};
		this.saved = saveProgress(this.#storage, this.lesson, this.progress);
	}

	#write(id: string, entry: ExerciseProgress): void {
		this.progress = { ...this.progress, [id]: entry };
		this.saved = saveProgress(this.#storage, this.lesson, this.progress);
	}
}

const KEY = Symbol('course');

/** Makes `course` the store of the calling component's subtree. Call during a component's initialisation. */
export function setCourse(course: Course): Course {
	return setContext(KEY, course);
}

/** Returns the store of the calling component's subtree. Throws when no ancestor set one, which is a page wiring bug. */
export function getCourse(): Course {
	const course = getContext<Course | undefined>(KEY);
	if (course === undefined) throw new Error('No course: an <Exercise> must be inside the component that called setCourse().');
	return course;
}
