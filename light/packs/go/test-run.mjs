// Headless test of the Go runner (../CONTRACT.md, "Running a program"), run
// the way the app runs it: app/static served over http with
// Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy, so the page is
// crossOriginIsolated; `new Worker('/packs/go/runner.js', { type: 'module' })`
// in Chromium; one { type: 'run' } (or 'test') message; stdin through the
// SharedArrayBuffer protocol, driven from the page as the app's terminal does.
//
//   node test-run.mjs        (after ./build.sh; needs playwright-core)
//
// The Linux targets need the C/C++ pack's emulator in app/static/packs/cpp
// (vm.js and vm/<arch>/; ../cpp/build.sh, or a copy of a deployed one).
// Without it those cases fail, unless ALLOW_SKIP=1 is set, which skips them.
//
// Adapted from ../swift/test-run.mjs.

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const STATIC = resolve(HERE, '../../app/static');
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.html': 'text/html' };
const ISOLATION = {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
};

// Static files with the isolation headers, serving the .br sibling when the
// browser accepts brotli, as the app's host does.
let bytesSent = 0;
const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__test.html') {
        res.writeHead(200, { 'content-type': 'text/html', ...ISOLATION });
        res.end('<!doctype html><link rel=icon href="data:,"><title>go runner test</title>');
        return;
    }
    const file = normalize(join(STATIC, path));
    try {
        if (!file.startsWith(STATIC) || !(await stat(file)).isFile()) throw new Error('not a file');
        const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=3600', ...ISOLATION };
        let body;
        if (/\bbr\b/.test(req.headers['accept-encoding'] ?? '')) {
            try {
                body = await readFile(file + '.br');
                headers['content-encoding'] = 'br';
            } catch {}
        }
        body ??= await readFile(file);
        headers['content-length'] = body.length;
        bytesSent += body.length;
        res.writeHead(200, headers).end(body);
    } catch {
        res.writeHead(404).end();
    }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

// The sample project of app/src/lib/languages.ts, read from there so the test
// runs exactly what a new project contains.
const languages = await readFile(resolve(HERE, '../../app/src/lib/languages.ts'), 'utf8');
const SAMPLE = sampleOf(languages, 'go');
const EXPECTED = '(0, 0) to (3, 4): 5\n5\n';
const MOD = 'module example.com/demo\n\ngo 1.27\n';

const STDIN = {
    'go.mod': MOD,
    'main.go': `package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	read := func(prompt string) int {
		fmt.Print(prompt)
		line, _ := in.ReadString('\\n')
		n, _ := strconv.Atoi(strings.TrimSpace(line))
		return n
	}
	a := read("first number: ")
	b := read("second number: ")
	fmt.Println("sum:", a+b)
}
`,
};
const EOF = {
    'go.mod': MOD,
    'main.go': `package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	s := bufio.NewScanner(os.Stdin)
	n := 0
	for s.Scan() {
		n++
		fmt.Println("got", s.Text())
	}
	fmt.Println("end of input after", n, "lines")
}
`,
};
const TYPE_ERROR = { 'go.mod': MOD, 'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n\tvar x int = "no"\n\tfmt.Println(x)\n}\n' };
const PANIC = { 'go.mod': MOD, 'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n\tvar s []int\n\tfmt.Println("before")\n\tfmt.Println(s[3])\n}\n' };
const GOROUTINES = {
    'go.mod': MOD,
    'main.go': `package main

import (
	"fmt"
	"runtime"
	"sync"
	"time"
)

func main() {
	start := time.Now()
	var wg sync.WaitGroup
	results := make(chan int, 8)
	for i := range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			time.Sleep(time.Duration(10*(8-i)) * time.Millisecond)
			results <- i * i
		}()
	}
	wg.Wait()
	close(results)
	sum := 0
	for r := range results {
		sum += r
	}
	fmt.Printf("%s/%s: sum %d after at least %v\\n", runtime.GOOS, runtime.GOARCH, sum, time.Since(start) >= 80*time.Millisecond)
}
`,
};
const EXIT3 = { 'go.mod': MOD, 'main.go': 'package main\n\nimport (\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\tfmt.Fprintln(os.Stderr, "leaving with 3")\n\tos.Exit(3)\n}\n' };
const NIL = { 'go.mod': MOD, 'main.go': 'package main\n\ntype T struct{ x int }\n\nfunc main() {\n\tvar p *T\n\tprintln(p.x)\n}\n' };
const FOREVER = { 'go.mod': MOD, 'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("looping")\n\tfor i := 0; ; i++ {\n\t}\n}\n' };
const FAILING_TEST = {
    ...SAMPLE,
    'point/fail_test.go': 'package point\n\nimport "testing"\n\nfunc TestWrong(t *testing.T) {\n\tif got := (Point{X: 3, Y: 4}).Norm(); got != 6 {\n\t\tt.Errorf("Norm() = %v, want 6", got)\n\t}\n}\n',
};
const withTarget = (files, goarch) => ({ ...files, 'go.env': `GOOS=linux\nGOARCH=${goarch}\n` });

const browser = await chromium.launch({ executablePath: CHROMIUM });
let failed = 0;
const check = (name, ok, detail = '') => {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('console', (m) => process.env.VERBOSE && console.log('[page]', m.text()));
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto(`${origin}/__test.html`);
    check('the page is crossOriginIsolated', await page.evaluate(() => crossOriginIsolated));

    // In the page: start the runner (or reuse the kept one), answer stdin
    // requests from `inputs` (one line each, then end of file), optionally
    // terminate it after the program printed `stopAfter`.
    await page.evaluate(() => {
        window.runProject = (files, { inputs = [], stopAfter = null, entry = 'main.go', type = 'run', keep = false, options = undefined, cancelAfter = null } = {}) =>
            new Promise((done) => {
                const t0 = performance.now();
                const result = { stdout: '', stderr: '', kernel: '', code: null, phases: [], loading: {}, marks: {}, stdinRequests: 0, stdoutBeforeInput: [], terminated: false };
                const sab = new SharedArrayBuffer(8 + 65536);
                const state = new Int32Array(sab, 0, 2);
                const data = new Uint8Array(sab, 8);
                const worker = keep ? (window.kept ??= new Worker('/packs/go/runner.js', { type: 'module' })) : new Worker('/packs/go/runner.js', { type: 'module' });
                const finish = () => {
                    result.ms = Math.round(performance.now() - t0);
                    done(result);
                };
                worker.onerror = (e) => {
                    result.stderr += `worker error: ${e.message}\n`;
                    finish();
                };
                const answer = (line) => {
                    if (line === undefined) Atomics.store(state, 0, 3);
                    else {
                        const bytes = new TextEncoder().encode(line + '\n');
                        data.set(bytes);
                        Atomics.store(state, 1, bytes.length);
                        Atomics.store(state, 0, 2);
                    }
                    Atomics.notify(state, 0);
                };
                worker.onmessage = ({ data: m }) => {
                    const at = Math.round(performance.now() - t0);
                    if (m.type === 'stdout') result.stdout += m.text;
                    else if (m.type === 'stderr') result.stderr += m.text;
                    else if (m.type === 'kernel') result.kernel += m.text;
                    else if (m.type === 'phase') result.phases.push([m.text, at]);
                    else if (m.type === 'mark') result.marks[m.name] = m.ms;
                    else if (m.type === 'loading') result.loading[m.label] = [m.loaded, m.total];
                    else if (m.type === 'stdin') {
                        // A streaming request (a Linux target) is answered
                        // when there is a line, and only then.
                        if (m.streaming) {
                            if (inputs.length) setTimeout(() => answer(inputs.shift()), 0);
                            return;
                        }
                        result.stdinRequests++;
                        result.stdoutBeforeInput.push(result.stdout);
                        if (Atomics.load(state, 0) !== 1) result.stderr += 'stdin requested with state != 1\n';
                        answer(inputs.shift());
                    } else if (m.type === 'exit') {
                        result.code = m.code;
                        result.reusable = m.reusable === true;
                        if (!keep || !result.reusable) worker.terminate();
                        if (keep && !result.reusable) window.kept = undefined;
                        finish();
                    }
                    if (cancelAfter && m.type === 'stdout' && result.stdout.includes(cancelAfter) && !result.cancelled) {
                        result.cancelled = true;
                        setTimeout(() => worker.postMessage({ type: 'cancel' }), 500);
                    }
                    if (stopAfter && m.type === 'stdout' && result.stdout.includes(stopAfter)) {
                        setTimeout(() => {
                            worker.terminate();
                            result.terminated = true;
                            finish();
                        }, 1000);
                    }
                };
                worker.postMessage({ type, files, entry, stdin: sab, ...(options ? { options } : {}) });
            });
    });

    const run = (files, opts) => page.evaluate(([f, o]) => window.runProject(f, o), [files, opts ?? {}]);
    const timeline = (r) => r.phases.map(([t, ms]) => `${t}@${ms}`).join(', ');

    // 1. The sample, cold, then again in the same worker.
    bytesSent = 0;
    const cold = await run(SAMPLE, { keep: true });
    check(
        'sample project (cold): main.go + point/point.go print the distance and the norm, exit 0, reusable',
        cold.code === 0 && cold.stdout === EXPECTED && cold.reusable,
        `${JSON.stringify(cold.stdout)} code=${cold.code} in ${cold.ms} ms, ${(bytesSent / 1e6).toFixed(1)} MB transferred; ${timeline(cold)}`,
    );
    if (cold.stderr) console.log(cold.stderr);
    const loads = Object.entries(cold.loading);
    check('loading messages end at their totals', loads.length > 10 && loads.every(([, [l, t]]) => l === t && l > 0), `${loads.length} downloads`);
    const warm = await run(SAMPLE, { keep: true });
    check('the next run in that worker loads nothing and gives the same output',
        warm.code === 0 && warm.stdout === EXPECTED && Object.keys(warm.loading).length === 0,
        `in ${warm.ms} ms (cold ${cold.ms} ms); marks ${JSON.stringify(warm.marks)}`);

    // 2. stdin.
    const r = await run(STDIN, { inputs: ['19', '23'], keep: true });
    check(
        'bufio: a prompt without newline, two lines of stdin, their sum',
        r.code === 0 && r.stdout === 'first number: second number: sum: 42\n' && r.stdinRequests === 2 && r.stdoutBeforeInput[0] === 'first number: ',
        `${JSON.stringify(r.stdout)} requests=${r.stdinRequests} seen-before-input=${JSON.stringify(r.stdoutBeforeInput)} code=${r.code}`,
    );
    const eof = await run(EOF, { inputs: ['one', 'two'], keep: true });
    check('end of input (Ctrl-D) ends a bufio.Scanner', eof.code === 0 && eof.stdout === 'got one\ngot two\nend of input after 2 lines\n',
        `code=${eof.code} ${JSON.stringify(eof.stdout)} requests=${eof.stdinRequests}`);

    // 3. Errors.
    const broken = await run(TYPE_ERROR, { keep: true });
    check(
        'a type error: the compiler\'s message at a project path on stderr, exit 1, nothing run',
        broken.code === 1 && /^main\.go:6:14: cannot use "no" \(untyped string constant\) as int value in variable declaration$/m.test(broken.stderr) &&
            !broken.phases.some(([t]) => t === 'Running') && broken.reusable,
        `code=${broken.code}\n${broken.stderr.trimEnd()}`,
    );
    const panicked = await run(PANIC, { keep: true });
    check('a panic: Go\'s message and traceback, exit 2',
        panicked.code === 2 && panicked.stdout === 'before\n' && panicked.stderr.includes('panic: runtime error: index out of range [3] with length 0') && panicked.stderr.includes('main.main()'),
        `code=${panicked.code} ${JSON.stringify(panicked.stderr.slice(0, 200))}`);
    const exit3 = await run(EXIT3, { keep: true });
    check('os.Exit(3) exits 3', exit3.code === 3 && exit3.stderr === 'leaving with 3\n', `code=${exit3.code} ${JSON.stringify(exit3.stderr)}`);
    const routines = await run(GOROUTINES, { keep: true });
    check('goroutines, channels and time.Sleep', routines.code === 0 && routines.stdout === 'wasip1/wasm: sum 140 after at least true\n',
        `code=${routines.code} ${JSON.stringify(routines.stdout)} ${routines.stderr} in ${routines.ms} ms`);
    const badEnv = await run({ ...SAMPLE, 'go.env': 'GOOS=windows\nGOARCH=amd64\n' }, { keep: true });
    check('an unsupported go.env target is named on stderr and the default is built',
        badEnv.code === 0 && badEnv.stdout === EXPECTED && /^go\.env:1: unsupported target windows\/amd64/m.test(badEnv.stderr), `code=${badEnv.code} ${badEnv.stderr}`);

    // 4. Tests.
    const tested = await run(SAMPLE, { type: 'test', keep: true });
    check(
        'Test: the sample\'s tests and example pass, ok per package, no test files for main',
        tested.code === 0 && tested.stdout.includes('--- PASS: TestNorm') && tested.stdout.includes('--- PASS: ExampleDistance') &&
            /^ok  \texample\.com\/geometry\/point\t[\d.]+s$/m.test(tested.stdout) && tested.stdout.includes('?   \texample.com/geometry\t[no test files]'),
        `code=${tested.code}\n${tested.stdout.trimEnd()}\n${tested.stderr}`,
    );
    const failing = await run(FAILING_TEST, { type: 'test', keep: true });
    check('Test: a failing test fails the package and the run',
        failing.code === 1 && failing.stdout.includes('--- FAIL: TestWrong') && failing.stdout.includes('fail_test.go:7: Norm() = 5, want 6') && /^FAIL\texample\.com\/geometry\/point/m.test(failing.stdout),
        `code=${failing.code}\n${failing.stdout.trimEnd()}`);

    // 5. Linux targets under QEMU-Wasm.
    const vm = existsSync(join(STATIC, 'packs/cpp/vm.js'));
    if (!vm && process.env.ALLOW_SKIP === '1') {
        console.log('SKIP  Linux targets: no packs/cpp/vm.js');
    } else {
        for (const goarch of ['amd64', 'arm64', 'riscv64']) {
            const linux = await run(withTarget(GOROUTINES, goarch), { keep: true });
            check(
                `linux/${goarch}: built by the same compiler, run under QEMU, goroutines and timers work`,
                linux.code === 0 && linux.stdout === `linux/${goarch}: sum 140 after at least true\n` && linux.reusable,
                `code=${linux.code} ${JSON.stringify(linux.stdout)} ${linux.stderr.trim()} in ${linux.ms} ms; marks ${JSON.stringify(linux.marks)}`,
            );
        }
        const arm = await run(withTarget(SAMPLE, 'arm64'), { keep: true });
        check('linux/arm64: the sample', arm.code === 0 && arm.stdout === EXPECTED, `code=${arm.code} ${JSON.stringify(arm.stdout)} ${arm.stderr}`);
        const linuxIn = await run(withTarget(STDIN, 'riscv64'), { keep: true, inputs: ['19', '23'] });
        check('linux/riscv64: stdin streamed to the guest', linuxIn.code === 0 && linuxIn.stdout === 'first number: second number: sum: 42\n',
            `code=${linuxIn.code} ${JSON.stringify(linuxIn.stdout)} ${linuxIn.stderr}`);
        const linuxExit = await run(withTarget(EXIT3, 'amd64'), { keep: true });
        check('linux/amd64: os.Exit(3) exits 3', linuxExit.code === 3 && linuxExit.stderr.includes('leaving with 3'), `code=${linuxExit.code} ${linuxExit.stderr}`);
        const linuxNil = await run(withTarget(NIL, 'arm64'), { keep: true });
        check('linux/arm64: a nil dereference is the kernel\'s SIGSEGV, which Go turns into its panic',
            linuxNil.code === 2 && linuxNil.stderr.includes('invalid memory address or nil pointer dereference') && linuxNil.stderr.includes('SIGSEGV'),
            `code=${linuxNil.code} ${JSON.stringify(linuxNil.stderr.slice(0, 300))}`);
        const linuxTest = await run(withTarget(SAMPLE, 'amd64'), { type: 'test', keep: true });
        check('linux/amd64: Test runs the test binary in the VM', linuxTest.code === 0 && /^ok  \texample\.com\/geometry\/point/m.test(linuxTest.stdout),
            `code=${linuxTest.code}\n${linuxTest.stdout.trimEnd()}\n${linuxTest.stderr}`);
        const cancelled = await run(withTarget(FOREVER, 'amd64'), { keep: true, cancelAfter: 'looping' });
        const next = await run(SAMPLE, { keep: true });
        check('linux/amd64: cancel stops a program that never ends, and the worker runs the next project',
            cancelled.code === 130 && cancelled.reusable && next.code === 0 && next.stdout === EXPECTED,
            `cancel code=${cancelled.code}; next code=${next.code} ${JSON.stringify(next.stdout)}`);
    }

    // 6. A program that never ends, in the worker's own thread: Stop
    // terminates the worker.
    const forever = await run(FOREVER, { stopAfter: 'looping' });
    check('a program that never ends prints, then is stopped by terminating the worker', forever.terminated && forever.stdout === 'looping\n', `${JSON.stringify(forever.stdout)}`);
} finally {
    await browser.close();
    server.close();
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);

/** The sample project of a language, evaluated from languages.ts's source. */
function sampleOf(source, id) {
    const at = source.indexOf(`id: '${id}'`);
    const start = source.indexOf('sample: {', at) + 'sample: '.length;
    let depth = 0;
    let i = start;
    let inTemplate = false;
    for (; i < source.length; i++) {
        const c = source[i];
        if (inTemplate) {
            if (c === '\\') i++;
            else if (c === '`') inTemplate = false;
        } else if (c === '`') inTemplate = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) break;
    }
    return new Function(`return (${source.slice(start, i + 1)});`)();
}
