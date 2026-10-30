// The project's target: swift.env's TARGET. Pure, no imports beyond the
// argument vectors, so that node runs its tests without an npm install.

import { LINUX_TARGETS } from './frontend-args.js';

/** The project file that chooses the target. */
export const ENV_FILE = 'swift.env';

/** WebAssembly, run in the browser: the default, and the only one the default compiler builds. */
export const DEFAULT_TARGET = 'wasm32-wasi';

/** Every TARGET swift.env takes, with its label. */
export const TARGETS = {
    [DEFAULT_TARGET]: 'WebAssembly (WASI)',
    ...Object.fromEntries(Object.entries(LINUX_TARGETS).map(([id, t]) => [id, t.label])),
};

/**
 * Reads swift.env: `KEY=value` lines, `#` comments; TARGET is one of
 * TARGETS. Returns `{ target, problems }`: the target (DEFAULT_TARGET when
 * none is set or the one set is refused) and a `{ line, message }` per line
 * that is not understood, which the runner prints as
 * `swift.env:<line>: <message>` and refuses to run with. riscv64-linux,
 * which C, C++, Go and Rust have, gets a message of its own: Swift has no
 * SDK for it.
 */
export function settingsOf(text = '') {
    const settings = { target: DEFAULT_TARGET, problems: [] };
    text.split('\n').forEach((raw, i) => {
        const line = raw.trim();
        if (!line || line.startsWith('#')) return;
        const at = line.indexOf('=');
        const problem = (message) => settings.problems.push({ line: i + 1, message });
        if (at < 0) return problem(`malformed line "${line}": want KEY=value`);
        const key = line.slice(0, at).trim();
        const value = line.slice(at + 1).trim();
        if (key !== 'TARGET') return problem(`unknown setting ${key}: swift.env has TARGET`);
        if (value in TARGETS) settings.target = value;
        else if (value === 'riscv64-linux') problem('Swift has no SDK for riscv64-linux yet; supported: ' + Object.keys(TARGETS).join(', '));
        else problem(`unsupported target ${value}; supported: ${Object.keys(TARGETS).join(', ')}`);
    });
    return settings;
}

/** The Linux target (LINUX_TARGETS) a TARGET names, or null for WebAssembly. */
export const linuxTarget = (target) => LINUX_TARGETS[target] ?? null;
