# Go pack: Go 1.27.3's own compiler and linker, in the browser, for WebAssembly and three Linux architectures

| part | what it is | what it does |
|---|---|---|
| `server.js` + `gotool.wasm` | **our language server** (`tool/internal/lsp`) on Go 1.27.3's `go/parser`, `go/types`, `go/doc` and `go/format`, with our build planner (`tool/internal/plan`), compiled to wasip1/wasm as a reactor | diagnostics (the type checker's, so the compiler's own messages), completion, hover with doc comments, signature help, definition, type definition, references, highlights, rename, outline, formatting (gofmt) |
| `runner.js` + `compile.wasm` + `link.wasm` | **`cmd/compile` and `cmd/link` of Go 1.27.3**, unchanged, built with `GOOS=wasip1 GOARCH=wasm` | **Run** and **Test** (`go test`'s output, examples included), for the target in `go.env` |
| `std/<goos>-<goarch>/<path>.a` + `std/index.json` | the standard library's archives (export data and object code, as `go build` caches them), for wasip1/wasm, linux/amd64, linux/arm64 and linux/riscv64 | what the server type-checks imports against and what the linker links; each downloaded the first time something needs it |
| `linux-worker.js` | a worker that loads the **C/C++ pack's** `vm.js` (QEMU-Wasm and Linux 6.12; `../cpp/vm/README.md`) | runs a Linux program, one worker per run |

The status bar shows `go/types (Yukibana) go1.27.3`. This is **not gopls**:
gopls runs the go command, which runs the compiler as a subprocess and reads
a file system and a module cache, none of which a browser has. The server
uses `go/types`, the type checker gopls and `go vet` use, which reports the
same errors as the compiler (the compiler's type checker is a copy of it).

**Run compiles the program with the real compiler.** `compile.wasm` and
`link.wasm` are Go's own toolchain, cross-compiled to WebAssembly, which Go
supports out of the box. The compiler produces code for any target from any
host, so the same two files build a WebAssembly program, which runs in the
browser, or a static Linux executable, which runs under QEMU-Wasm. There is
no interpreter and no subset: what builds here builds with `go build`.

## Targets: go.env

The project file `go.env` holds the target, as `KEY=value` lines with `#`
comments, the way `GOOS` and `GOARCH` are set in an environment:

| go.env | builds | runs |
|---|---|---|
| nothing (the default) | `GOOS=wasip1 GOARCH=wasm` | in the runner's worker, with browser_wasi_shim 0.4.2 |
| `GOOS=linux` `GOARCH=amd64` | a static x86-64 ELF | Linux 6.12 on x86-64 under QEMU-Wasm |
| `GOOS=linux` `GOARCH=arm64` | a static AArch64 ELF | Linux 6.12 on AArch64 (Cortex-A72) under QEMU-Wasm |
| `GOOS=linux` `GOARCH=riscv64` | a static RISC-V ELF | Linux 6.12 on RISC-V (rv64gc, OpenSBI) under QEMU-Wasm |

An unknown or incomplete target is a diagnostic in `go.env` and a warning
on Run, which then builds for the default. The server type-checks for the
target too: build constraints (`//go:build linux`, `_linux.go`) are
evaluated for it, and a file left out says so instead of being checked.

The go command does not read `go.env`; Download's README says to set the
variables in the environment (`GOOS=linux GOARCH=arm64 go build .`).

Linux needs the C/C++ pack's VM (`packs/cpp/vm.js` and `vm/<arch>/`, 2.6 to
2.9 MB brotli). Without it, Run says the emulator is not installed.

## Running and testing (runner.js)

1. **Plan** (`gotool.wasm`, `yk_plan`): the project's packages as the go
   command would load them (`go/build` over the files in memory, with the
   target's build constraints), in dependency order, and the standard
   library packages they import. What `go run` or `go test` refuses is
   refused with its message: import cycles, a missing package, `package
   main` imported, cgo, assembly, `//go:embed`, several packages in one
   directory. For Test, each package with tests is built as `go test` builds
   it: the package with its `_test.go` files, the external `_test` package,
   and a generated `_testmain.go` (`cmd/go`'s template, without coverage).
2. **Download** the standard library archives the plan needs, and what they
   import, for the target (`std/index.json` has the graph). The first run of
   the sample downloads 3.7 MB (wasip1) to 4.4 MB (linux/amd64); a test run,
   which imports `testing`, 7.7 to 8.8 MB. All of a target is 9.3 to 10.5 MB.
3. **Compile** each package, `go build`'s way:
   `compile -p <path> -lang=go1.27 -complete -importcfg … -pack -trimpath …`,
   then **link** `link -importcfg … -buildmode=exe -s -w`. Errors name the
   project's paths (`main.go:6:14: …`), as `go build` prints them.
4. **Run** the program: in the worker for wasip1 (stdin through the
   contract's shared buffer, `time.Sleep` and goroutines work, `os.Exit`
   exits), or in a child worker under QEMU-Wasm for Linux. Test runs each
   test binary with `-test.v=true -test.paniconexit0` and prints `ok`,
   `FAIL` or `[no test files]` per package, as `go test ./...` does.

The runner is reusable: the compiler, the linker and the archives stay
loaded, so a second run only compiles. Measured in headless Chromium on
this machine (`test-run.mjs`):

| | wasip1 | linux/amd64 | linux/arm64 |
|---|---|---|---|
| the sample, first run (downloads included) | 2.5 to 4.2 s | | |
| the sample, next run | 0.6 to 0.9 s | 4.8 to 7 s | 7 to 9 s |
| of which compile and link | 0.5 to 0.8 s | the same | the same |

Linux runs are boot plus run: the VM starts a kernel each time (about 3 s
under emulation before the program's first instruction).

## The standard library

Each target ships the packages `build.sh` lists in `STD_PACKAGES` and what
they import (about 160 archives): `fmt`, `strings`, `strconv`, `sort`,
`slices`, `maps`, `math/...`, `container/...`, `encoding/...` (JSON, CSV,
XML, binary, base64), `regexp`, `text/template`, `time`, `sync`, `context`,
`os`, `bufio`, `flag`, `compress/...`, the hashes and `crypto/rand`,
`testing` and `testing/quick` (property tests), and the rest that a program
without a network uses. Left out, to keep each target at about 10 MB:
networking (`net/...`, there is no network in the browser or the VM),
`os/exec` (there is no other program), crypto beyond hashes, and the
toolchain's own packages (`go/...`, `debug/...`). Importing one of those is
a diagnostic that says the browser's copy of the standard library leaves it
out, rather than "package not found".

Only the project's own module and the standard library can be imported:
there is no module proxy, so `require` lines in `go.mod` are not fetched.

## The language server (server.js)

`gotool.wasm` is a library: `server.js` hands it each JSON-RPC message
(`yk_message`) and, 200 ms after the client goes quiet, asks for diagnostics
(`yk_idle`). Either may answer that it needs standard library packages for
the current target; `server.js` downloads them (the same URLs the runner
fetches, so the service worker caches them once) and asks again, so a
project never shows "could not import fmt" while fmt is on its way.

Each check builds a snapshot of the project: every directory is a package
(with its `_test.go` files, and its external `_test` package), checked in
dependency order with `go/types`, importing the standard library from the
archives' export data. The standard library's packages are imported once
per target and shared by every snapshot. The sample's first diagnostics
arrive about 1.3 s after `initialize` (most of it downloading `gotool.wasm`,
2.5 MB); after an edit, a check takes tens of milliseconds, and completion
about 30 ms (`test.mjs`).

Rename refuses what it cannot rename everywhere: a name from the standard
library, a package name, a predeclared identifier, or a name that is not a
valid identifier.

## Limits

- **Not gopls**: no code actions (quick fixes, "add import"), no inlay
  hints, no call hierarchy, no workspace symbol search, no `go vet`
  analyzers, and completion does not add imports.
- **No cgo, assembly or `//go:embed`**: the compiler builds Go only, and
  there is no C compiler or assembler driver here. Each is refused by name.
- **No modules beyond the project's**: no module proxy and no network.
- **Programs are single-machine and offline**: on wasip1, no network, no
  subprocesses, and the file system is an empty `/tmp`; on Linux, the VM's.
- **A program that never ends** on wasip1 holds the runner's thread; Stop
  terminates the worker, and the next run starts it again (3 s). On Linux,
  Stop ends the VM and the runner stays.
- **Go 1.27.3 only**: `go.mod`'s `go` line may name it or an older release;
  a newer one is an error, as with the go command.

## The RISC-V target and a QEMU-Wasm bug

qemu-wasm's Wasm TCG backend emitted `ctpop` with the wrong operands (the
op's arguments 1 and 2 instead of 0 and 1), so a RISC-V `cpop` (Zbb) wrote
its count into the source register and read a register that was not there.
Go's runtime uses `cpop` once `riscv_hwprobe` says the CPU has Zbb, which
QEMU's default RISC-V CPU does: every Go program crashed the emulator with
"memory access out of bounds". A C program built with `-march=rv64gc_zbb`
showed the same bug as wrong answers (one bit counted in
`0x00f0123400000100`). The fix is in `../cpp/vm/patches/qemu-wasm-tcg.patch`;
the VM must be built from it for Go on riscv64.

## Building and testing

`./build.sh` downloads Go 1.27.3 (checked by SHA-256), runs the tool's
tests (`go vet`, `go test`: the planner's plans are also built and run with
the native compiler and linker, and the server is tested against each
target's standard library), builds `compile.wasm`, `link.wasm` and
`gotool.wasm`, lists and copies the standard library's archives for each
target, bundles the workers with esbuild, and writes brotli and gzip
siblings. `npm test` runs the browser tests: `test.mjs` (the server) and
`test-run.mjs` (the runner, every target; the Linux ones need the C/C++
pack's VM in `app/static/packs/cpp`, or `ALLOW_SKIP=1`).

| file | brotli |
|---|---|
| `gotool.wasm` | 2.46 MB |
| `compile.wasm` | 6.80 MB |
| `link.wasm` | 2.29 MB |
| `std/index.json` | 0.01 MB |
| the standard library, per target | 9.3 to 10.5 MB, downloaded as needed |

## Licences

Go's compiler, linker, standard library and the packages the tool uses are
Go's (BSD-3-Clause, `LICENSE-go.txt`); browser_wasi_shim is MIT
(`LICENSE-browser_wasi_shim.txt`). `tool/internal/plan/test.go` adapts
`cmd/go`'s test main template and test function checks, under the same
licence.
