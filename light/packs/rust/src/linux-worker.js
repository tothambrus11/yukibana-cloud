// A worker of the Rust runner's own, for one program on a Linux target: it
// imports the C++ pack's emulator (packs/cpp/vm.js, QEMU-Wasm; its
// vm/README.md) and runs the program with runLinux, posting the runner's
// messages back unchanged and then { type: 'done', code }. runLinux runs
// once per worker and leaves QEMU running when it returns, so the runner
// starts a worker per program and terminates it after, and keeps its
// compiler and standard library for the next run.

self.onmessage = async ({ data }) => {
    const post = (msg) => self.postMessage(msg);
    let runLinux;
    try {
        ({ runLinux } = await import(new URL('vm.js', data.base).href));
    } catch {
        post({ type: 'stderr', text: `Running on ${data.label} needs the C/C++ pack's emulator (packs/cpp/vm.js), which is not installed.\n` });
        post({ type: 'done', code: 1 });
        return;
    }
    const code = await runLinux({
        arch: data.arch,
        program: data.program,
        args: data.args,
        env: data.env,
        stdin: data.stdin,
        options: data.options,
        post,
        base: data.base,
        // The runner's performance.now() of the run's start, on this
        // worker's clock, so that vm.js's marks count from it.
        t0: data.t0 + data.timeOrigin - performance.timeOrigin,
    });
    post({ type: 'done', code });
};
