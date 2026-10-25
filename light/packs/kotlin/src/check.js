// The language server's checker: kotlinc (kotlinc.js) in a worker of the
// server's own, so a check of a second or more never holds up completion or
// hover, which the server answers from its syntax trees meanwhile.
//
// in:  { type: 'check', id, files: { path: text } }  every .kt of the project
// out: { type: 'loading', label, loaded, total }     kotlinc's download
//      { type: 'ready', versions, timings }          once, when it can check
//      { type: 'failed', error }                     once, if it cannot start
//      { type: 'checked', id, ms, messages }         per check, in order
//
// A check compiles every source, the tests included, against the standard
// library and kotlin.test into a klib, for Kotlin/Wasm with the WASI
// target: what Run and Test compile, so the editor reports what they would.
// The klib itself is thrown away.

import { isNoise, startKotlinc, wasiArgs } from './kotlinc.js';

const post = (msg) => self.postMessage(msg);

const kotlinc = startKotlinc({ report: (p) => post({ type: 'loading', ...p }) });
kotlinc.then(
    (kc) => post({ type: 'ready', versions: kc.versions, timings: kc.timings }),
    (e) => post({ type: 'failed', error: String(e?.stack ?? e) }),
);

/** The newest check request not yet started; older ones are dropped. */
let next = null;
let busy = false;
self.onmessage = ({ data }) => {
    if (data?.type !== 'check') return;
    next = data;
    if (!busy) void drain();
};

async function drain() {
    busy = true;
    try {
        const kc = await kotlinc;
        while (next) {
            const { id, files } = next;
            next = null;
            post({ type: 'checked', id, ...check(kc, files) });
            // Lets a newer request in before the next check starts.
            await new Promise((r) => setTimeout(r, 0));
        }
    } catch {
        // Reported as failed above.
    } finally {
        busy = false;
    }
}

function check(kc, files) {
    const t0 = performance.now();
    kc.remove('/workspace');
    kc.remove('/check');
    const paths = [];
    for (const [p, text] of Object.entries(files)) {
        kc.write(`/workspace/${p}`, text);
        paths.push(`/workspace/${p}`);
    }
    if (!paths.length) return { ms: 0, messages: [] };
    const r = kc.compile([...wasiArgs({ test: true }), '-nopack', '-ir-output-dir', '/check/klib', ...paths.sort()]);
    kc.remove('/check');
    return { ms: Math.round(performance.now() - t0), messages: r.messages.filter((m) => !isNoise(m)) };
}
