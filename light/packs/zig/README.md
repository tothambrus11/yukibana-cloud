# Zig pack: Zig 0.17.0's own compiler and ZLS, in the browser, for WebAssembly and x86-64 Linux

| part | what it is | what it does |
|---|---|---|
| `server.js` + `zls.js` + `zls.wasm` | **ZLS 0.17.0**, zigtools' own wasm32-wasi release, unchanged, in a worker of the server's | completion (the project's and the standard library's), hover with doc comments, signature help, definition, references, highlights, rename, outline, formatting (`zig fmt`), inlay hints, semantic tokens, and the errors ZLS finds (syntax, and what AstGen rejects) |
| `check.js` + `zig.wasm` | **the Zig 0.17.0 compiler**, built from its sources for wasm32-wasi without LLVM, run without emitting anything 500 ms after an edit | the compiler's own errors, which ZLS cannot give (type errors need Sema), merged into ZLS's diagnostics |
| `runner.js` + `zig.wasm` | the same compiler | **Run** (`zig build-exe`) and **Test** (`zig test`), for the target in `zig.env` |
| `lib.tar` | the standard library's sources (`lib/std`, the test runner, `lib/*.zig`) | what ZLS and the compiler read; one download, kept by the service worker |
| `rt/compiler_rt-<target>.a` | compiler_rt, prebuilt per target by `build.sh` with the native Zig | linked into every program (the runner passes `-fno-compiler-rt`) |
| `linux-worker.js` | a worker that loads the **C/C++ pack's** `vm.js` (QEMU-Wasm and Linux 6.12; `../cpp/vm/README.md`) | runs a Linux program, one worker per run |

The status bar shows `zls 0.17.0`. **Run compiles the program with the real
compiler.** Zig's compiler has backends of its own besides LLVM: a
WebAssembly code generator and linker, and an x86-64 code generator with an
ELF linker. Built without LLVM, the compiler is 13.5 MB of WebAssembly (2.4
MB brotli) and still builds both targets, as `zig build-exe -fno-llvm`
does natively. There is no interpreter and no subset: what builds here
builds with `zig build-exe`.

## Targets: zig.env

The project file `zig.env` holds `KEY=value` lines with `#` comments:

| zig.env | builds | runs |
|---|---|---|
| nothing (the default) | `-target wasm32-wasi` | in the runner's worker, with browser_wasi_shim 0.4.2 |
| `TARGET=x86_64-linux` | a static x86-64 ELF | Linux 6.12 on x86-64 under QEMU-Wasm |
| `OPTIMIZE=Debug`, `ReleaseSafe`, `ReleaseFast` or `ReleaseSmall` | `-O` that mode; Debug when unset | |

An unknown target, mode or key is a warning diagnostic on its line of
`zig.env`, and Run prints it and builds for the default. `zig build`
does not read `zig.env`: Download's README gives its settings as options
(`zig build run -Dtarget=x86_64-linux -Doptimize=ReleaseSafe`).

Linux needs the C/C++ pack's VM (`packs/cpp/vm.js` and `vm/x86_64/`). Without
it, Run says the emulator is not installed.

### Why only these two

- **aarch64-linux** with the self-hosted backend fails on Zig 0.17.0's
  standard library ("invalid constraint 'i'" in inline assembly, after 529 s
  natively): the backend is not finished.
- **riscv64-linux**'s self-hosted backend needs the V extension, which
  QEMU's default RISC-V CPU, and QEMU-Wasm's, does not have.
- **Anything else** needs LLVM, which is not built for WebAssembly here.

Both arrive with no change to the pack beyond `TARGETS` (`build.sh`,
`src/zig.js`) once Zig's backends can build the standard library.

## Running and testing (runner.js)

1. **Load** `zig.wasm` and `lib.tar` (started when the worker starts), and
   the target's compiler_rt.
2. **Build**: `zig build-exe <entry>` or `zig test <entry> --test-no-exec`,
   with `-target`, `-O`, `-fno-compiler-rt` and the prebuilt compiler_rt,
   in a working directory that holds the project and, under `.zig/`, the
   library, the caches and the output. The compiler resolves paths against
   its working directory (a WASI preopen named `.`), so its messages name
   project files as `main.zig:3:19`, as `zig build-exe main.zig` prints
   them, and the library as `std/start.zig`.
3. **Run** the program: in the worker for wasm32-wasi (stdin through the
   contract's shared buffer, `std.Thread.sleep` works, `std.process.exit`
   exits, a panic prints Zig's message and exits 134), or in a child worker
   under QEMU-Wasm for Linux, where a panic also prints its stack trace with
   source lines. Test runs the test binary, whose runner prints `All N tests
   passed.` or names the failures.

The runner is reusable: the compiler, the library and the compiler's cache
stay, so a second run only compiles what changed. Measured in headless
Chromium on this machine (`test-run.mjs`):

| | wasm32-wasi | x86_64-linux |
|---|---|---|
| the sample, first run (downloads included, 4.7 MB) | 3.2 s | |
| the sample, next run | 0.4 to 0.7 s | |
| the first Linux build in a worker (the library's x86-64 code, then the run) | | 15 to 19 s, 10 to 13 s of it compiling |

Linux runs are boot plus run: the VM starts a kernel each time (about 3 s
under emulation before the program's first instruction).

### Two things the browser's WASI does not do as a terminal does

Zig's `std.Io.File.Reader` and `Writer` try positional reads and writes
first and stream only when the file answers ESPIPE. browser_wasi_shim's
console answers ENOTSUP, which Zig takes as a failure (`error.WriteFailed`
from the first `print`). `program.js` gives stdin, stdout and stderr the
answers a terminal gives.

And browser_wasi_shim reads an fd once per iovec until one comes back
short. Zig reads with two (the rest of what it wants, then its buffer), so
a blocking stdin waited a second time for a line it had already received.
`readvBlocksOnce` lets each `fd_read` call block once, as a pipe's `readv`
does. ZLS needed both fixes too: without them it read `initialize` and
never answered.

## The language server (server.js)

ZLS is a WASI command that reads LSP from stdin until told to exit, so it
runs in a worker of its own (`zls.js`), where blocking is allowed: its stdin
is a ring buffer in a SharedArrayBuffer that `server.js` writes and the
worker waits on with `Atomics.wait`. Messages pass through unchanged, except
that:

- `initialize` gets the options that point ZLS at the standard library
  (`zig_lib_path` `/lib`, `global_cache_path` `/cache`, build-on-save off)
  and the `publishDiagnostics` capability, without which ZLS sends none.
  ZLS takes those two paths only as WASI preopens of those names, and opens
  a file through the first preopen whose name is a prefix of its path, so
  `/lib` and `/cache` come before `/`.
- Documents other than `.zig` and `.zon` (zig.env) are not sent to ZLS,
  which would parse them as Zig.
- ZLS's diagnostics are merged with the compiler's for the same file. The
  compiler's are dropped from a file where ZLS reports a syntax error (the
  compiler stops at the same error). An error inside the standard library
  is shown where the project leads to it: at the first place of its
  reference trace that is a project file, with the library's place in the
  message.
- A ZLS that stops is started again, with `initialize` and every open
  document replayed; its unanswered requests get an error.

The compiler checks `zig build-exe <entry> -fno-emit-bin` and `zig test
<entry> -fno-emit-bin`, for zig.env's target, in a worker of its own. The
sample's first diagnostics arrive about 4.5 s after `initialize` (most of
it downloading and compiling the two modules); a check after an edit takes
0.5 to 0.7 s, and completion 20 to 150 ms (`test.mjs`).

## Limits

- **No build.zig**: Run builds `main.zig`, and the files it imports are
  the program, as with `zig build-exe main.zig`. Download adds a
  `build.zig` that builds the same project natively.
- **No packages**: no `build.zig.zon` dependencies (no network); the
  standard library only.
- **Two targets** (above), and no C: the pack has no C compiler, so no
  `@cImport` and no C sources.
- **Programs are single-machine and offline**: on wasm32-wasi, no network,
  no threads, and the file system is an empty `/tmp`; on Linux, the VM's.
- **No stack traces on wasm32-wasi**: "debug info unavailable for target",
  as natively. The Linux target has them.
- **A program that never ends** on wasm32-wasi holds the runner's thread;
  Stop terminates the worker, and the next run starts it again (3 s). On
  Linux, Stop ends the VM and the runner stays.

## Building and testing

`./build.sh` downloads Zig 0.17.0's sources, its x86-64 Linux release and
ZLS's wasm32-wasi release (each checked by SHA-256), builds `zig.wasm` with
the native Zig (about 6 minutes, cached in `$PACK_CACHE`), builds
compiler_rt for each target, archives the standard library, bundles the
workers with esbuild, and writes brotli and gzip siblings. `npm test` runs
the browser tests: `test.mjs` (the server) and `test-run.mjs` (the runner;
the Linux cases need the C/C++ pack's VM in `app/static/packs/cpp`, or
`ALLOW_SKIP=1`).

| file | brotli |
|---|---|
| `zls.wasm` | 2.54 MB |
| `zig.wasm` | 2.39 MB |
| `lib.tar` | 2.25 MB |
| compiler_rt, per target | 0.08 to 0.09 MB |
| the workers | 0.03 MB |

## Licences

Zig and its standard library are MIT (`LICENSE-zig.txt`); ZLS is MIT
(`LICENSE-zls.txt`); browser_wasi_shim is MIT
(`LICENSE-browser_wasi_shim.txt`).
