/**
 * What the Build settings panel (components/BuildSettings.svelte) shares
 * with the code that opens it from elsewhere: the event that opens it, and
 * the one-line summary of the build that its chip, the ⋯ menu and the
 * status bar show. In a plain module, so a compiler output view
 * (compiler-view.ts, loaded on its own) can open the panel without
 * bundling the component.
 */
import { settingsOf } from './properties/index.ts';
import type { Workspace } from './workspace.svelte';

/**
 * The window event that opens the Build settings panel; its `detail` is the
 * element to anchor the panel to (a shown element: the ⋯ button, the status
 * bar's summary, a view's Options button). Ignored when the project's
 * language has no build settings, because the panel is not mounted then.
 */
export const BUILD_SETTINGS_EVENT = 'yk-build-settings';

/** Opens the Build settings panel next to `from`. */
export function openBuildSettings(from: HTMLElement | null): void {
	dispatchEvent(new CustomEvent(BUILD_SETTINGS_EVENT, { detail: from }));
}

/**
 * The build in one line: the summary of the language's property model
 * (properties/), such as `x86-64 · -O2 · ASan · 2 CPUs` for C++ and
 * `-Onone` for Swift. Empty for a language without build settings.
 * Derived again whenever the project changes, since the snapshot reads the
 * workspace's revision.
 */
export function buildSummary(workspace: Pick<Workspace, 'language' | 'snapshot'>): string {
	return settingsOf(workspace.language).model.summary(workspace.snapshot());
}
