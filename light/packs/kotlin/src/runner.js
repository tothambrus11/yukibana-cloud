// Kotlin runner for the Yukibana IDE (packs/CONTRACT.md, "Running a
// program"): the real kotlinc (kotlinc.js) compiles the project for
// Kotlin/Wasm with the WASI target, in two steps as Gradle does (sources to
// a klib, the klib to main.wasm), and the program runs in a worker of its
// own (program.js) with a terminal on stdin and stdout. Test compiles the
// test sources too, against kotlin.test, and runs every @Test.
//
// Protocol (one object per postMessage):
//   in:  { type: 'run' | 'test', files, entry, stdin: SharedArrayBuffer | null }
//        { type: 'cancel' }
//   out: loading / phase / mark / stdout / stderr / stdin / exit (a run's
//        last message; `reusable: true`: the worker takes another run)
//
// kotlinc starts as soon as the worker does (the app starts this runner
// ahead of Run: warmRunner), and compiles and links a small program out of
// sight, so the standard library's linked code is in the compiler's cache
// (-Xcache-directory) before the first Run: linking then takes about a
// second instead of four.
//
// The program's worker is terminated on cancel, and on an endless loop by
// Stop; kotlinc, in this worker, stays warm. A cancel that comes while
// kotlinc compiles waits for it (a compile cannot be interrupted), and the
// app terminates this worker if that takes longer than its grace period.

import { isNoise, startKotlinc, wasiArgs } from './kotlinc.js';

const post = (msg) => self.postMessage(msg);

/** Whether a project path is a test source, not compiled by Run. */
export const isTestSource = (path) => /(^|\/)tests?\//.test(path);

const WARM = `fun main() {
    val xs = listOf(3, 1, 2).sorted().map { it * 2 }
    println(xs.joinToString(", ") + " " + mapOf("a" to 1.5).getValue("a") + " " + "x".repeat(2))
}
`;

const kotlinc = startKotlinc({ report: (p) => post({ type: 'loading', ...p }) }).then((kc) => {
    const t0 = performance.now();
    try {
        kc.remove('/warm');
        kc.write('/warm/Main.kt', WARM);
        const klib = kc.compile([...wasiArgs(), '-nopack', '-ir-output-dir', '/warm/klib', '/warm/Main.kt']);
        if (klib.exit === 0) kc.compile([...wasiArgs(), '-Xir-produce-js', '-Xinclude=/warm/klib', '-Xcache-directory=/cache/run', '-ir-output-dir', '/warm/out']);
    } catch {
        // A warm-up that fails costs the first run its head start, nothing else.
    } finally {
        kc.remove('/warm');
    }
    kc.timings.warm = Math.round(performance.now() - t0);
    return kc;
});
kotlinc.catch(() => {});

/** The run in progress: its program's worker, and how to end it. */
let current = null;
let queue = Promise.resolve();
self.onmessage = ({ data: msg }) => {
    if (msg?.type === 'cancel') {
        current?.cancel();
        return;
    }
    if (msg?.type !== 'run' && msg?.type !== 'test') return;
    queue = queue.then(() => runOnce(msg));
};

/** Lets a cancel that arrived during a synchronous compile through. */
const yieldTask = () => new Promise((r) => setTimeout(r, 0));

/** One run or test; its last message is its exit. */
async function runOnce(msg) {
    const t0 = performance.now();
    const mark = (name) => post({ type: 'mark', name, ms: Math.round(performance.now() - t0) });
    const run = { cancelled: false, cancel() { this.cancelled = true; } };
    current = run;
    let code = 1;
    let reusable = true;
    try {
        code = await compileAndRun(msg, run, mark);
    } catch (e) {
        post({ type: 'stderr', text: `kotlin runner: ${e?.stack ?? e}\n` });
        code = 1;
        // kotlinc itself failed (not the program, whose failure is an exit
        // code): a fresh worker is the safe next step.
        reusable = false;
    } finally {
        current = null;
    }
    post({ type: 'exit', code, reusable });
}

/** Compiles the project and runs it, or its tests; resolves to the exit code. */
async function compileAndRun(msg, run, mark) {
    const testing = msg.type === 'test';
    const files = msg.files ?? {};
    const sources = Object.keys(files).filter((p) => p.endsWith('.kt') && (testing || !isTestSource(p))).sort();
    const entry = msg.entry ?? 'src/main/kotlin/Main.kt';
    if (testing && !sources.some((p) => isTestSource(p) && /@Test\b/.test(files[p]))) {
        post({ type: 'stderr', text: 'No tests: Test runs the @Test functions (kotlin.test) of the files under src/test/, and this project has none.\n' });
        return 1;
    }
    if (!testing && !(entry in files)) {
        post({ type: 'stderr', text: `No ${entry} to run.\n` });
        return 1;
    }
    post({ type: 'phase', text: 'Loading kotlinc' });
    const kc = await kotlinc;
    mark('kotlinc-ready');
    post({ type: 'mark', name: 'kotlinc-warm-up', ms: kc.timings.warm ?? 0 });

    kc.remove('/workspace');
    kc.remove('/build');
    for (const p of Object.keys(files)) if (p.endsWith('.kt')) kc.write(`/workspace/${p}`, files[p]);
    const paths = sources.map((p) => `/workspace/${p}`);
    const wrapper = testing ? null : mainWrapper(files[entry]);
    if (wrapper) kc.write(WRAPPER, wrapper);

    post({ type: 'phase', text: 'Compiling' });
    let klib = kc.compile([...wasiArgs({ test: testing }), '-nopack', '-ir-output-dir', '/build/klib', ...paths, ...(wrapper ? [WRAPPER] : [])]);
    let start = testing ? 'startUnitTests' : wrapper ? 'yk_main' : '_start';
    if (klib.exit !== 0 && wrapper && klib.messages.every((m) => !isError(m) || m.path === WRAPPER)) {
        // The wrapper guessed main's shape wrong: run main as WASI's
        // _start does, without the uncaught exception's message.
        klib = kc.compile([...wasiArgs(), '-nopack', '-ir-output-dir', '/build/klib', ...paths]);
        start = '_start';
    }
    report(klib.messages, files);
    mark('compiled');
    if (klib.exit !== 0) return klib.exit;
    await yieldTask();
    if (run.cancelled) return 130;

    post({ type: 'phase', text: 'Linking' });
    const link = kc.compile([...wasiArgs({ test: testing }), '-Xir-produce-js', '-Xinclude=/build/klib', `-Xcache-directory=/cache/${testing ? 'test' : 'run'}`, '-ir-output-dir', '/build/out']);
    report(link.messages, files);
    mark('linked');
    if (link.exit !== 0) return link.exit;
    const wasm = kc.readBytes('/build/out/main.wasm');
    await yieldTask();
    if (run.cancelled) return 130;

    post({ type: 'phase', text: testing ? 'Testing' : 'Running' });
    const code = await runProgram(run, wasm.buffer, msg.stdin ?? null, start, testing, mark);
    mark('exit');
    return code;
}

/** Runs main.wasm in a worker of its own; resolves to its exit code. */
function runProgram(run, wasm, stdin, start, testing, mark) {
    return new Promise((resolve) => {
        const worker = new Worker(new URL('program.js', import.meta.url), { type: 'module' });
        const tests = testing ? new TestReport() : null;
        let first = true;
        let finished = false;
        const finish = (code) => {
            if (finished) return;
            finished = true;
            worker.terminate();
            if (tests) {
                const out = tests.end();
                if (out) post({ type: 'stdout', text: out });
                if (code === 0 && !tests.ok()) code = 1;
            }
            resolve(code);
        };
        run.cancel = () => finish(130);
        worker.onmessage = ({ data }) => {
            if (data.type === 'done') return finish(data.code);
            if (data.type === 'stdout' && first) { first = false; mark('first-stdout'); }
            if (data.type === 'stdout' && tests) {
                const out = tests.feed(data.text);
                if (out) post({ type: 'stdout', text: out });
                return;
            }
            post(data);
        };
        worker.onerror = (e) => {
            e.preventDefault?.();
            post({ type: 'stderr', text: `kotlin runner: the program's worker failed: ${e.message ?? e}\n` });
            finish(1);
        };
        worker.postMessage({ wasm, stdin, entry: start }, [wasm]);
    });
}

// ---- Calling main

/** Where the wrapper around the project's main lives in kotlinc's file system. */
const WRAPPER = '/yukibana/YukibanaMain.kt';

/**
 * A file that calls the entry file's main and returns 0, or prints what an
 * uncaught exception says, as the JVM does, and returns 1: a WASI program's
 * own uncaught exception is a WebAssembly exception without a message.
 * Null when the entry file has no top-level main this can call (a suspend
 * main, or none): the program then starts at WASI's _start.
 */
export function mainWrapper(text) {
    if (typeof text !== 'string') return null;
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const main = /^fun\s+main\s*\(([^)]*)\)/m.exec(code);
    if (!main) return null;
    const pkg = /^\s*package\s+([\w.`]+)/m.exec(code)?.[1];
    const call = `${pkg ? `${pkg}.` : ''}main(${main[1].trim() ? 'emptyArray()' : ''})`;
    return `@file:OptIn(kotlin.wasm.ExperimentalWasmInterop::class)

@kotlin.wasm.WasmImport("yukibana", "uncaught_char")
private external fun yukibanaUncaughtChar(c: Int)

@kotlin.wasm.WasmExport("yk_main")
fun yukibanaMain(): Int = try {
    ${call}
    0
} catch (e: Throwable) {
    for (c in "Exception in thread \\"main\\" " + e.stackTraceToString()) yukibanaUncaughtChar(c.code)
    1
}
`;
}

// ---- Compiler messages

const isError = (m) => m.severity === 'error' || m.severity === 'exception';

/**
 * Prints kotlinc's messages on stderr as kotlinc does: path:line:column,
 * the severity, the message, then the line with the range underlined.
 * Paths are the project's; the wrapper's own messages are not shown.
 */
function report(messages, files) {
    let text = '';
    for (const m of messages) {
        if (isNoise(m) || m.path === WRAPPER) continue;
        const colour = isError(m) ? '\x1b[31m' : m.severity.includes('warning') ? '\x1b[33m' : '\x1b[36m';
        if (!m.path) {
            text += `${colour}${m.severity}\x1b[0m: ${m.message}\n`;
            continue;
        }
        const path = m.path.startsWith('/workspace/') ? m.path.slice('/workspace/'.length) : m.path;
        text += `\x1b[1m${path}:${m.line}:${m.column}:\x1b[0m ${colour}${m.severity}\x1b[0m: ${m.message}\n`;
        const line = files[path]?.split('\n')[m.line - 1];
        if (line !== undefined && m.line > 0 && m.column > 0) {
            const end = m.lineEnd === m.line && m.columnEnd > m.column ? m.columnEnd : m.column + 1;
            text += `${line.replace(/\r$/, '')}\n${' '.repeat(m.column - 1)}${colour}${'^'.repeat(Math.max(1, end - m.column))}\x1b[0m\n`;
        }
    }
    if (text) post({ type: 'stderr', text });
}

// ---- Test results

/**
 * kotlin.test on WASI reports in TeamCity service messages on stdout
 * (##teamcity[testStarted name='…' …]), which Gradle reads. This reads
 * them into a report for people, in order, and passes every other line
 * through as the tests printed it.
 */
export class TestReport {
    constructor() {
        this.pending = '';
        this.suites = [];
        this.passed = 0;
        this.failed = 0;
        this.ignored = 0;
        this.failure = null;
    }
    /** Takes a piece of stdout; returns the text to show for its whole lines. */
    feed(text) {
        this.pending += text;
        const cut = this.pending.lastIndexOf('\n');
        if (cut < 0) return '';
        const lines = this.pending.slice(0, cut + 1);
        this.pending = this.pending.slice(cut + 1);
        let out = '';
        for (const line of lines.split('\n').slice(0, -1)) out += this.line(line);
        return out;
    }
    /** The rest of stdout, and the summary. */
    end() {
        let out = this.pending ? this.line(this.pending) : '';
        this.pending = '';
        const total = this.passed + this.failed + this.ignored;
        if (total === 0) return `${out}No tests ran.\n`;
        const parts = [`${this.passed} passed`];
        if (this.failed) parts.push(`\x1b[31m${this.failed} failed\x1b[0m`);
        if (this.ignored) parts.push(`${this.ignored} ignored`);
        return `${out}\n${total} test${total === 1 ? '' : 's'}: ${parts.join(', ')}\n`;
    }
    /** Whether every test that ran passed, and at least one ran. */
    ok() {
        return this.failed === 0 && this.passed > 0;
    }
    line(line) {
        const m = /^##teamcity\[(\w+)((?:\s+\w+='(?:[^'|]|\|.)*')*)\s*\]\s*$/.exec(line);
        if (!m) return `${line}\n`;
        const attrs = {};
        for (const a of m[2].matchAll(/(\w+)='((?:[^'|]|\|.)*)'/g)) attrs[a[1]] = unescape(a[2]);
        const indent = '  '.repeat(Math.max(0, this.suites.length - 1));
        switch (m[1]) {
            case 'testSuiteStarted':
                this.suites.push(attrs.name ?? '');
                return attrs.name ? `${indent}${attrs.name}\n` : '';
            case 'testSuiteFinished':
                this.suites.pop();
                return '';
            case 'testStarted':
                this.failure = null;
                return '';
            case 'testFailed':
                this.failure = (attrs.details || attrs.message || 'failed').trim();
                return '';
            case 'testIgnored':
                this.ignored++;
                this.failure = undefined;
                return `${indent}  - ${attrs.name} (ignored)\n`;
            case 'testFinished': {
                if (this.failure === undefined) { this.failure = null; return ''; }
                if (this.failure === null) {
                    this.passed++;
                    return `${indent}  \x1b[32m✓\x1b[0m ${attrs.name}\n`;
                }
                this.failed++;
                const why = this.failure.split('\n').map((l) => `${indent}      ${l}`).join('\n');
                this.failure = null;
                return `${indent}  \x1b[31m✗ ${attrs.name}\x1b[0m\n${why}\n`;
            }
            default:
                return '';
        }
    }
}

/** A TeamCity attribute value's text. */
function unescape(v) {
    return v.replace(/\|(0x[0-9a-fA-F]{4}|.)/g, (_, c) => {
        if (c.length > 1) return String.fromCharCode(parseInt(c.slice(2), 16));
        return { n: '\n', r: '\r', "'": "'", '|': '|', '[': '[', ']': ']' }[c] ?? c;
    });
}
