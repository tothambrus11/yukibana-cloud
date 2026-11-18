/**
 * What the Swift pack's runner refuses to do with a project, read from a
 * snapshot, in the runner's own words, so that the button it would refuse
 * is disabled with the sentence the terminal would have shown (DESIGN.md
 * N1). The rule is the runner's, restated: packs/swift/src/runner.js
 * `run()`; change them together. It reads only swift.env (`file`, never
 * `files`), since the top bar asks after every edit.
 */
import { AVAILABLE, pathOf, type Availability, type ProjectSnapshot } from '../core/index.ts';

/** Swift's Linux targets, as swift.env names them, with their labels (packs/swift/src/frontend-args.js LINUX_TARGETS). */
const SWIFT_LINUX: Readonly<Record<string, string>> = { 'x86_64-linux': 'x86-64 Linux', 'aarch64-linux': 'AArch64 Linux' };

/** The file a Swift project chooses its target in. */
const SWIFT_ENV = 'swift.env';

/**
 * Returns whether a Swift project can be debugged: not when swift.env
 * names a Linux target, which the runner refuses to debug. Read as the
 * runner reads it (packs/swift/src/target.js `settingsOf`): `KEY=value`
 * lines, `#` comments, the last TARGET it supports winning.
 */
export function swiftDebugAvailable(snapshot: ProjectSnapshot): Availability {
	let label: string | null = null;
	for (const raw of (snapshot.file(pathOf(SWIFT_ENV)) ?? '').split('\n')) {
		const line = raw.trim();
		const at = line.indexOf('=');
		if (!line || line.startsWith('#') || at < 0 || line.slice(0, at).trim() !== 'TARGET') continue;
		const value = line.slice(at + 1).trim();
		if (value === 'wasm32-wasi') label = null;
		else if (Object.hasOwn(SWIFT_LINUX, value)) label = SWIFT_LINUX[value] ?? null;
	}
	if (label === null) return AVAILABLE;
	return { kind: 'unavailable', reason: `error: the debugger runs WebAssembly programs only; ${label} cannot be debugged yet (comment out TARGET in ${SWIFT_ENV} to debug)` };
}
