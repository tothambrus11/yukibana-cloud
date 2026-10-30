// libtest's report of one test binary run under harness.rs (its control
// lines on stdout), shared by the compiled runner (runner.js) and Miri's
// (miri-runner.js): the binary is started again after each test that
// panicked, since a panic ends it (see harness.rs).

/** Calls `onLine` with each complete line (newline included) of a stream,
 * and with what is left at `end()`. */
export function lines(onLine) {
    let buffer = '';
    return {
        text(text) {
            buffer += text;
            for (let at; (at = buffer.indexOf('\n')) >= 0; ) {
                const line = buffer.slice(0, at + 1);
                buffer = buffer.slice(at + 1);
                onLine(line);
            }
        },
        end() {
            if (buffer) onLine(buffer);
            buffer = '';
        },
    };
}

/**
 * Runs one test target to the end, restarting it after each test that
 * panicked, and prints libtest's report of it on stdout. `start(env,
 * stdout)` runs one instance. Returns 0 when every test passed, 101 when
 * one failed, and the instance's code when it did not get to the tests
 * (a compile error).
 */
export async function runTests(start, post) {
    const t0 = performance.now();
    const say = (text) => post({ type: 'stdout', text });
    const unescape = (s) => s.replace(/\\(\\|n|x1e|x1f)/g, (_, c) => ({ '\\': '\\', n: '\n', x1e: '\u001e', x1f: '\u001f' })[c]);
    const done = [];
    const failures = []; // [name, text of its stdout section]
    let passed = 0;
    let ignored = 0;
    let count = null;
    for (;;) {
        let current = null; // [name, expected panic message or undefined]
        let ended = false;
        const finish = (name, ok, section) => {
            done.push(name);
            say(ok ? '\u001b[32mok\u001b[0m\n' : '\u001b[31mFAILED\u001b[0m\n');
            if (ok) passed++;
            else failures.push([name, section]);
            current = null;
        };
        const out = lines((line) => {
            if (!line.startsWith('\u001e')) return say(line);
            const body = line.slice(1).replace(/\n$/, '');
            const space = body.indexOf(' ');
            const kind = body.slice(0, space);
            const fields = body.slice(space + 1).split('\u001f').map(unescape);
            if (kind === 'count') {
                if (count === null) {
                    count = Number(fields[0]);
                    say(`\nrunning ${count} test${count === 1 ? '' : 's'}\n`);
                }
            } else if (kind === 'ignored') {
                done.push(fields[0]);
                ignored++;
                say(`test ${fields[0]} ... \u001b[33mignored${fields[1] ? `, ${fields[1]}` : ''}\u001b[0m\n`);
            } else if (kind === 'start') {
                current = [fields[0], fields.length > 1 ? fields[1] : undefined];
                say(`test ${fields[0]} ... `);
            } else if (kind === 'ok') finish(fields[0], true);
            else if (kind === 'fail') finish(fields[0], false, `${fields[1]}${fields[2]}\n`);
            else if (kind === 'panic') {
                const [name, output, location, message] = fields;
                const report = `${output}thread '${name}' panicked at ${location}:\n${message}\n`;
                const expected = current?.[1];
                if (!current) return;
                if (expected === undefined)
                    finish(name, false, `${report}note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace\n`);
                else if (message.includes(expected)) finish(name, true);
                else
                    finish(name, false,
                        `${report}note: panic did not contain expected string\n      panic message: \`${JSON.stringify(message)}\`,\n expected substring: \`${JSON.stringify(expected)}\`\n`);
            } else if (kind === 'end') ended = true;
        });
        const { code, trapped: panicked } = await start({ YUKIBANA_DONE: done.join('\n'), RUST_TEST_THREADS: '1' }, out.text);
        out.end();
        if (ended) break;
        if (count === null) return code === 0 ? 1 : code; // never reached the tests
        if (!panicked) {
            // Died some other way (Miri said why, on stderr): the running
            // test failed, and the rest still run.
            if (current) finish(current[0], false, '');
            else break;
        }
    }
    const seconds = ((performance.now() - t0) / 1000).toFixed(2);
    if (failures.length) {
        say('\nfailures:\n\n');
        for (const [name, section] of failures) if (section) say(`---- ${name} stdout ----\n${section}\n`);
        say(`failures:\n${failures.map(([name]) => `    ${name}\n`).join('')}`);
    }
    const result = failures.length ? '\u001b[31mFAILED\u001b[0m' : '\u001b[32mok\u001b[0m';
    say(`\ntest result: ${result}. ${passed} passed; ${failures.length} failed; ${ignored} ignored; 0 measured; 0 filtered out; finished in ${seconds}s\n\n`);
    return failures.length ? 101 : 0;
}

