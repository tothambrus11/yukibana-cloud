// Headless test of the Rust runner (../CONTRACT.md, "Running a program"),
// run the way the app runs it: app/static served over http WITH
// Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy, so the page is
// crossOriginIsolated; `new Worker('/packs/rust/runner.js', { type: 'module' })`
// in Chromium; one { type: 'run' } or { type: 'test' } message; stdin through
// the SharedArrayBuffer protocol, driven from the page as the app's terminal
// does.
//
//   node test-run.mjs        (after ./build.sh; needs playwright-core)
//
// Cases: the app's sample project (languages.ts: Cargo.toml, src/main.rs
// using the library in src/lib.rs + src/point.rs) cold and warm, its tests
// (unit tests in src/point.rs, integration tests in tests/), a failing
// test, a prompt without newline and two lines of stdin, end of input, a
// type error and a borrow error (rustc's diagnostics, non-zero exit, nothing
// run), a panic (exit 101), process::exit, and a program that never ends,
// which the page stops by terminating the worker. Property-based tests with
// quickcheck (declared in Cargo.toml): one that holds, one whose shrunk
// counterexample is reported, the crates' archive fetched only for a project
// that declares them, and a version requirement it does not meet.
// Optimization levels and the debug info of opt-level 0. Under Miri:
// a type's layout on three Miri targets (i686's 4-aligned u64, s390x's
// byte order), undefined behaviour reported where it happens,
// catch_unwind, and tests under libtest. On the Linux targets (x86-64,
// AArch64, RISC-V), when the C/C++ pack's emulator is there: the sample,
// its tests under libtest, and a caught panic.
//
// The Linux cases need packs/cpp/vm.js and its files. Without them in
// app/static they are skipped, unless CPP_PACK_ORIGIN names a Light that
// has them (https://light.yukibana.dev), whose /packs/cpp/ this server
// then forwards.
//
// Adapted from ../swift/test-run.mjs.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const STATIC = resolve(HERE, '../../app/static');
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';

const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.tar': 'application/x-tar', '.html': 'text/html' };
const ISOLATION = {
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
};

// Static files with the isolation headers, serving the .br sibling when the
// browser accepts brotli, as the app's host does; cacheable, so the second
// run measures a warm cache.
let bytesSent = 0;
const CPP_ORIGIN = process.env.CPP_PACK_ORIGIN?.replace(/\/$/, '') ?? null;
const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (CPP_ORIGIN && path.startsWith('/packs/cpp/')) {
        const upstream = await fetch(CPP_ORIGIN + path);
        const body = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'max-age=3600', 'cross-origin-resource-policy': 'same-origin', ...ISOLATION });
        res.end(body);
        return;
    }
    if (path === '/__test.html') {
        res.writeHead(200, { 'content-type': 'text/html', ...ISOLATION });
        res.end('<!doctype html><link rel=icon href="data:,"><title>rust runner test</title>');
        return;
    }
    if (path === '/__sw.js') {
        // What the app's service worker does for /packs/** (app/src/service-worker):
        // cache-first in Cache Storage, filled on the first download.
        res.writeHead(200, { 'content-type': 'text/javascript', ...ISOLATION });
        res.end(`self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
    if (!new URL(e.request.url).pathname.startsWith('/packs/')) return;
    e.respondWith((async () => {
        const cache = await caches.open('packs');
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const response = await fetch(e.request);
        if (response.ok) e.waitUntil(cache.put(e.request, response.clone()));
        return response;
    })());
});`);
        return;
    }
    const file = normalize(join(STATIC, path));
    try {
        if (!file.startsWith(STATIC) || !(await stat(file)).isFile()) throw new Error('not a file');
        const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=3600', ...ISOLATION };
        let body;
        if (/\bbr\b/.test(req.headers['accept-encoding'] ?? '') && !file.endsWith('.gz')) {
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

const languages = await readFile(resolve(HERE, '../../app/src/lib/languages.ts'), 'utf8');
const SAMPLE = sampleOf(languages, 'rust');
const MANIFEST = { 'Cargo.toml': '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n' };
const QC_WASM = 'quickcheck-1.0.3-wasm32-wasip1.tar';
const plain = (text) => text.replace(/\u001b\[[0-9;]*m/g, '');

const STDIN = {
    ...MANIFEST,
    'src/main.rs': `use std::io::{self, BufRead, Write};

fn main() {
    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    print!("first number: ");
    io::stdout().flush().unwrap();
    let a: i64 = lines.next().unwrap().unwrap().trim().parse().unwrap();
    print!("second number: ");
    io::stdout().flush().unwrap();
    let b: i64 = lines.next().unwrap().unwrap().trim().parse().unwrap();
    println!("sum: {}", a + b);
}
`,
};
const EOF = {
    ...MANIFEST,
    'src/main.rs': `use std::io::BufRead;

fn main() {
    let mut n = 0;
    for line in std::io::stdin().lock().lines() {
        n += 1;
        println!("got {}", line.unwrap());
    }
    println!("end of input after {n} lines");
}
`,
};
const TYPE_ERROR = { ...MANIFEST, 'src/main.rs': 'fn main() {\n    let x: i32 = "no";\n    println!("{x}");\n}\n' };
const BORROW_ERROR = {
    ...MANIFEST,
    'src/main.rs': 'fn main() {\n    let v = vec![1, 2, 3];\n    let w = v;\n    println!("{:?} {:?}", v, w);\n}\n',
};
const PANIC = { ...MANIFEST, 'src/main.rs': 'fn main() {\n    let v: Vec<i32> = Vec::new();\n    println!("before");\n    println!("{}", v[1]);\n}\n' };
const EXIT = { ...MANIFEST, 'src/main.rs': 'fn main() {\n    println!("leaving");\n    std::process::exit(3);\n}\n' };
const FOREVER = { ...MANIFEST, 'src/main.rs': 'fn main() {\n    println!("looping");\n    let mut i: u64 = 0;\n    loop {\n        i = i.wrapping_add(1);\n    }\n}\n' };
const PROPERTIES = {
    'Cargo.toml': '[package]\nname = "props"\nversion = "0.1.0"\nedition = "2021"\n\n[dev-dependencies]\nquickcheck = "1"\n',
    'src/lib.rs': 'pub fn distance(a: (f64, f64), b: (f64, f64)) -> f64 {\n    (a.0 - b.0).hypot(a.1 - b.1)\n}\n',
    'tests/properties.rs': `use props::distance;
use quickcheck::{quickcheck, TestResult};

quickcheck! {
    fn distance_is_symmetric(ax: f64, ay: f64, bx: f64, by: f64) -> TestResult {
        if [ax, ay, bx, by].iter().any(|v| !v.is_finite()) {
            return TestResult::discard();
        }
        TestResult::from_bool(distance((ax, ay), (bx, by)) == distance((bx, by), (ax, ay)))
    }

    fn norm_stays_under_100(x: u8) -> bool {
        distance((x as f64, 0.0), (0.0, 0.0)) < 100.0
    }
}
`,
};
const SINGLE = { 'src/main.rs': 'use std::collections::HashMap;\n\nfn main() {\n    let mut m = HashMap::new();\n    for w in "a b a c b a".split(\' \') {\n        *m.entry(w).or_insert(0) += 1;\n    }\n    let mut v: Vec<_> = m.into_iter().collect();\n    v.sort();\n    println!("{v:?}");\n}\n' };

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
    await page.evaluate(async () => {
        await navigator.serviceWorker.register('/__sw.js');
        await navigator.serviceWorker.ready;
    });
    await page.reload();
    check('the page is crossOriginIsolated and controlled by a service worker that caches /packs/',
        await page.evaluate(() => crossOriginIsolated && !!navigator.serviceWorker.controller));

    // In the page: start the runner, answer stdin requests from `inputs` (one
    // line each, then end of file), optionally terminate it after the program
    // printed `stopAfter`. Resolves with what came back and when.
    await page.evaluate(() => {
        window.runProject = (files, { inputs = [], stopAfter = null, entry = 'src/main.rs', type = 'run', options = {} } = {}) =>
            new Promise((done) => {
                const t0 = performance.now();
                const result = { stdout: '', stderr: '', code: null, phases: [], loading: {}, stdinRequests: 0, stdoutBeforeInput: [], terminated: false };
                const sab = new SharedArrayBuffer(8 + 65536);
                const state = new Int32Array(sab, 0, 2);
                const data = new Uint8Array(sab, 8);
                const worker = new Worker('/packs/rust/runner.js', { type: 'module' });
                const finish = () => {
                    result.ms = Math.round(performance.now() - t0);
                    done(result);
                };
                worker.onerror = (e) => {
                    result.stderr += `worker error: ${e.message}\n`;
                    finish();
                };
                worker.onmessage = ({ data: m }) => {
                    const at = Math.round(performance.now() - t0);
                    if (m.type === 'stdout') result.stdout += m.text.replace(/\u001b\[[0-9;]*m/g, '');
                    else if (m.type === 'stderr') result.stderr += m.text;
                    else if (m.type === 'phase') result.phases.push([m.text, at]);
                    else if (m.type === 'loading') result.loading[m.label] = [m.loaded, m.total];
                    else if (m.type === 'stdin') {
                        // What the terminal shows when the program asks.
                        result.stdinRequests++;
                        result.stdoutBeforeInput.push(result.stdout);
                        const line = inputs.shift();
                        if (Atomics.load(state, 0) !== 1) result.stderr += 'stdin requested with state != 1\n';
                        if (line === undefined) Atomics.store(state, 0, 3);
                        else {
                            const bytes = new TextEncoder().encode(line + '\n');
                            data.set(bytes);
                            Atomics.store(state, 1, bytes.length);
                            Atomics.store(state, 0, 2);
                        }
                        Atomics.notify(state, 0);
                    } else if (m.type === 'exit') {
                        result.code = m.code;
                        worker.terminate();
                        finish();
                    }
                    if (stopAfter && m.type === 'stdout' && result.stdout.includes(stopAfter)) {
                        // Let it spin a moment, then Stop as the app does.
                        setTimeout(() => {
                            worker.terminate();
                            result.terminated = true;
                            finish();
                        }, 1000);
                    }
                };
                worker.postMessage({ type, files, entry, stdin: sab, options });
            });
    });

    const run = (files, opts) => page.evaluate(([f, o]) => window.runProject(f, o), [files, opts ?? {}]);
    const timeline = (r) => r.phases.map(([t, ms]) => `${t}@${ms}`).join(', ');

    // 1. The sample, cold then warm.
    const EXPECTED = '(0, 0) to (3, 4): 5\n5\n';
    bytesSent = 0;
    const cold = await run(SAMPLE);
    const coldBytes = bytesSent;
    check(
        'sample project (cold): src/main.rs uses the geometry library (src/lib.rs, src/point.rs), prints the distance and the norm, exit 0',
        cold.code === 0 && cold.stdout === EXPECTED,
        `${JSON.stringify(cold.stdout)} code=${cold.code} in ${cold.ms} ms, ${(coldBytes / 1e6).toFixed(1)} MB transferred; ${timeline(cold)}`,
    );
    if (cold.code !== 0) console.log(plain(cold.stderr));
    const loads = Object.entries(cold.loading).map(([k, [l, t]]) => `${k} ${l}/${t}`);
    check('loading messages for the WebAssembly compiler and standard library only: the default target needs neither the cross compiler nor an emulator',
        loads.length === 2 && cold.loading['rustc.wasm'] !== undefined && cold.loading['sysroot-wasm32-wasip1.tar'] !== undefined && Object.values(cold.loading).every(([l, t]) => l === t && l > 0),
        loads.join(', '));
    bytesSent = 0;
    const warm = await run(SAMPLE);
    check('sample project (warm): same output from the browser cache', warm.code === 0 && warm.stdout === EXPECTED,
        `code=${warm.code} in ${warm.ms} ms, ${bytesSent} bytes transferred; ${timeline(warm)}`);

    // 2. Tests, as cargo test runs them.
    const tests = await run(SAMPLE, { type: 'test' });
    const results = [...tests.stdout.matchAll(/^test (\S+) \.\.\. (ok|FAILED)$/gm)].map((m) => `${m[1]} ${m[2]}`);
    check(
        'cargo test: the unit test in src/point.rs and the three integration tests in tests/geometry.rs pass, exit 0',
        tests.code === 0 &&
            JSON.stringify(results) === JSON.stringify(['point::tests::norm_of_3_4_is_5 ok', 'distance_is_symmetric ok', 'distance_to_itself_is_zero ok', 'points_print_as_pairs ok']) &&
            /Running unittests src\/lib\.rs/.test(plain(tests.stderr)) && /Running tests\/geometry\.rs/.test(plain(tests.stderr)),
        `code=${tests.code} in ${tests.ms} ms ${JSON.stringify(results)}`,
    );
    if (tests.code !== 0) console.log(plain(tests.stderr), tests.stdout);
    const failingSample = () => ({ ...SAMPLE, 'tests/geometry.rs': SAMPLE['tests/geometry.rs'].replace('"(1, 2.5)"', '"(1.0, 2.5)"') });
    const failing = await run(failingSample(), { type: 'test' });
    check(
        'cargo test: a failing assert_eq! is reported with both values, the others still run, exit 101',
        failing.code === 101 && /test points_print_as_pairs \.\.\. FAILED/.test(failing.stdout) && /test distance_is_symmetric \.\.\. ok/.test(failing.stdout) &&
            /left: "\(1, 2\.5\)"/.test(failing.stdout) && /test result: FAILED\. 2 passed; 1 failed/.test(failing.stdout),
        `code=${failing.code} ${failing.stdout.split('\n').filter((l) => /left|right|test result/.test(l)).join(' | ')}`,
    );
    check('cargo test: quickcheck, a dev-dependency of the sample, is downloaded for Test (not for Run)',
        tests.loading[QC_WASM] !== undefined && cold.loading[QC_WASM] === undefined, Object.keys(tests.loading).join(', '));

    // 2b. Property-based tests with quickcheck, a dev-dependency.
    const props = await run(PROPERTIES, { type: 'test' });
    const propResults = [...props.stdout.matchAll(/^test (\S+) \.\.\. (ok|FAILED)$/gm)].map((m) => `${m[1]} ${m[2]}`);
    check(
        'quickcheck: a property that holds passes, one that does not fails with its shrunk counterexample (100), exit 101',
        props.code === 101 &&
            JSON.stringify(propResults) === JSON.stringify(['distance_is_symmetric ok', 'norm_stays_under_100 FAILED']) &&
            /\[quickcheck\] TEST FAILED\. Arguments: \(100\)/.test(props.stdout) &&
            /test result: FAILED\. 1 passed; 1 failed/.test(props.stdout),
        `code=${props.code} in ${props.ms} ms ${JSON.stringify(propResults)} ${props.stdout.split('\n').filter((l) => /quickcheck/.test(l)).join(' | ')}`,
    );
    if (props.code !== 101) console.log(plain(props.stderr), props.stdout);
    const undeclared = await run({ ...PROPERTIES, 'Cargo.toml': MANIFEST['Cargo.toml'].replace('demo', 'props') }, { type: 'test' });
    check('quickcheck: without the declaration in Cargo.toml it is unresolved (E0432) and not downloaded, as with Cargo',
        undeclared.code !== 0 && /E0432|E0433/.test(plain(undeclared.stderr)) && /quickcheck/.test(plain(undeclared.stderr)) &&
            undeclared.loading[QC_WASM] === undefined,
        `code=${undeclared.code} ${Object.keys(undeclared.loading).join(', ')} ${plain(undeclared.stderr).split('\n').filter((l) => /^error/.test(l)).join(' | ')}`);
    const old = await run({
        'Cargo.toml': '[package]\nname = "old"\nedition = "2021"\n\n[dependencies]\nquickcheck = { version = "0.9", default-features = false }\n',
        'src/main.rs': 'fn main() {\n    let mut g = quickcheck::Gen::new(10);\n    let v: Vec<u8> = quickcheck::Arbitrary::arbitrary(&mut g);\n    println!("{}", v.len() <= 10);\n}\n',
    });
    check('quickcheck: a [dependencies] entry reaches the binary; a requirement 1.0.3 does not meet is a warning',
        old.code === 0 && old.stdout === 'true\n' && /warning: quickcheck 1\.0\.3 is the only version here; Cargo\.toml asks for "0\.9"/.test(old.stderr),
        `code=${old.code} ${JSON.stringify(old.stdout)} ${plain(old.stderr).split('\n')[0]}`);

    const runOfTests = await run(SAMPLE, {});
    check("'run' of the same project runs the program, not its tests", runOfTests.code === 0 && runOfTests.stdout === EXPECTED);

    // 3. stdin: the prompt must be visible before the program waits.
    const r = await run(STDIN, { inputs: ['19', '23'] });
    check(
        'stdin: print! + flush prompt without newline, two lines read, their sum',
        r.code === 0 && r.stdout === 'first number: second number: sum: 42\n' && r.stdinRequests === 2 &&
            r.stdoutBeforeInput[0] === 'first number: ' && r.stdoutBeforeInput[1] === 'first number: second number: ',
        `${JSON.stringify(r.stdout)} requests=${r.stdinRequests} seen-before-input=${JSON.stringify(r.stdoutBeforeInput)} code=${r.code} ${r.ms} ms; ${timeline(r)}`,
    );
    if (r.code !== 0) console.log(plain(r.stderr));
    const eof = await run(EOF, { inputs: ['one', 'two'] });
    check('end of input (Ctrl-D) ends lines()', eof.code === 0 && eof.stdout === 'got one\ngot two\nend of input after 2 lines\n' && eof.stdinRequests === 3,
        `code=${eof.code} ${JSON.stringify(eof.stdout)} requests=${eof.stdinRequests}`);

    // 4. Compile errors: rustc's diagnostics on stderr, non-zero exit, nothing run.
    const broken = await run(TYPE_ERROR);
    check('type error: rustc E0308 on stderr with the location, non-zero exit, nothing run',
        broken.code !== 0 && /error\[E0308\]: mismatched types/.test(plain(broken.stderr)) && /src\/main\.rs:2:18/.test(plain(broken.stderr)) && broken.stdout === '',
        `code=${broken.code}\n${plain(broken.stderr).split('\n').slice(0, 3).join('\n')}`);
    const borrow = await run(BORROW_ERROR);
    check('borrow checker: use after move (E0382), non-zero exit',
        borrow.code !== 0 && /error\[E0382\]: borrow of moved value: `v`/.test(plain(borrow.stderr)) && borrow.stdout === '',
        `code=${borrow.code} ${plain(borrow.stderr).split('\n')[0]}`);

    // 5. Runtime: a panic exits 101 with Rust's message; process::exit's code.
    const panic = await run(PANIC);
    // WebAssembly's std is panic=abort: abort() traps, which exits 134 as
    // under wasmtime (SIGABRT's 128 + 6). On a Linux target it is 101.
    check('panic: index out of bounds is reported, and the program aborts (exit 134)',
        panic.code === 134 && panic.stdout === 'before\n' && /index out of bounds: the len is 0 but the index is 1/.test(plain(panic.stderr)),
        `code=${panic.code} ${JSON.stringify(panic.stdout)} ${plain(panic.stderr).split('\n').slice(0, 2).join(' | ')}`);
    if (panic.code !== 134) console.log(plain(panic.stderr));
    const exit = await run(EXIT);
    check('std::process::exit(3) exits 3', exit.code === 3 && exit.stdout === 'leaving\n', `code=${exit.code}`);
    const single = await run(SINGLE);
    check('a project without Cargo.toml: crate "app", edition 2021, HashMap and sorting from std',
        single.code === 0 && single.stdout === '[("a", 3), ("b", 2), ("c", 1)]\n', `code=${single.code} ${JSON.stringify(single.stdout)} ${plain(single.stderr).slice(0, 300)}`);

    // 6. Optimization: Cargo's levels; 0 is the dev profile, with debug info.
    const o3 = await run(SAMPLE, { options: { optimization: '3' } });
    check('opt-level 3: the same output, built as Cargo\'s release profile',
        o3.code === 0 && o3.stdout === EXPECTED && /`release` profile \[optimized\] target/.test(plain(o3.stderr)) && /`dev` profile \[unoptimized \+ debuginfo\] target/.test(plain(cold.stderr)),
        `code=${o3.code} in ${o3.ms} ms ${plain(o3.stderr).split('\n').filter((l) => /Finished/.test(l)).join('')}`);
    const badLevel = await run(SAMPLE, { options: { optimization: '4' } });
    check('an optimization level Cargo does not have is refused', badLevel.code === 1 && /no optimization level 4/.test(badLevel.stderr), `code=${badLevel.code}`);

    // 7. Miri: interpreted as if on the Miri target, with its checks on.
    const LAYOUT = {
        ...MANIFEST,
        'src/main.rs': `use std::mem::{align_of, size_of};

#[allow(dead_code)]
struct S(u8, u64);

fn main() {
    println!("usize {} u64 align {} S {} bytes {:?}", size_of::<usize>(), align_of::<u64>(), size_of::<S>(), 0x0102u16.to_ne_bytes());
}
`,
    };
    const layouts = {};
    for (const miri of ['x86_64', 'i686', 's390x', 'armv7']) {
        const r = await run(LAYOUT, { options: { miri } });
        layouts[miri] = r.code === 0 ? r.stdout.trim() : `exit ${r.code}: ${plain(r.stderr).split('\n').slice(0, 3).join(' | ')}`;
    }
    check('Miri: a type\'s layout is the Miri target\'s (x86-64 16 bytes, i686 12 with u64 aligned to 4, ARMv7 32-bit with u64 aligned to 8, s390x big-endian)',
        layouts.x86_64 === 'usize 8 u64 align 8 S 16 bytes [2, 1]' && layouts.i686 === 'usize 4 u64 align 4 S 12 bytes [2, 1]' &&
            layouts.armv7 === 'usize 4 u64 align 8 S 16 bytes [2, 1]' && layouts.s390x === 'usize 8 u64 align 8 S 16 bytes [1, 2]',
        JSON.stringify(layouts));
    const ub = await run({
        ...MANIFEST,
        'src/main.rs': 'fn main() {\n    let v = vec![1u8, 2, 3];\n    let p = v.as_ptr();\n    drop(v);\n    println!("before");\n    println!("{}", unsafe { *p });\n}\n',
    }, { options: { miri: 'x86_64' } });
    check('Miri: a use after free stops the program where it happens, as undefined behaviour, with the line',
        ub.code !== 0 && ub.stdout === 'before\n' && /Undefined Behavior/.test(plain(ub.stderr)) && /src\/main\.rs:6/.test(plain(ub.stderr)),
        `code=${ub.code} ${plain(ub.stderr).split('\n').filter((l) => /Undefined|main\.rs/.test(l)).slice(0, 2).join(' | ')}`);
    const CAUGHT = {
        ...MANIFEST,
        'src/main.rs': 'fn main() {\n    let r = std::panic::catch_unwind(|| -> i32 { panic!("inner") });\n    println!("caught: {}", r.is_err());\n}\n',
    };
    const miriCaught = await run(CAUGHT, { options: { miri: 'aarch64' } });
    check('Miri: a panic unwinds, and catch_unwind catches it', miriCaught.code === 0 && miriCaught.stdout === 'caught: true\n' && /inner/.test(miriCaught.stderr),
        `code=${miriCaught.code} ${JSON.stringify(miriCaught.stdout)} ${plain(miriCaught.stderr).slice(0, 200)}`);
    // Not the sample: Miri gives hypot and sqrt the small errors their
    // documentation allows, at random, so its exact assert_eq! on an f64
    // fails under Miri now and then, as it may on some target.
    const GCD = {
        'Cargo.toml': '[package]\nname = "gcd"\nversion = "0.1.0"\nedition = "2021"\n\n[dev-dependencies]\nquickcheck = "1"\n',
        'src/lib.rs': 'pub fn gcd(a: u32, b: u32) -> u32 {\n    if b == 0 { a } else { gcd(b, a % b) }\n}\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn gcd_of_12_and_18_is_6() {\n        assert_eq!(super::gcd(12, 18), 6);\n    }\n\n    #[test]\n    fn a_panic_is_caught_by_libtest() {\n        let r = std::panic::catch_unwind(|| super::gcd(1, 0) / std::hint::black_box(0));\n        assert!(r.is_err());\n    }\n}\n',
        'tests/properties.rs': 'use gcd::gcd;\nuse quickcheck::quickcheck;\n\nquickcheck! {\n    fn gcd_divides_both(a: u16, b: u16) -> bool {\n        let g = gcd(a as u32, b as u32);\n        g == 0 || (a as u32 % g == 0 && b as u32 % g == 0)\n    }\n}\n',
    };
    const miriTests = await run(GCD, { type: 'test', options: { miri: 'riscv64' } });
    const miriResults = [...miriTests.stdout.matchAll(/^test (\S+) \.\.\. (ok|FAILED)$/gm)].map((m) => `${m[1]} ${m[2]}`).sort();
    check('Miri: cargo miri test runs unit and integration tests under libtest, a quickcheck property and a caught panic included',
        miriTests.code === 0 && JSON.stringify(miriResults) === JSON.stringify(['gcd_divides_both ok', 'tests::a_panic_is_caught_by_libtest ok', 'tests::gcd_of_12_and_18_is_6 ok']),
        `code=${miriTests.code} in ${miriTests.ms} ms ${JSON.stringify(miriResults)}`);
    if (miriTests.code !== 0) console.log(plain(miriTests.stderr), miriTests.stdout);
    const noMiri = await run(SAMPLE, { options: { miri: 'wasm32' } });
    check('Miri: a Miri target that is not one is refused', noMiri.code === 1 && /no Miri target wasm32/.test(noMiri.stderr), `code=${noMiri.code}`);

    // 8. Linux targets, under the C/C++ pack's QEMU-Wasm, when it is here.
    const vm = await page.evaluate(async () => (await fetch('/packs/cpp/vm.js', { method: 'HEAD' })).ok);
    if (!vm) console.log('SKIP  Linux targets: no packs/cpp/vm.js (build the C/C++ pack, or set CPP_PACK_ORIGIN)');
    else {
        const on = (triple, files) => ({ ...files, '.cargo/config.toml': `[build]\ntarget = "${triple}"\n` });
        for (const triple of ['x86_64-unknown-linux-musl', 'aarch64-unknown-linux-musl', 'riscv64gc-unknown-linux-musl']) {
            const r = await run(on(triple, SAMPLE));
            check(`${triple}: the sample, compiled by rustc-cross.wasm, runs under QEMU`, r.code === 0 && r.stdout === EXPECTED && r.loading['rustc-cross.wasm'] !== undefined,
                `code=${r.code} in ${r.ms} ms ${JSON.stringify(r.stdout)} ${r.code === 0 ? '' : plain(r.stderr).slice(-400)}`);
        }
        const linuxTests = await run(on('aarch64-unknown-linux-musl', failingSample()), { type: 'test' });
        check('aarch64-unknown-linux-musl: Test runs libtest itself; a failing test is reported and the rest still run, exit 101',
            linuxTests.code === 101 && /test points_print_as_pairs \.\.\. FAILED/.test(linuxTests.stdout) && /test result: FAILED\. 2 passed; 1 failed/.test(linuxTests.stdout),
            `code=${linuxTests.code} in ${linuxTests.ms} ms`);
        const caught = await run(on('riscv64gc-unknown-linux-musl', CAUGHT));
        check('riscv64gc-unknown-linux-musl: a panic unwinds, and catch_unwind catches it', caught.code === 0 && caught.stdout === 'caught: true\n',
            `code=${caught.code} ${JSON.stringify(caught.stdout)}`);
    }

    // 9. The compiler output views (explorer.js), for the project's target.
    const emit = (files, emitKind, options = {}, path = 'src/lib.rs') =>
        page.evaluate(([f, e, o, p]) => new Promise((done) => {
            const worker = new Worker('/packs/rust/explorer.js', { type: 'module' });
            worker.onmessage = ({ data: m }) => {
                if (m.type !== 'result') return;
                worker.terminate();
                done(m);
            };
            worker.postMessage({ type: 'emit', id: 1, emit: e, files: f, path: p, options: o });
        }), [files, emitKind, options, path]);
    const VIEW = { ...MANIFEST, 'src/lib.rs': 'pub fn square(x: i32) -> i32 {\n    x * x\n}\n\npub fn sum(v: &[i32]) -> i32 {\n    v.iter().map(|&x| square(x)).sum()\n}\n' };
    const mir = await emit(VIEW, 'mir');
    check('MIR view: the library\'s functions, each line mapped to its source line', mir.ok && /fn square\(/.test(mir.text) && mir.lines.some((l) => l?.line === 2),
        `ok=${mir.ok} ${mir.ms} ms ${mir.ok ? '' : mir.error}`);
    const ir = await emit(VIEW, 'llvm-ir', { demangle: true });
    check('LLVM IR view on WebAssembly: demangled names, wasm32 data layout', ir.ok && /define .*demo::square/.test(ir.text) && ir.triple === 'wasm32-wasip1',
        `ok=${ir.ok} ${ir.ms} ms ${ir.ok ? ir.text.split('\n').find((l) => l.startsWith('define')) : ir.error}`);
    const asmViews = {};
    // Optimised, square is inlined into sum (and, small, not emitted alone:
    // rustc leaves it to the crates that call it), so sum multiplies.
    for (const [triple, op] of [['x86_64-unknown-linux-musl', /\b(imul|pmulld)/], ['aarch64-unknown-linux-musl', /\b(mul|mla)\b/], ['riscv64gc-unknown-linux-musl', /\bmulw?\b/]]) {
        const a = await emit({ ...VIEW, '.cargo/config.toml': `[build]\ntarget = "${triple}"\n` }, 'asm', { demangle: true, optimization: '2' });
        asmViews[triple] = a.ok && op.test(a.text) && /^demo::sum:/m.test(a.text) ? `ok ${a.ms} ms` : `${a.ok ? a.text.slice(0, 200) : a.error}`;
    }
    check('assembly view: x86-64, AArch64 and RISC-V at opt-level 2, demangled, each with its own multiply', Object.values(asmViews).every((v) => v.startsWith('ok')), JSON.stringify(asmViews));

    // 10. A program that never ends: the page terminates the worker.
    const t = Date.now();
    const forever = await run(FOREVER, { stopAfter: 'looping' });
    const alive = await page.evaluate(() => 1 + 1);
    check('endless loop: terminated by the page, which stays responsive',
        forever.terminated && forever.code === null && forever.stdout === 'looping\n' && alive === 2, `stopped after ${Date.now() - t} ms; ${timeline(forever)}`);
} finally {
    await browser.close();
    server.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);

/** The `sample` object literal of one language in languages.ts, evaluated:
 * template literals of plain text keyed by file name. */
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
