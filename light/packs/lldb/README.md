# LLDB pack

The debugger of the languages that compile to WebAssembly with LLVM's debug
information: C, C++ and Swift now, Rust once its pack compiles with
rustc and LLVM. It is no language's pack
of its own. A runner imports it, by URL, for a run the person started with
Debug, and the app talks to it in the Debug Adapter Protocol, as an IDE talks
to lldb-dap.

| File | What it is |
| --- | --- |
| `debugger.js` + `lldb-dap.js` + `lldb-dap.wasm` | **lldb-dap** of **LLVM 23.1.4**, compiled with Emscripten 6.0.13 (the C/C++ pack's), patched for the browser (`patches/lldb-browser.patch`): LLDB's Debug Adapter Protocol server in a module Web Worker |
| `runtime.js` + `instrument.wasm` | what a runner imports: the instrumenter (`instrument/`, Rust) and the stub LLDB debugs the program through (`src/stub.js`) |

## How it fits together

```
 page (app)                   debugger.js worker               runner worker
 ──────────                   ──────────────────               ─────────────
 Debugger (debug.svelte.ts)   lldb-dap.wasm                    the program, instrumented
   DAP messages  ──────────►  /dev/dap (stdin, stdout)
                              LLDB, ProcessWasm
                              GDB remote over  ◄═══ channel ═══► stub.js
                              ConnectionSharedRing  (two rings  (probe() at every line)
                                                     in LLDB's
                                                     shared memory)
```

1. The app starts the debugger's worker. It loads lldb-dap and says
   `{ type: 'ready', channel }`: the shared memory and address of the
   channel (`src/channel.js`).
2. The app runs the project with `debug: channel` in the run message
   (CONTRACT.md, "Debugging"). The runner compiles with `-g -O0`, posts the
   program as linked (`{ type: 'debug', name, wasm }`, which the app writes
   into LLDB's file system), instruments it, and runs it under the stub.
3. The app sends lldb-dap `attach` with `process connect --plugin wasm
   yukibana://`. LLDB's WebAssembly process plugin speaks GDB remote to the
   stub over the channel: it reads the module from the stub, sets
   breakpoints, asks for the call stack, the locals' frame base and the
   memory, and continues and steps.

### For a runner

```js
const { debugProgram, Killed } = await import(new URL('../lldb/runtime.js', import.meta.url).href);
const { module, stub } = await debugProgram(linked, { channel: run.debug, name: '/debug/program.wasm', beforeStop: flushStdout });
post({ type: 'debug', name: '/debug/program.wasm', wasm: linked });
const instance = await WebAssembly.instantiate(module, { ...wasiImports, ...stub.imports() });
stub.attach(instance);
// run _start; then stub.exited(code), or stub.crashed(signal, text) for a trap
// (it serves LLDB until it continues); Killed out of either is LLDB's Stop: exit 137
```

Compile with full debug information and no optimisation (`-g -O0`; Swift
`-g -gdwarf-types -Onone`): at -O0 every variable lives in linear memory at
an offset from the frame base, which is what the stub can show. The C++
(`packs/cpp/src/runner.js`) and Swift (`packs/swift/src/runner.js`)
runners do exactly this.

### Why a stub and not V8's debugger

A worker cannot pause itself and still answer questions about its state,
and the page cannot reach into a worker's frames (no Chrome DevTools
Protocol for a page's own workers). So the program pauses itself: the
instrumenter puts a call to an import, `probe(site, depth, caller, fb)`,
at every statement of its line table and after every call, and the stub
behind that import decides at each one whether to stop. When it stops it
waits on the channel (`Atomics.wait`, the runner is a worker) and answers
LLDB's packets until LLDB says go on. The program's memory, globals and
frame base are its own, so the answers are exact. The cost is a call per
statement, which a debug build at -O0 hardly notices.

### Instrumenting

`instrument/` (`yukibana-instrument`, `instrument.wasm` compiled to
wasm32-unknown-unknown) reads the module's DWARF line table and frame bases
(gimli) and rewrites the module (wasmparser, wasm-encoder):

* an import `yukibana:debug.probe` (i32 ×4 → nothing), so every function
  index moves up by one;
* two mutable globals, the call depth and the caller's return offset, and
  two locals per instrumented function, its depth and its caller;
* at each `is_stmt` row and after each call, a probe with the row's offset
  in the original code section, the depth, the caller's offset and the
  frame base (the local or global `DW_AT_frame_base` names);
* every global exported as `__yk_global<i>`, so the stub reads them; custom
  sections but `name` dropped (LLDB reads the original module, with its
  DWARF, from the stub; the instrumented one never needs it).

The site table it returns is five little-endian u32s a site: offset, kind
(0 a statement, 1 after a call), function, frame-base kind (0 none, 1
local, 2 global) and its index. LLDB's addresses are the original module's
(`0x4000000000000000 | offset`), so it sees the program as compiled.

### The stub

`src/stub.js` (`createStub`) answers what ProcessWasm asks (LLVM 23):
`qSupported`, `qXfer:libraries:read` (the module, at `0x4000000000000000`),
`qWasmCallStack` (from the probes' shadow stack), `qWasmLocal` (the frame
base only: the locals the instrumenter cannot see are not asked for at
-O0, where every variable is on the shadow stack in linear memory),
`qWasmGlobal`, `m`/`M` (the module's bytes or linear memory), `Z0`/`z0`
(a breakpoint at the next site), `c`, `s`, `vCont`, `k`, `D` and the
handshake. A step stops at the next site of any frame; LLDB's own stepping
plans turn that into step over, into and out. Stop (`k`) throws `Killed`
out of the program.

Two things LLDB needs that a real CPU gives it for free. A breakpoint LLDB
sets between sites (a step out's return address can be mid-statement) stops
at the next site but reports the address LLDB asked for, or LLDB does not
recognise its own breakpoint and calls the stop a SIGTRAP. And a step that
lands on a site where LLDB has a breakpoint reports that breakpoint, not a
trace: a `s` here can move a whole line, onto the end of the range LLDB is
stepping through, and LLDB would otherwise auto-continue past it.

### The connection

`yukibana://` is a connection of LLDB's own
(`ConnectionSharedRing`, in the patch): two single-producer rings in
LLDB's wasm memory, which is a SharedArrayBuffer because lldb-dap runs
threads. LLDB waits with `emscripten_futex_wait`, the stub with
`Atomics.wait`, so neither polls. The header is the magic `0x796b6462`,
the ring size and the two rings' offsets; each ring is head, tail, closed
and its bytes (`src/channel.js`).

### The patch

`patches/lldb-browser.patch`, against LLVM 23.1.4's `lldb/`:

* `ConnectionSharedRing`, and `ProcessGDBRemote::ConnectToDebugserver`
  using it for `yukibana://`;
* the Host layer and host platform of Linux for Emscripten (its libc is
  one; without a host platform, creating a target dereferences a null
  one), and no process launching (a browser starts no processes);
* liblldb static (Emscripten has no shared libraries) and no
  `--exclude-libs` (no dynamic linker);
* TypeSystemClang accepting `DW_LANG_Swift`, so a Swift program compiled
  with `-gdwarf-types` shows its variables as C-like types until a Swift
  LLDB is built, and a Swift function shown by its `DW_AT_name`
  (`distance(_:_:)`): upstream LLDB cannot demangle its linkage name.

## What it cannot do yet

* **Expressions** that call functions: LLDB cannot JIT into the program.
  `frame variable` and the Variables panel work; `p f(x)` does not.
* **Rust's formatters** are Python in upstream LLDB, which this build has
  not: a `Vec` shows its fields, not its elements.
* **Linux targets** (QEMU): the runner refuses Debug for them. QEMU's
  gdbstub over the same channel is the plan.
* **Watchpoints.**

## Build

A split pack (`light/scripts/pack-toolchain.sh`): two units and glue.

| Unit | Builds | Needs | Time |
| --- | --- | --- | --- |
| `lldb` | `lldb-dap.js`, `lldb-dap.wasm` (`build-lldb.sh`) | `cpp/emsdk` | 2 to 3 hours on four cores from nothing |
| `instrument` | `instrument.wasm` | rustup | a minute |

```sh
light/scripts/pack-toolchain.sh ensure lldb --build-dirty   # the units
light/scripts/pack-toolchain.sh assemble lldb $(light/scripts/pack-toolchain.sh ensure lldb --build-dirty)
```

`lldb-dap.wasm` is over the 25 MiB a static asset may be; deploy puts it
in R2 (`deploy/prepare.mjs`).

## Tests

* `node --test test-stub.mjs`: the instrumenter and the stub, with a
  scripted GDB-remote client, over `tests/hello.wasm`.
* `node test.mjs`: lldb-dap in Chromium debugging the same program through
  DAP: a breakpoint, the call stack, the variables, a step, the end.
* `cargo test` in `instrument/`.
