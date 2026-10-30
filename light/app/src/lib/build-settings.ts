/**
 * What the Build settings panel (components/BuildSettings.svelte) shares
 * with the code that opens it from elsewhere: the event that opens it, and
 * the one-line summary of the build that its chip, the ⋯ menu and the
 * status bar show. In a plain module, so a compiler output view
 * (compiler-view.ts, loaded on its own) can open the panel without
 * bundling the component.
 */
import { TARGET_SHORT } from './cpp-targets';
import { MIRI_TARGETS } from './rust-targets';
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
 * The build in one line: the C++ target's short name, the optimisation
 * level, the sanitizers on (`no sanitizers` for C or C++ with none), and
 * on a Linux target the run options that are not the defaults
 * (`x86-64 · -O2 · ASan · 2 CPUs`). Empty for a language without build
 * settings.
 */
export function buildSummary(workspace: Pick<Workspace, 'target' | 'optimization' | 'sanitizers' | 'runOptions'> & Partial<Pick<Workspace, 'rustTarget' | 'miri'>>): string {
	const parts: string[] = [];
	const target = workspace.target;
	if (target) parts.push(target.kind === 'unsupported' ? target.triple || 'Other target' : TARGET_SHORT[target.target.id]);
	// A Rust project's target, from .cargo/config.toml; same ids, same short names.
	const rust = workspace.rustTarget;
	if (rust) parts.push(rust.kind === 'unsupported' ? rust.triple : TARGET_SHORT[rust.target.id]);
	const o = workspace.optimization;
	if (o) parts.push(o.kind === 'other' ? o.flag : o.level.flag);
	const s = workspace.sanitizers;
	// A C or C++ project says so when none is on, so that a run without
	// them is a choice the summary shows (Ambrus asked for it).
	if (s) parts.push(s.address && s.undefined ? 'ASan + UBSan' : s.address ? 'ASan' : s.undefined ? 'UBSan' : 'no sanitizers');
	if (workspace.miri && rust) parts.push(`Miri on ${MIRI_TARGETS.find((t) => t.id === workspace.miri)?.label ?? workspace.miri}`);
	if ((target?.kind === 'target' && target.target.runtime === 'linux') || (rust?.kind === 'target' && rust.target.runtime === 'linux' && !workspace.miri)) {
		const r = workspace.runOptions;
		if (r.emulation === 'user') parts.push('user mode');
		else if (r.cpus > 1) parts.push(`${r.cpus} CPUs`);
		if (r.strace) parts.push('strace');
	}
	return parts.join(' · ');
}
