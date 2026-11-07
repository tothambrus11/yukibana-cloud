/**
 * `useExplore`: one compiler output view (assembly, LLVM IR, MIR, SIL,
 * bytecode) of a widget's source, kept up to date as the source and its
 * settings change, through the language's provider of std's `explore`.
 */
import type { Path, ProjectSnapshot } from '@yukibana/core';
import { defaultOptions, explore, viewIn, type EmitResult, type ExploreProgress, type ExploreView, type ViewKind } from '@yukibana/std';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LanguageDef } from './language.ts';
import type { MemoryProject } from './project.ts';
import type { Yukibana } from './useInstance.ts';
import { useSnapshot } from './useProject.ts';

/** What one view shows. */
export interface ExploreState {
	/** The view as the language describes it (title, noun, toggles), or null when the language has no such view. */
	readonly view: ExploreView | null;
	/**
	 * The latest answer: the output with its line mapping, the compiler's
	 * messages, or why the worker could not answer; null before the first
	 * answer and when the language has no views.
	 */
	readonly result: EmitResult | null;
	/** `true` iff a request is out whose answer will replace `result`. */
	readonly pending: boolean;
	/** The download the explorer last reported while the request waited (the compiler, the sysroot), or null. */
	readonly progress: ExploreProgress | null;
	/** Why there is nothing to show at all (no explore provider, no such view), or null. */
	readonly problem: string | null;
}

/** What `useExplore` asks for. */
export interface ExploreSettings {
	/** The view's kind (`asm`, `llvm-ir`, `mir`, `sil`, `bytecode`). */
	readonly kind: ViewKind;
	/** The source shown; the language's entry by default. */
	readonly path?: Path;
	/** The view's toggles by key; each missing one takes its default (`ExploreToggle.on`). */
	readonly toggles?: Readonly<Record<string, boolean>>;
	/** What every request carries besides, for a snapshot: Rust's and Swift's `optimization` (`levelOptions`). */
	readonly options?: (snapshot: ProjectSnapshot) => Readonly<Record<string, string | boolean>> | null;
	/** Whether to ask at all: a view not on screen asks nothing (default true). */
	readonly enabled?: boolean;
	/** How long after an edit to ask again, in milliseconds (default 500, as Light's views; the first request goes at once). */
	readonly delayMs?: number;
}

/**
 * Returns view `settings.kind` of `project`'s source in `language`, asked of
 * `yukibana`'s instance: at once when first enabled, then `delayMs` after
 * the last change of the project or of the settings. A newer request
 * aborts the one in flight (its answer is `dropped`, never shown), so only
 * the newest answer is shown, and the old result stays on screen until it
 * comes. On unmount the widget lets the pack's explorer worker go
 * (`ExplorerProvider.release`), which ends the worker once no widget holds
 * it.
 *
 * - Requires: `language` is one of `yukibana`'s languages.
 */
export function useExplore(yukibana: Yukibana, language: LanguageDef, project: MemoryProject, settings: ExploreSettings): ExploreState {
	const { instance, host } = yukibana;
	const snapshot = useSnapshot(project);
	const view = viewIn(language.explorer?.views ?? null, settings.kind);
	const enabled = settings.enabled ?? true;
	const [state, setState] = useState<Omit<ExploreState, 'view' | 'problem'>>({ result: null, pending: false, progress: null });
	const holder = useRef<object>({});
	const asked = useRef(false);
	const options = settings.options?.(snapshot) ?? null;
	const wanted: Readonly<Record<string, string | boolean>> = { ...defaultOptions(view), ...settings.toggles, ...options };
	const key = JSON.stringify(wanted);
	// The same object while the options are the same, so an effect runs again only when they change.
	const sent = useMemo(() => wanted, [key]);
	const path = settings.path ?? language.language.entry;

	useEffect(() => {
		if (!enabled || view === null || language.explorer === null) return;
		const controller = new AbortController();
		const delay = asked.current ? (settings.delayMs ?? 500) : 0;
		const timer = setTimeout(() => {
			asked.current = true;
			setState((s) => ({ ...s, pending: true }));
			const input = {
				view: view.kind,
				files: snapshot.files(),
				path,
				options: sent,
				onProgress: (progress: ExploreProgress) => {
					if (!controller.signal.aborted) setState((s) => ({ ...s, progress }));
				},
				holder: holder.current,
			};
			void instance.perform(language.subject, explore, input, snapshot, controller.signal).then(async (outcome) => {
				const result: EmitResult = outcome.kind === 'done' ? await outcome.value : { kind: 'broken', error: outcome.reason };
				if (controller.signal.aborted || result.kind === 'dropped') return;
				setState({ result, pending: false, progress: null });
			});
		}, delay);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [enabled, view, language, instance, snapshot, path, sent, settings.delayMs]);

	useEffect(() => {
		const mine = holder.current;
		return () => language.explorer?.release(host, mine);
	}, [language, host]);

	const problem = language.explorer === null ? `${language.language.label} has no compiler output views.` : view === null ? `${language.language.label} has no ${settings.kind} view.` : null;
	return { view, problem, ...state };
}
