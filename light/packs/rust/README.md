# Rust pack: rust-analyzer's IDE crates for the editor, rustc 1.98.1 with LLVM for Run and Test, Miri for undefined behaviour

| part | what it is | what it does |
|---|---|---|
| `server.js` + `rust-analyzer.wasm` | **rust-analyzer's IDE crates** (`ra_ap_ide` and friends, **0.0.358**, from crates.io) with a small LSP layer written for this pack (`server/src/lib.rs`), compiled to wasm32-wasip1 with Rust 1.98.0 | diagnostics, completion (with auto-import), hover, signature help, definition, type definition, implementations, references, highlights, outline, rename, quick fixes and assists, semantic tokens, inlay hints |
| `std-src.tar` | `core`, `alloc` and `std` sources from **rust-src 1.98.0** | what rust-analyzer reads for the standard library: types, completion, docs |
| `runner.js` + `rustc.wasm` + `sysroot-wasm32-wasip1.tar` | **rustc 1.98.1** with **LLVM 22**'s WebAssembly code generator and lld inside, compiled for a wasm32-wasip1-threads host (`rustc/build.sh`), and Rust's own rust-std for wasm32-wasip1 | **Run** and **Test** of the default target, WebAssembly (WASI): a real compile, with full debug info at opt-level 0, and the program run in the browser |
| `rustc-cross.wasm` + `sysroot-<triple>.tar` | the same rustc with the x86-64, AArch64 and RISC-V code generators and lld's ELF linker too, and rust-std for `x86_64`, `aarch64` and `riscv64gc-unknown-linux-musl` | Run and Test of a **Linux target**: a static ELF, run under the C/C++ pack's QEMU-Wasm |
| `miri.wasm` + `miri-sysroot-<triple>.tar` | **Miri** of the same tree, and std built for Miri on six targets | Run and Test **under Miri** (Build settings), which stops at undefined behaviour, as if on the Miri target chosen: x86-64, AArch64, RISC-V 64, i686, ARMv7, s390x |
| `explorer.js` | the same rustc, compiling only | the **MIR**, **LLVM IR** and **assembly** views, each line mapped to its source line |
| `quickcheck-1.0.3-<triple>.tar`, `quickcheck-1.0.3-miri-<triple>.tar`, `quickcheck-1.0.3-src.tar` | **[quickcheck](https://github.com/BurntSushi/quickcheck) 1.0.3** and its dependencies (rand, rand_core, getrandom, libc, cfg-if) from crates.io, compiled for each target and for Miri's, and their sources | **property-based tests**, for a project whose `Cargo.toml` names `quickcheck` (see "Property-based tests"); downloaded only then |

The status bar shows `rust-analyzer (ra_ap_ide, Yukibana) 0.0.358`. This is
**not the `rust-analyzer` binary**: that program needs threads, a file
watcher, and `cargo metadata` to find out what the project is. The pack uses
the same analysis crates the binary is built on, on one thread, and builds
the crate graph itself from the files in the editor (see "The crate graph").

**Run compiles the program**, in the browser, with rustc and LLVM, as
`cargo build` does, and runs what it made. The default is WebAssembly
(WASI) with `rustc.wasm`, the smaller compiler, which needs no emulator.
A project picks a Linux target as Cargo does, with `[build] target` in
`.cargo/config.toml` (the app's target picker writes it); that downloads
`rustc-cross.wasm` and runs the program under QEMU. Miri is a choice of its
own (Build settings, "Miri"): not a target, a way of running the program
that checks it for undefined behaviour.

## The language server (server.js)

`rust-analyzer.wasm` is a library, not a program: `server.js` hands it each
JSON-RPC message (`yk_message`) and, after 250 ms with no message,
asks it to compute diagnostics (`yk_idle`). Both return the messages to
send. Diagnostics are published for every open `.rs` file whenever its list
changes, including the first, empty list.

At start it downloads `rust-analyzer.wasm` and `std-src.tar` (with
`yukibana/loading` progress), hands the standard library's 1,500-odd files
to the module, and only then answers. From the first message to the first
diagnostics of the sample takes about 3.5 s in Chromium on this machine
(salsa computing std's item tree); after that, completion takes 50 to 300
ms and diagnostics after an edit a few hundred ms.

A panic in rust-analyzer aborts the wasm instance (it is built with
`panic = "abort"`; wasm has no unwinding here). `server.js` then starts a
new instance, replays `initialize` and the open documents, and answers the
request that failed with an error, so one bad request does not end the
session. The log says so.

### The crate graph

Built from the open files after every change that adds, removes or renames
a file, or changes `Cargo.toml`, the way Cargo would:

- `src/lib.rs`, if present, is a library crate named after `[package] name`
  in `Cargo.toml` (dashes become underscores; `app` when there is no
  `Cargo.toml`).
- `src/main.rs` (or a root `main.rs`, in the flat layout), each
  `src/bin/*.rs` and each `tests/*.rs` is a crate that depends on that
  library.
- Every crate depends on `core`, `alloc` and `std` from `std-src.tar`, has
  edition 2021 (or the one `Cargo.toml` names), and has the cfgs `test` and
  `debug_assertions` set, so `#[cfg(test)]` modules are analysed.
- The target is x86_64-unknown-linux-gnu (cfgs and data layout, so hover
  shows real sizes), whatever the project's target: hover's sizes are
  x86-64's. Run under Miri on another target shows that target's.

- If `Cargo.toml` names `quickcheck` under `[dependencies]` or
  `[dev-dependencies]`, `server.js` downloads `quickcheck-1.0.3-src.tar`
  and restarts the server with it: quickcheck, rand, rand_core, getrandom,
  libc and cfg-if become library crates with the features, build-script
  cfgs and dependencies Cargo resolved for them (`crates.json`, written by
  `scripts/build-crates.mjs`), and every crate of the project depends on
  quickcheck (dev-dependencies too: the library is analysed with
  `cfg(test)`). Diagnostics wait for the download rather than flash an
  unresolved `use`.

Not read from `Cargo.toml`: other `[dependencies]` (there is no crates.io
here, see "What does not work"), features, `[[bin]]` paths, build scripts.

### Why std 1.98.0 for analysis and 1.98.1 for running

rust-analyzer 0.0.358 needs rustc 1.98 to build, and lowers `format_args!`
only the way std 1.93 and later define it, so it reads std 1.98.0's
sources. The compilers are 1.98.1, a point release whose std has the same
API. They used to be far apart (Miri 1.78, which made a function newer
than 1.78 complete in the editor and fail on Run); they no longer are.

### Diagnostics

rust-analyzer's own diagnostics only. **There is no `cargo check`**: in an
editor, the borrow checker's errors (`E0382` use after move, `E0499`,
`E0502`), trait-solving errors and lints come from rustc through
`cargo check`, and here they appear only when you press Run. rust-analyzer
reports syntax errors, type mismatches (`E0308`), wrong argument counts,
missing match arms, missing fields, unresolved imports and modules, missing
`unsafe`, mutability errors and more.

rust-analyzer's "experimental" diagnostics are **on**, unlike its defaults:
they include unresolved names (`E0425`) and methods (`E0599`), which
`cargo check` would otherwise report, and without them a typo would be
silent until Run. One of them, "type annotations needed" (`E0282`), is off:
it fired on correct code in testing (`HashMap::new()` with an annotated
`let`, in a body that also reads stdin). An experimental diagnostic can be
wrong where rust-analyzer's type inference gives up; rustc on Run has the
last word.

### What does not work in the editor

- **No formatting.** rustfmt is a separate program and is not in the pack.
- **No crates.io dependencies but quickcheck.** A `use serde::...` is
  unresolved in the editor and on Run.
- **No procedural macros**, so `#[derive(Serialize)]`-style macros from
  crates would expand to nothing (there are no such crates anyway). The
  standard library's built-in derives (`Debug`, `Clone`, `PartialEq`, ...)
  and `macro_rules!` macros work.
- `std::arch` and `core::simd` (`std_detect`, `stdarch`, `portable-simd`
  live outside `library/{core,alloc,std}`) are not in `std-src.tar`, so
  their items are unresolved in the editor.
- No `rust-analyzer` commands (Run lenses, expand macro, view HIR, ...), no
  workspace symbol search, no call hierarchy, no folding ranges from the
  server (Monaco folds by indentation).

## The compiler (rustc/)

`rustc/build.sh` builds rustc 1.98.1 from Rust's source tarball for a
**wasm32-wasip1-threads host**, with wasi-sdk 34's clang, in one bootstrap
tree:

1. **LLVM 22.1.8** (Rust's own fork, in the tarball) twice: natively, for
   the stage-1 compiler that builds the rest, and for the wasm host, with
   the WebAssembly, X86, AArch64 and RISCV targets, and lld.
2. **rustc-cross.wasm**: stage 2, `compiler/rustc`, every one of those
   targets.
3. **rustc.wasm** and **miri.wasm**: rustc linked again against the same
   LLVM with `RUSTC_LLVM_ONLY_TARGETS=webassembly`, so only WebAssembly's
   code generator is in it (a third smaller), and Miri, of the same tree.

The patches (`rustc/patches`, their README) are mostly homescoop's work
on rustc for WASI hosts (threads, no `dlopen`, the LLVM wrapper, lld
in-process), three LLVM fixes backported (one makes debug info for
WebAssembly survive LLVM's wasm host), and two of ours: the version string
and a bootstrap fix that gives Miri a `rustc_driver` to link on a host
without shared libraries. `[build] description = ""` makes the version
string exactly that of the official release, `rustc 1.98.1 (48a229cea
2026-09-01)`, and that is the point of the release: crates load only into
a compiler of the same version string, so **Rust's own rust-std for each
target loads into these compilers unchanged**, and stable 1.98.1's Cargo
builds the crates (below).

It is far past a pack's CI job (90 minutes): about 4 hours on 4 cores,
some 40 GB of build tree. `.github/workflows/light-rust-toolchain.yml`
runs it by hand and publishes the three files as a release; the pack's
`build.sh` fetches them from that release, pinned by sha256
(`RUSTC_RELEASE`, `RUSTC_SHA256`), or takes them from `RUSTC_OUT`, or
builds them (`RUSTC_BUILD=1`).

Each compiler is a wasm32-wasip1-threads program: `threads.js` gives it
`wasi-threads` (each thread a worker, `thread.js`, on one shared memory)
and a WASI file system (`@bjorn3/browser_wasi_shim` 0.4.2) with
`/sysroot`, `/project`, `/deps`, `/out` and `/tmp`. rustc runs with
`RUSTC_SYSROOT=/sysroot` (it cannot find its sysroot from its own path
here) and `RUSTC_BOOTSTRAP=1`.

## The runner (runner.js)

The contract's runner (`../CONTRACT.md`, "Running a program").

1. **Load**: download the compiler the target needs and that target's
   sysroot (`loading` messages) and compile the module once.
2. **Library**: if there is a `src/lib.rs`, it is compiled to an rlib under
   the package's name.
3. **Build**: `src/main.rs` (or `main.rs`) with that library as
   `--extern`, at the Build settings' optimisation level, to
   `/out/<package>.wasm` or a static ELF. Compile errors are rustc's, with
   paths as the project names them, and exit 1. Cargo's status lines
   (`Compiling`, `Finished`, `Running`) go to stderr, as with `cargo run`.
4. **Run**: a WebAssembly program runs in the runner's worker, on WASI
   (stdout and stderr streamed, stdin by the contract: stdout is flushed,
   the worker blocks on the SharedArrayBuffer; Ctrl-D is end of file). A
   Linux program runs in `linux-worker.js` on the C/C++ pack's QEMU-Wasm,
   with the C++ pack's Run options (user or system emulation, CPUs,
   strace). A panic prints Rust's own `thread 'main' panicked at ...`;
   `process::exit(n)` exits n; Stop ends the worker (an endless loop is
   fine).

**Targets** (`src/targets.json`, `app/src/lib/rust-targets.ts`):

| target | triple | compiler | runs on |
|---|---|---|---|
| WebAssembly (WASI), the default | `wasm32-wasip1` | `rustc.wasm` | the browser |
| x86-64 Linux | `x86_64-unknown-linux-musl` | `rustc-cross.wasm` | QEMU-Wasm |
| AArch64 Linux | `aarch64-unknown-linux-musl` | `rustc-cross.wasm` | QEMU-Wasm |
| RISC-V 64 Linux | `riscv64gc-unknown-linux-musl` | `rustc-cross.wasm` | QEMU-Wasm |

Linux programs are linked as Rust links a musl program natively, by
rust-lld with rust-std's own crt1.o, libc.a and libunwind.a
(`-C linker-flavor=gnu-lld -C link-self-contained=yes -C
target-feature=+crt-static`), so they are static and need nothing from
the VM's file system.

**Optimization** is Cargo's `opt-level` (0, 1, 2, 3, s, z), the app's
Optimization select. At 0, Cargo's dev profile, the program is compiled
with full debug info (`-C debuginfo=2`), debug assertions and overflow
checks, for the debugger; above it, without any of them, as Cargo's release
profile.

### Tests

**Test** builds the library, then runs, as `cargo test` does: the unit
tests of the library, the unit tests of the binary, then each
`tests/*.rs`, and prints libtest's report (`running 3 tests`,
`test distance_is_symmetric ... ok`, `test result: ok. 3 passed; 0 failed;
...`), with failures' output and panic messages. The exit code is 101 if any
test failed.

- **On Linux targets** that is libtest itself, `--test-threads=1`: a panic
  unwinds, the test fails, and the next one runs.
- **On WebAssembly** the standard library is built with `panic=abort`
  (wasm32-wasip1 has no unwinding), and libtest catches each test's panic
  by unwinding. So `src/harness.rs` is compiled to a small crate and
  injected as the test runner (`#![feature(custom_test_frameworks)]`,
  `#![test_runner(...)]`, through `-Zcrate-attr`). It runs the tests one
  at a time in name order, captures their output, and reports each on
  control lines the runner reads; when a test panics, the program aborts,
  and the runner starts it again, skipping the tests already done.
  `#[ignore]` and `#[should_panic]` (with `expected`) work; a `#[test]`
  returning `Result` fails on `Err`.

Benchmarks, doc tests, test filters and `--nocapture` are not supported.

### Miri (miri-runner.js)

Build settings' **Miri** runs the program, or its tests, under Miri
instead of compiling them: what `cargo miri run` and `cargo miri test` do.
Miri interprets the program's MIR with its checks on (Stacked Borrows,
alignment, validity of values, uninitialised memory, data races, leaks),
so a program with undefined behaviour stops at the operation that has it,
and Miri says which rule it broke and where. Isolation is off
(`-Zmiri-disable-isolation`), so the clock, the environment and random
numbers work.

Miri interprets **as if on a target**, and that is the other reason to use
it: `size_of`, `align_of`, the layout of structs and enums, pointer width,
endianness and the target's cfgs are the Miri target's. The Miri targets
(`src/miri-targets.json`) are chosen to differ where layout does:

| Miri target | triple | why |
|---|---|---|
| x86-64 | `x86_64-unknown-linux-gnu` | 64-bit, little-endian |
| AArch64 | `aarch64-unknown-linux-gnu` | 64-bit, little-endian |
| RISC-V 64 | `riscv64gc-unknown-linux-gnu` | 64-bit, little-endian |
| x86 (i686) | `i686-unknown-linux-gnu` | 32-bit; `u64` and `f64` aligned to 4, so `struct S(u8, u64)` is 12 bytes, not 16 |
| ARMv7 | `armv7-unknown-linux-gnueabihf` | 32-bit, as WebAssembly's pointers, with `u64` aligned to 8 |
| s390x | `s390x-unknown-linux-gnu` | 64-bit, **big-endian**: `to_ne_bytes` and transmutes show it |

The Miri select offers them all, the one nearest the project's target
first (a WebAssembly project's is ARMv7). WebAssembly itself is not one:
Miri has no shims for WASI's system calls, so std on wasm32-wasip1 cannot
print under Miri.

Miri's standard library is built for Miri (`cargo miri setup`, by the
native Miri of the same release), so a panic unwinds: `catch_unwind`
works, and tests run under libtest. It is an interpreter, and slow:
roughly 100 to 1000 times slower than the compiled program.

### Property-based tests

[quickcheck](https://github.com/BurntSushi/quickcheck) 1.0.3, the
standard property-based testing crate without procedural macros, is the
one crates.io package here. A project asks for it as it would with Cargo,
and the sample does:

```toml
[dev-dependencies]
quickcheck = "1"
```

```rust
use quickcheck::quickcheck;

quickcheck! {
    fn distance_is_symmetric(ax: i32, ay: i32, bx: i32, by: i32) -> bool {
        let a = Point::new(ax as f64, ay as f64);
        let b = Point::new(bx as f64, by as f64);
        distance(a, b) == distance(b, a)
    }
}
```

`quickcheck!` (a `macro_rules!` macro) makes each property a `#[test]`
that tries 100 random inputs and, when one fails, shrinks it and fails
with the smallest it found:

```
running 2 tests
test distance_is_symmetric ... ok
test norm_stays_under_100 ... FAILED

failures:

---- norm_stays_under_100 stdout ----
thread 'norm_stays_under_100' panicked at quickcheck-1.0.3/src/tester.rs:165:28:
[quickcheck] TEST FAILED. Arguments: (100)
```

How it gets here: `crates/Cargo.toml` asks for `quickcheck = "=1.0.3"`
without default features (they add env_logger and regex, for
configuration through environment variables a program here does not have),
`crates/Cargo.lock` pins it and its dependencies by version and checksum,
and `scripts/build-crates.mjs` has stable Rust 1.98.1's Cargo build them,
`--release`, for every target (rlibs, line tables only), and with
`cargo miri build` for every Miri target (metadata with MIR). The same
version string as the pack's compilers is what lets those rlibs load
into them. The runner
passes `--extern quickcheck=...` to the crates Cargo would give it to:
`[dependencies]` to all of them, `[dev-dependencies]` to the test crates
only (so a Run of the sample downloads nothing more). A version
requirement 1.0.3 does not meet (`quickcheck = "0.9"`) is a warning, and
1.0.3 is used. Without the declaration `use quickcheck` is `E0432`, as with
Cargo.

Limits:

- **On WebAssembly, a property must return `bool` or `TestResult`.**
  quickcheck finds out that a property failed either from its result or
  by catching its panic, and panics cannot be caught there (above). A
  property that panics fails its test with that panic, and the first
  failing input is not shrunk or printed. On a Linux target and under
  Miri, panics are caught and shrunk as natively.
- **No `#[quickcheck]` attribute**: it is the `quickcheck_macros` crate, a
  procedural macro. `quickcheck!` and `quickcheck(f as fn(...) -> bool)`
  do the same.
- Under Miri, every case is interpreted: `QuickCheck::new().tests(20)`
  runs fewer.
- proptest, the other common crate, was not added. It would probably run
  (its `prop_assert!` returns an error rather than panicking), but it is
  three times the dependencies (regex-syntax, bitflags, num-traits,
  rand_chacha, rand_xorshift, unarray, and rusty-fork and wait-timeout for
  its default `fork` and `timeout` features, which spawn processes), and it
  saves failing cases to `proptest-regressions/` files by default. One
  property-testing crate is enough to have the technique.

### Mutation testing: not available

[cargo-mutants](https://mutants.rs) is the maintained mutation tester for
Rust. It is a Cargo subcommand that copies the source tree, edits one
function at a time and runs `cargo build` and `cargo test` as child
processes for each mutant, timing each against a baseline. None of that
exists here: there is no Cargo, no process to spawn and no file tree to
copy; and each mutant would be a full compile and test in the browser
(seconds each, so a few hundred mutants would take tens of minutes).
[mutagen](https://github.com/llogiq/mutagen) inserts its mutations with
an attribute procedural macro (`#[mutate]`) and a nightly toolchain, and
there are no procedural macros here (and it is unmaintained since 2020).
Writing a mutation runner for this pack would be a new tool, not an
existing one, which this pack does not do.

## Compiler output views (src/explorer.js)

The app's **MIR**, **LLVM IR** and **Assembly** views (../CONTRACT.md,
"Showing compiler output") show the crate the active file is in, compiled
by the runner's rustc for the project's target at its optimisation level,
each line mapped to the source line it came from. Compile only: nothing
is linked.

* Which crate: `src/main.rs` and `src/lib.rs` are their own; a file of
  `tests/` is a test crate; any other file is a module of the library, or
  of the binary when `src/main.rs` declares it (`mod point;`). For a binary
  or test crate the library is compiled first, to metadata with every
  function's MIR (`--emit=metadata -Zalways-encode-mir`), which code
  generation needs of the functions it may inline across crates.
* **MIR** is `-Zunpretty=mir -Zmir-include-spans`, borrow checked, each
  statement, terminator and local mapped to the span rustc prints after it
  (`src/mir.js`). Above opt-level 0 it is the MIR the optimiser hands LLVM.
* **LLVM IR** and **assembly** (`--emit=llvm-ir`, `--emit=asm`) are made
  with line tables only and one codegen unit, and filtered as the C/C++
  pack's are (`src/emit-filter.js`, the same file): the project's own
  functions unless **Library** is on, directives only when asked. Assembly
  is WebAssembly's, x86-64's, AArch64's or RISC-V's, as the target is
  (`-Zverbose-asm` gives the function markers the filter reads). Above
  opt-level 0, lines that had code unoptimised and have none now are
  marked as optimised away.
* **Demangle** undoes rustc's v0 symbol names (`_RNvCs…_6shapes6square`
  is `shapes::square`) and the legacy ones the standard library still
  has, as rustc-demangle's `{:#}` prints them (`src/demangle.js`).

`test-mir.mjs` checks the filters, the crate rule and the demangler on
output rustc 1.98.1 printed for `tests/fixtures/sample.json`
(`tests/fixtures/gen.mjs` makes it again).

## Alternatives considered

- **The `rust-analyzer` binary on WASI**: needs threads (its main loop,
  the VFS loader, the flycheck and proc-macro servers) and `cargo
  metadata`. The IDE crates, driven directly, need neither; the one
  thread salsa still wanted (dropping parse trees in the background) is
  turned off with `--cfg no_salsa_async_drops`.
- **rubri's Miri** (this pack's runner until rustc was built here):
  bjorn3's Miri 1.78 on wasm, with an x86_64 sysroot. No code generation,
  an old compiler, one target, panics that could not be caught, and its
  undefined-behaviour checks off to be bearable. Building rustc with LLVM
  gave real programs, every target, and Miri of the same release as a
  checker rather than as the only way to run.
- **Cranelift instead of LLVM**: smaller and faster to build, but no
  RISC-V, worse code, and its debug info is not what the debugger reads.
  The C/C++ pack is LLVM, and the views are meant to show what it does.
- **A WebAssembly Miri target**: Miri cannot run std on wasm32-wasip1 (no
  shims for WASI), hence ARMv7 as the 32-bit stand-in.
- **Remote compilation (the Rust playground)**: excluded by the contract;
  nothing here leaves the browser.

## Files and sizes

What the browser downloads, from `/packs/rust/` (served brotli or gzip
where the server can):

| file | raw | gzip | brotli |
|---|---:|---:|---:|
| `server.js` | 3.9 KB | 1.9 KB | 1.7 KB |
| `rust-analyzer.wasm` | 12.2 MB | 4.0 MB | 2.6 MB |
| `std-src.tar` | 12.7 MB | 2.4 MB | 1.65 MB |
| **editor total** | **24.9 MB** | **6.4 MB** | **4.2 MB** |
| `runner.js` | 40 KB | 13 KB | 11.9 KB |
| `miri.wasm` | 47.2 MB | 15.1 MB | 9.4 MB |
| `sysroot.tar` | 83.0 MB | 29.7 MB | 20.4 MB |
| **runner total** | **130 MB** | **44.8 MB** | **29.8 MB** |
| `quickcheck-1.0.3.tar` (runner, when `Cargo.toml` names quickcheck) | 6.9 MB | 2.6 MB | 1.64 MB |
| `quickcheck-1.0.3-src.tar` (editor, when `Cargo.toml` names quickcheck) | 5.3 MB | 0.94 MB | 0.47 MB |

The runner's parts are downloaded on the first Run or Test only; the
quickcheck archives only for a project that declares it (the runner's for
Test when it is a dev-dependency). Most of both is libc (4.9 MB of the
metadata, 4.4 MB of the sources), which getrandom needs on Linux.
`sysroot.tar` is the rubri sysroot's rlibs reduced to their `lib.rmeta`
member (the object code is never used by an interpreter), without
`proc_macro` and the compiler-internal crates. `std-src.tar` leaves out
std's tests, benches and the platform layers of operating systems other
than Linux (`scripts/make-sysroot-src.py`).

## Versions and licences

| what | version | from | licence |
|---|---|---|---|
| rust-analyzer IDE crates (`ra_ap_*`) | 0.0.358 | crates.io, locked in `server/Cargo.lock` | MIT OR Apache-2.0 |
| Rust toolchain that builds the server | 1.98.0 | rustup | MIT OR Apache-2.0 |
| rust-src (std sources for analysis) | 1.98.0, sha256 `0e977492...870f2bf` | static.rust-lang.org | MIT OR Apache-2.0 |
| rustc, Miri, LLVM, lld (`rustc.wasm`, `rustc-cross.wasm`, `miri.wasm`) | 1.98.1, LLVM 22.1.8 | Rust's source tarball (`rustc/pins.sh`), built by `rustc/build.sh` with wasi-sdk 34; patches in `rustc/patches` (homescoop's, Apache-2.0, and ours) | MIT OR Apache-2.0; LLVM: Apache-2.0 WITH LLVM-exception |
| rust-std per target | 1.98.1, sha256 pinned in `build.sh` | static.rust-lang.org | MIT OR Apache-2.0 |
| Miri's std per Miri target | 1.98.1 | `cargo miri setup` by native Miri of the same tarball | MIT OR Apache-2.0 |
| browser_wasi_shim | 0.4.2 | npm | MIT OR Apache-2.0 |
| quickcheck | 1.0.3 | crates.io, locked in `crates/Cargo.lock` | Unlicense OR MIT |
| rand, rand_core, getrandom, libc, cfg-if | 0.8.8, 0.6.4, 0.2.17, 0.2.191, 1.0.5 | crates.io, locked in `crates/Cargo.lock` | MIT OR Apache-2.0 |

Full notices: `LICENSES.txt`, shipped next to the pack's files.

## Building and testing

```sh
cd packs/rust
npm install
./build.sh        # writes ../../app/static/packs/rust/
node test.mjs     # the language server in headless Chromium
node test-run.mjs # the runner in headless Chromium
```

`build.sh` installs Rust 1.98.0 (minimal profile, wasm32-wasip1) with
rustup if needed, caches everything under `$PACK_CACHE/rust` (default
`~/.cache/yukibana-packs/rust`): the cargo target directory (about 1 GB),
rust-src, and rubri's files. A first build takes about 10 minutes on 4
cores: 4 for rust-analyzer's crates, most of the rest compressing the
sysroot with brotli. A rebuild with a warm cache is a few minutes.

`test.mjs` serves the static directory with cross-origin isolation and
drives the server through the sample from `app/src/lib/languages.ts`: clean
diagnostics, errors and their clearing, completion (members, std,
auto-import), hover (with std docs and layout), definition, references,
symbols, signature help, highlights, rename, semantic tokens, inlay hints, a
quick fix, a new module file and its deletion; then the brotli-served files
and a renamed package; quickcheck's sources loading because `Cargo.toml`
names it, hover and completion from it, and `use quickcheck` unresolved
without the declaration. `test-run.mjs` runs and tests the sample, a failing
test, a passing and a failing quickcheck property (with its shrunk
counterexample), quickcheck loaded only when declared, a `[dependencies]`
entry with a version 1.0.3 does not meet, stdin (a prompt, then end of file), compile errors (`E0308`, the
borrow checker's `E0382`), a panic, `process::exit`, a project without
`Cargo.toml`, and an endless loop that is stopped.
