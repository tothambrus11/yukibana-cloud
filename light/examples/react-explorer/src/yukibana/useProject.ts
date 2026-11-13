/**
 * `useProject` and `useSnapshot`: a widget's project, and the snapshot of
 * it a render reads.
 */
import type { Files, ProjectSnapshot } from '@yukibana/core';
import { useState, useSyncExternalStore } from 'react';
import { MemoryProject, type MetaValues } from './project.ts';

/**
 * Returns a project of `files` and saved settings `meta`, made at the first
 * render and kept for the component's life; later arguments are ignored
 * (the project is edited in place, by its editor and its settings).
 */
export function useProject(files: Files, meta: MetaValues = {}): MemoryProject {
	const [project] = useState(() => new MemoryProject(files, meta));
	return project;
}

/**
 * Returns `project`'s snapshot now, re-rendering the component at every
 * change of it: a file edited, a setting changed. The same object between
 * changes, so it is safe as an effect's dependency.
 */
export function useSnapshot(project: MemoryProject): ProjectSnapshot {
	return useSyncExternalStore(
		(changed) => {
			const subscription = project.onChange(changed);
			return () => subscription.dispose();
		},
		() => project.snapshot(),
	);
}
