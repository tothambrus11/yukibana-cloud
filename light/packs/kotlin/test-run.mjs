// Headless test of the Kotlin pack's runner, run the way the app runs it:
// app/static served over http with COOP/COEP (so the page is
// crossOriginIsolated and the program can read stdin), the runner started
// as `new Worker('/packs/kotlin/runner.js', { type: 'module' })` in
// Chromium, and kept for the next run while it says it is reusable.
//
// Run: the sample prints its output; a program reads two lines of stdin
// (its prompt shows before the read); with no stdin a read is end of file;
// a compile error is kotlinc's, on stderr with its place, and fails the run;
// an uncaught exception says what it was and exits 1; a program in a
// package with main(args) runs. Test: the sample's kotlin.test tests pass,
// a failing one fails Test with its message, and a project without tests
// says so. Stop: cancel ends an endless loop, and the next run still finds
// kotlinc warm.
//
//   node test-run.mjs        (after ./build.sh; needs playwright-core)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const STATIC = resolve(HERE, '../../app/static');
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.wasm': 'application/wasm' };
const ISOLATION = { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' };

// Raw files, no content-encoding negotiation: the worst-case transfer.
const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__test.html') {
        res.writeHead(200, { 'content-type': 'text/html', ...ISOLATION }).end('<!doctype html><link rel=icon href="data:,"><title>kotlin runner test</title>');
        return;
    }
    const file = normalize(join(STATIC, path));
    try {
        if (!file.startsWith(STATIC) || !(await stat(file)).isFile()) throw new Error('not a file');
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': body.length, 'cache-control': 'max-age=3600', ...ISOLATION });
        res.end(body);
    } catch {
        res.writeHead(404).end();
    }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const GEOMETRY = `import kotlin.math.hypot

/** A point in the plane. */
data class Point(val x: Double, val y: Double) {
    /** Distance from the origin. */
    fun norm(): Double = hypot(x, y)
}

/** Euclidean distance between two points. */
fun distance(a: Point, b: Point): Double = hypot(a.x - b.x, a.y - b.y)
`;
const MAIN = `fun main() {
    val a = Point(0.0, 0.0)
    val b = Point(3.0, 4.0)
    println("$a to $b: \${distance(a, b)}")
    println(b.norm())
}
`;
const TESTS = `import kotlin.test.Test
import kotlin.test.assertEquals

class GeometryTest {
    @Test
    fun normOfThreeFourIsFive() {
        assertEquals(5.0, Point(3.0, 4.0).norm())
    }

    @Test
    fun distanceIsSymmetric() {
        val a = Point(1.0, 2.0)
        val b = Point(-2.0, 6.0)
        assertEquals(distance(a, b), distance(b, a))
        assertEquals(5.0, distance(a, b))
    }

    @Test
    fun distanceToItselfIsZero() {
        val p = Point(1.5, -2.5)
        assertEquals(0.0, distance(p, p))
    }
}
`;
const M = 'src/main/kotlin/Main.kt';
const SAMPLE = { [M]: MAIN, 'src/main/kotlin/Geometry.kt': GEOMETRY, 'src/test/kotlin/GeometryTest.kt': TESTS };

await stat(join(STATIC, 'packs/kotlin/runner.js')).catch(() => {
    console.error(`no ${join(STATIC, 'packs/kotlin/runner.js')}: run ./build.sh first`);
    process.exit(2);
});
const browser = await chromium.launch({ executablePath: CHROMIUM });
let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
    if (!ok) failures++;
};
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

try {
    const page = await browser.newPage();
    page.on('console', (m) => m.type() === 'error' && console.log(`[page] ${m.text()}`));
    page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
    await page.goto(`${origin}/__test.html`);
    check('the page is cross-origin isolated', await page.evaluate(() => crossOriginIsolated));

    // In the page: run on the runner kept from the last run when it said it
    // takes another (`reusable`, as the app does), or on a new one; answer
    // its stdin requests from `inputs` (a string is a line, null is Ctrl-D);
    // collect every message in order. `cancelAfter` posts a cancel that many
    // ms after the phase "Running" (Stop).
    await page.evaluate(() => {
        window.kept = null;
        window.runProgram = (files, entry, inputs, type, withStdin, cancelAfter) =>
            new Promise((done) => {
                const t0 = performance.now();
                const sab = withStdin ? new SharedArrayBuffer(8 + 65536) : null;
                const state = sab && new Int32Array(sab, 0, 2);
                const data = sab && new Uint8Array(sab, 8);
                const out = { stdout: '', stderr: '', code: null, events: [], phases: [], marks: {}, reused: window.kept !== null, loading: 0 };
                const worker = window.kept ?? new Worker('/packs/kotlin/runner.js', { type: 'module' });
                window.kept = null;
                const timer = setTimeout(() => { worker.terminate(); out.code = 'timeout'; done(out); }, 180000);
                worker.onerror = (e) => { out.stderr += `worker error: ${e.message}`; };
                worker.onmessage = ({ data: msg }) => {
                    if (msg.type === 'stdout' || msg.type === 'stderr') { out[msg.type] += msg.text; out.events.push(`${msg.type}:${msg.text}`); }
                    else if (msg.type === 'loading') out.loading++;
                    else if (msg.type === 'mark') out.marks[msg.name] = msg.ms;
                    else if (msg.type === 'phase') {
                        out.phases.push(msg.text);
                        if (msg.text === 'Running' && cancelAfter !== null) setTimeout(() => worker.postMessage({ type: 'cancel' }), cancelAfter);
                    } else if (msg.type === 'stdin') {
                        out.events.push('stdin?');
                        const line = inputs.shift();
                        setTimeout(() => {
                            if (line === null || line === undefined) Atomics.store(state, 0, 3);
                            else {
                                const bytes = new TextEncoder().encode(line + '\n');
                                data.set(bytes);
                                Atomics.store(state, 1, bytes.length);
                                Atomics.store(state, 0, 2);
                            }
                            Atomics.notify(state, 0);
                        }, 10);
                    } else if (msg.type === 'exit') {
                        clearTimeout(timer);
                        out.code = msg.code;
                        out.reusable = msg.reusable === true;
                        out.ms = Math.round(performance.now() - t0);
                        if (out.reusable) window.kept = worker;
                        else worker.terminate();
                        done(out);
                    }
                };
                worker.postMessage({ type, files, entry, stdin: sab });
            });
    });
    const run = (files, { inputs = [], type = 'run', entry = M, stdin = true, cancelAfter = null } = {}) =>
        page.evaluate(([f, e, i, t, s, c]) => window.runProgram(f, e, i, t, s, c), [files, entry, inputs, type, stdin, cancelAfter]);
    const timing = (r) => `(${r.ms} ms: ${Object.entries(r.marks).map(([k, v]) => `${k} ${v}`).join(', ')})`;

    let r = await run(SAMPLE);
    check('Run prints the sample\'s output and exits with 0', r.code === 0 && r.stdout === 'Point(x=0.0, y=0.0) to Point(x=3.0, y=4.0): 5.0\n5.0\n',
        `${JSON.stringify(r.stdout)} ${JSON.stringify(plain(r.stderr))} code ${r.code} ${timing(r)}, cold, ${r.loading} progress messages`);
    check('the runner says what it is doing: Loading kotlinc, Compiling, Linking, Running', JSON.stringify(r.phases) === JSON.stringify(['Loading kotlinc', 'Compiling', 'Linking', 'Running']), JSON.stringify(r.phases));
    check('the runner takes another run after its program ends (reusable)', r.reusable === true, JSON.stringify(r.reusable));
    r = await run(SAMPLE);
    check('a second run, on the same runner, prints the same', r.reused && r.code === 0 && r.stdout.endsWith('5.0\n5.0\n'), `${JSON.stringify(r.stdout)} ${timing(r)}, warm`);

    const ECHO = `fun main() {
    print("Your name? ")
    val name = readln()
    println("Hello, $name!")
    val n = readln().trim().toInt()
    println(n * 2)
}
`;
    r = await run({ [M]: ECHO }, { inputs: ['Ada', '21'] });
    const beforeRead = r.events.slice(0, r.events.indexOf('stdin?'));
    check('a program reads two lines of stdin; its prompt shows before the read',
        r.code === 0 && r.stdout === 'Your name? Hello, Ada!\n42\n' && beforeRead.join('') === 'stdout:Your name? ',
        `${JSON.stringify(r.events)} ${plain(r.stderr)} ${timing(r)}`);
    r = await run({ [M]: 'fun main() {\n    var n = 0\n    while (readlnOrNull() != null) n++\n    println("$n lines")\n}\n' }, { inputs: ['one', 'two', null] });
    check('Ctrl-D ends the input: readlnOrNull is null after two lines', r.code === 0 && r.stdout === '2 lines\n', `${JSON.stringify(r.stdout)} ${plain(r.stderr)}`);
    r = await run({ [M]: 'fun main() {\n    println(readlnOrNull() ?: "end of file")\n}\n' }, { stdin: false });
    check('with no stdin buffer a read is end of file at once', r.code === 0 && r.stdout === 'end of file\n', `${JSON.stringify(r.stdout)} ${plain(r.stderr)}`);

    r = await run({ [M]: 'fun main() {\n    val n: Int = "seven"\n    println(n)\n}\n' });
    const err = plain(r.stderr);
    check('a type error is kotlinc\'s, on stderr with its file, line and column, and fails the run',
        r.code !== 0 && /^src\/main\/kotlin\/Main\.kt:2:\d+: error: .*mismatch.*'Int'.*'String'/m.test(err) && err.includes('    val n: Int = "seven"') && r.stdout === '',
        `${JSON.stringify(err)} code ${r.code}`);
    r = await run({ [M]: 'fun main() {\n    println("before")\n    val xs = listOf(1)\n    println(xs[3])\n}\n' });
    check('an uncaught exception says what it was, after the output before it, and exits with 1',
        r.code === 1 && r.stdout === 'before\n' && /Exception in thread "main" IndexOutOfBoundsException/.test(r.stderr), `${JSON.stringify(r.stdout)} ${JSON.stringify(r.stderr)} code ${r.code}`);
    r = await run({ 'src/main/kotlin/app/App.kt': 'package app\n\nfun main(args: Array<String>) {\n    println("args: ${args.size}")\n    check(args.isEmpty()) { "no args" }\n}\n' }, { entry: 'src/main/kotlin/app/App.kt' });
    check('a main(args) in a package runs, with no arguments', r.code === 0 && r.stdout === 'args: 0\n', `${JSON.stringify(r.stdout)} ${plain(r.stderr)}`);
    r = await run({ [M]: 'fun helper() = 1\n' });
    check('an entry file without main says so and fails', r.code !== 0 && /main/.test(r.stderr), `${JSON.stringify(plain(r.stderr))} code ${r.code}`);

    r = await run(SAMPLE, { type: 'test' });
    const report = plain(r.stdout);
    check('Test runs the sample\'s three kotlin.test tests and passes', r.code === 0 && /GeometryTest/.test(report) && /✓ normOfThreeFourIsFive/.test(report) && /3 tests: 3 passed/.test(report),
        `${JSON.stringify(report)} ${JSON.stringify(plain(r.stderr))} code ${r.code} ${timing(r)}`);
    r = await run({ ...SAMPLE, 'src/test/kotlin/GeometryTest.kt': TESTS.replace('assertEquals(0.0, distance(p, p))', 'assertEquals(1.0, distance(p, p), "a point is not at distance 0 from itself")') }, { type: 'test' });
    const failed = plain(r.stdout);
    check('a failing assertion fails Test, named with its message', r.code === 1 && /✗ distanceToItselfIsZero/.test(failed) && /Expected <1\.0>, actual <0\.0>/.test(failed) && /2 passed, 1 failed/.test(failed),
        `${JSON.stringify(failed)} code ${r.code}`);
    r = await run({ [M]: MAIN, 'src/main/kotlin/Geometry.kt': GEOMETRY }, { type: 'test' });
    check('Test on a project without tests says so and fails', r.code === 1 && /No tests/.test(r.stderr), `${JSON.stringify(r.stderr)} code ${r.code}`);

    r = await run({ [M]: 'fun main() {\n    println("spinning")\n    var i = 0L\n    while (true) i++\n}\n' }, { cancelAfter: 500 });
    check('Stop (cancel) ends an endless loop: exit 130, and the runner takes another run', r.code === 130 && r.reusable && r.stdout === 'spinning\n', `${JSON.stringify(r.stdout)} code ${r.code} reusable ${r.reusable}`);
    r = await run(SAMPLE);
    check('after Stop, the same runner runs the sample again, kotlinc still warm', r.reused && r.code === 0 && r.stdout.endsWith('5.0\n') && r.ms < 10000, `${timing(r)}`);
} finally {
    await browser.close();
    server.close();
}
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
