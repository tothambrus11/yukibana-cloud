// A worker of a runner's own, for one program on a Linux target: it imports
// the Linux pack's emulator (packs/linux/vm.js, QEMU-Wasm; ../linux/README.md)
// from data.base and runs the program with runLinux, posting the runner's
// messages back unchanged and then { type: 'done', code }. runLinux runs
// once per worker and leaves QEMU running when it returns, so a runner
// starts a worker per program and terminates it after, and keeps its
// compiler and libraries for the next run. Shared by the Go, Rust, Swift and
// Zig runners (README.md), each of which bundles it as its own
// linux-worker.js.
//
// data: { arch, label, program, args, env, stdin, options, base, t0,
// timeOrigin }, with base the URL of the Linux pack's directory and t0 the
// runner's performance.now() at the run's start, on the runner's clock
// (timeOrigin), which this worker moves to its own clock so that vm.js's
// marks count from it.

self.onmessage = async ({ data }) => {
    const post = (msg) => self.postMessage(msg);
    let runLinux;
    try {
        ({ runLinux } = await import(new URL('vm.js', data.base).href));
    } catch {
        post({ type: 'stderr', text: `Running on ${data.label} needs the Linux pack's emulator (packs/linux/vm.js), which is not installed.\n` });
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
        t0: data.t0 + data.timeOrigin - performance.timeOrigin,
    });
    post({ type: 'done', code });
};
