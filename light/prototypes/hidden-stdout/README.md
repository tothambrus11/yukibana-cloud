# Hidden code and stdout (experiment E2)

**The question.** On a grading server, a student's code runs next to code
they must not read: the teacher's tests and the teacher's library. WebLab
hides stdout so that a student cannot print that code, and in doing so takes
print debugging away. The goal here: **students run their own tests against
the hidden library and see all of their output, while the teacher's tests and
library never leak.** The teacher's tests may run in a separate run whose
output the student does not see.

**Outcome.** You cannot make stdout safe by filtering it. What makes it safe
is keeping hidden bytes out of the student's address space. Once the hidden
library sits on the other side of a process boundary or a wasm-instance
boundary, everything the student's code prints can be shown unfiltered: no
hidden canary got through in any language, while the same attacks recovered
everything in-process. The boundary costs 2.8–6.8 µs per call over pipes with
both processes on one CPU, 0.4 µs over shared memory, and 9 ns between wasm
instances. Batched APIs make any of these negligible.

## Setup

The same exercise in Python, JavaScript, Java and C++, plus freestanding C++
compiled to wasm (`common/SPEC.md`). A hidden library `weight(n)` and
`weight_many(xs)` holds a secret constant and a canary string. Hidden tests
hold a canary string, expected values and inputs. The student writes `solve`.
There are three students: `honest` (calls `weight` per element and
debug-prints), `batched` (one `weight_many`), and `attack` (prints everything
reachable from inside `solve`: frames, bytecode constants, class-file
constant pools, reflection, `require.cache`, `Function#toString`, its own
mapped executable, files on disk, its whole wasm memory; optionally
base64-encoded). `measure.py` runs everything and checks what the student
saw for canaries, base64-decoded too. Results: `results/results.md`.

Arrangements:

* **inproc**: one process, in the same sandbox as the split run, with the
  hidden *sources* removed: Python bytecode only, Java class files, a stripped
  C++ binary (JavaScript has no compiled form).
* **inproc + filter**: inproc, with stdout redacted against every 8-character
  window and every 4+ digit number of the hidden sources.
* **split**: hidden code in a trusted process, student code in a sandbox
  (`common/sandbox.sh`: hidden directories covered by an empty tmpfs, its own
  PID namespace, no network, `nobody`, no-new-privs). They talk by
  bidirectional RPC over two FIFOs: the tests call `solve`, and `solve` calls
  `weight` back. **split-1cpu**: both pinned to one CPU. **split-shm**
  (C++): one shared-memory mailbox with spin-then-futex.
* **wasm mono / split**: one module with one memory, or library, tests and
  student as three instances with a memory each. The student imports only
  `lib.weight` (a direct wasm-to-wasm call) and `env.print`.

## Measured

Container: 4 vCPU Xeon 2.1 GHz VM, Linux 6.18. Medians of 3 runs, 200 000
calls.

| | library | test code | expected | test input |
|---|---|---|---|---|
| inproc (all four languages) | leaks | leaks | leaks | leaks |
| inproc + filter, plain | Py/JS/Java hidden; **C++ leaks** (hex dump of the binary) | hidden | C++ leaks | C++ leaks |
| inproc + filter, base64 | leaks | leaks | leaks | leaks |
| split, split-1cpu, split-shm (all) | — | — | — | only what the student prints of its own arguments |
| wasm mono | leaks | leaks | — (folded into code, which wasm cannot read) | leaks |
| wasm split | — | — | — | its own arguments only |

| per call to the hidden library | Python | JavaScript | Java | C++ |
|---|---|---|---|---|
| in-process | 152 ns | 60 ns | 18 ns | 1.8 ns |
| split, FIFOs | 35 µs | 29 µs | 24 µs | 25 µs |
| split, FIFOs, one CPU | **6.8 µs** | **6.3 µs** | **5.0 µs** | **2.8 µs** |
| split, shared memory | | | | **0.41 µs** |
| wasm, one module / three instances | | | | 3.2 ns / **8.7 ns** |
| one batched call of 200 000, split one CPU (in-process) | 56 ms (31) | 138 ms (13) | 78 ms (3.4) | 5.3 ms (1.7) |

What the numbers say:

1. **Every in-process arrangement leaks everything, in every language**,
   and shipping only compiled forms does not help: Python `co_consts` and
   frame locals, Java constant pools and `setAccessible`, the C++ program's
   own mapped image. Nor does a language-level wall inside the process: a
   process can read `/proc/self/mem`, and Pyodide's JS FFI hands out
   `Function` through any function's `.constructor`.
2. **Filtering fails and costs print debugging.** base64 gets past it in
   every language. Compiled forms (a hex dump) get past it without any
   encoding. And it blanked honest output: `starting [3, 1, 424242]` came out
   as `starting###############`, and any count of `1000` became `####`.
3. **The split leaks nothing hidden.** The attack walked the frames, the
   stub and the disk, and found only the RPC glue and an empty tmpfs.
4. **Most of the RPC cost was this VM's cross-CPU wake-up, not the RPC.**
   The two sides never run at the same time (one call stack spread across two
   processes), so pinning them to one CPU is free, and it made every language
   4–9× faster. Shared memory with a short spin gets C++ to 0.4 µs. An
   interpreted language spends most of its 5–7 µs in its own framing code, so
   a C extension for the channel would cut that further. It was not tried.
5. **Batching is what makes RPC a non-issue.** Where the teacher designs the
   library API (`weight_many`, or a "step the simulation N times" call),
   200 000 items cross in one call, and that costs within 2–10× of
   in-process.
6. **For the languages Light compiles to wasm (C, C++, Rust, Zig, Go,
   Swift, Haskell), separate instances are almost free** (≈5 ns extra per
   call), with no syscalls and no sandbox needed for the boundary itself. The
   boundary holds only if the host links nothing else into the student's
   instance: no WASI preopens of hidden files, no shared memory export.

## What this means for the design

Three runs, two of them shown to the student:

| run | contains | student sees |
|---|---|---|
| **student run** (their `main`, their own tests) | student code + library **stub**; real library in a trusted process (or wasm instance) | all stdout and stderr, unfiltered |
| **teacher run** | student code + teacher tests + library | verdicts only (pass/fail, message chosen by the teacher) |

* The student run is the split arrangement. Nothing hidden is in that
  process, so nothing hidden can be printed. The `test input` column does not
  apply: the inputs are the student's own.
* **What still leaks, by design:** the library's *behaviour*. A student can
  call it on any input and print the answer. That is what "use this library"
  means. If the behaviour itself is the secret (the library *is* the
  reference solution), no output policy can hide it. Don't put a reference
  solution behind an API students may call.
* **The teacher run needs the same isolation it has today, plus three
  things**, because hiding stdout does not close every channel:
  1. a fresh sandbox per run with no network and no writable storage that
     outlives it. Otherwise the teacher run writes the tests to a file and
     the next student run prints it.
  2. bounded verdicts: pass/fail and the teacher's own message, never the
     student's exception text or stdout. Then a submission leaks about one bit
     per test, plus timing. Rate limits and randomised hidden inputs (a fresh
     seed per run) make that bit cheap to give away.
  3. **integrity:** in-process, student code can also *edit* the tests
     (patch `hidden_tests.run`, override `==`). The verdicts are only
     trustworthy if the teacher run uses the split too, so that the
     comparison happens in the trusted process. That costs the same as the
     student run.
* Transport, in the order to try: FIFOs with both processes on one CPU (simple,
  any language, 3–7 µs); a batched library API where call counts are high;
  shared memory with a futex where it is still too slow (C++ 0.4 µs; other
  languages need a native extension); wasm instances where the language
  already runs as wasm.
* The stub is mechanical: the library's public API, each function one
  `call(fn, args)`. It can be generated from the API (or the starter's header
  or interface file) per language, so a teacher writes the library once.

## Not covered

Return values and arguments beyond `i64` arrays (strings and structures need
a schema, which is what the wasm component model's canonical ABI or a
generated stub would provide). Callbacks from the library into student code
(the channel supports re-entrant calls both ways, but no test exercises
deep nesting). Other sandboxes (gVisor, Firecracker) and their syscall costs.
Kotlin, Scala, Go, Rust, Haskell, PHP and Swift natively. Timing as a side
channel.

## Running it

As root on Linux with python3, node 22, a JDK 21, g++, and clang with
`wasm-ld`:

```sh
python3 measure.py            # ~2.5 min; REPEATS=1 for a quick pass
```

Each part also runs by hand: see the usage line at the top of each
`inproc.*`, `rpc/trusted.*` and `wasm/host.mjs`.
