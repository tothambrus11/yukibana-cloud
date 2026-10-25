// The in-memory file system the Rust pack's workers give Miri
// (browser_wasi_shim's directories), shared by runner.js and explorer.js.

import { Directory, File } from '@bjorn3/browser_wasi_shim';

/** A Directory tree from [relative path, bytes] pairs. */
export function tree(entries) {
    const root = new Map();
    for (const [path, bytes] of entries) {
        const parts = path.split('/').filter(Boolean);
        let dir = root;
        for (const part of parts.slice(0, -1)) {
            let next = dir.get(part);
            if (!next) dir.set(part, (next = new Map()));
            dir = next;
        }
        dir.set(parts.at(-1), new File(bytes, { readonly: true }));
    }
    const build = (map) => new Directory([...map].map(([name, v]) => [name, v instanceof Map ? build(v) : v]));
    return build(root);
}
