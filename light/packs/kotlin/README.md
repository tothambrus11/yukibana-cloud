# Kotlin pack: the real kotlinc, in WebAssembly

**Compiler:** JetBrains' `kotlinc` 2.4.21 (K2), unmodified, compiled to
WebAssembly GC by **GraalVM Web Image** (`native-image --tool:svm-wasm`)
and loaded into a worker (`src/kotlinc.js`). How that build works, and
why each workaround is there, is in [`kotlinc/README.md`](kotlinc/README.md).

**Server:** ours (`src/server.js`), in one module Web Worker. Its
diagnostics are kotlinc's: a worker of its own (`src/check.js`) compiles
the whole project after each edit. Completion, hover, signature help,
definition, references, highlights and rename come from
[fwcd/kotlin-language-server](https://github.com/fwcd/kotlin-language-server),
an existing language server, compiled into the same image as kotlinc and
run in a worker of its own (`src/analysis.js`,
[`kotlinc/kls/README.md`](kotlinc/kls/README.md)). Until it has started,
and for symbols, the server answers from the syntax trees of
[web-tree-sitter](https://www.npmjs.com/package/web-tree-sitter)
0.25.10 and the Kotlin grammar
[`@tree-sitter-grammars/tree-sitter-kotlin`](https://github.com/tree-sitter-grammars/tree-sitter-kotlin)
1.1.0.

**Runner:** ours (`src/runner.js`). kotlinc compiles the project for
**Kotlin/Wasm with the WASI target**, and the program runs in a worker of
its own (`src/program.js`) with a terminal on stdin and stdout. Test runs
the project's `kotlin.test` tests the same way.

Requires a browser with WebAssembly GC and exception references (exnref):
Chromium 137 or later, Firefox 131 or later. Standard input needs a
cross-origin isolated page, as for every pack.

## Why Kotlin/Wasm for WASI

kotlinc in the browser can compile for the JVM, for JavaScript and for
Kotlin/Wasm. Only the last gives a program the browser runs with nothing
else: a WASI module of about 600 KB that imports four calls (`fd_write`,
`fd_read`, `poll_oneoff`, `random_get`), which `program.js` provides.
JVM class files would need a JVM or the Java pack's TeaVM to link them;
Kotlin/JS links in 5 to 6 s instead of one and prints numbers as
JavaScript does (`0` for `0.0`).

The price is the standard library: a Kotlin/Wasm program has Kotlin's
common standard library (collections, strings, `kotlin.math`, `readln`,
`println`), not the JDK. `java.util.Scanner`, `java.io.File` and
`kotlin.system.exitProcess` do not exist, and kotlinc says so in the editor
before Run, because the server checks against the same library Run
compiles with. Numbers and data classes print as on the JVM
(`Point(x=0.0, y=0.0)`).

## What is in `app/static/packs/kotlin/`

| file | raw | gzip | brotli | what |
|---|---|---|---|---|
| `kc.js.wasm` | 114.7 MB | 38.9 MB | **25.7 MB** | kotlinc, kotlin-language-server and our service (`kotlinc/service/`), WebAssembly GC |
| `kc.js` | 111 KB | | 18 KB | GraalVM's loader, patched by `build.sh` to take the bytes `kotlinc.js` downloaded |
| `kotlin-stdlib-wasm-wasi.klib` | 11.7 MB | | 2.5 MB | the standard library for Kotlin/Wasm WASI, with stored zip entries |
| `kotlin-test-wasm-wasi.klib` | 264 KB | | 78 KB | `kotlin.test` for it, from Maven Central |
| `kotlin-stdlib.jar` | 4.8 MB | | 0.8 MB | the JVM standard library, stored, which the language server analyses against |
| `tree-sitter-kotlin.wasm`, `tree-sitter.wasm`, `tree-sitter.js` | 3.80 MB | | 255 KB | the grammar 1.1.0 and web-tree-sitter 0.25.10, as published |
| `server.js`, `check.js`, `analysis.js`, `kotlinc.js` | | | 21 KB | ours: the language server, its checker and analyser, the loader |
| `stdlib-index.json` | 61 KB | | 8 KB | the standard library's and `kotlin.test`'s names and signatures, for completion (`scripts/stdlib-index.mjs`) |
| `runner.js`, `program.js` | | | 7 KB | ours: the runner, the program's worker |
| `manifest.json`, `LICENSE-*.txt`, `SOURCES.txt` | | | | sizes and versions; the licences, and where the GPL parts' source is |

The language server and the runner share every large file by URL, so the
browser downloads them once: **29.6 MB** with brotli for the pack. The
syntax features answer as soon as tree-sitter has loaded (0.27 MB);
kotlinc's diagnostics follow once it has downloaded and started.

Library archives have stored zip entries, not deflated ones: the image has
no zlib (`kotlinc/README.md`, "Run-time gaps"). They compress as well
either way for the transfer.

## Measured

Chromium (headless, Playwright) on a 4-core cloud container, from
`test-run.mjs` and `test.mjs`, files served raw from a local server:

| step | time |
|---|---|
| the server answers `initialize` (tree-sitter) | 0.16 s |
| kotlinc ready in the server's checker: download, instantiate, libraries | 3.2 s (0.5 + 1.6 + 0.7, local server) |
| an edit to its new diagnostics (debounce included) | about 0.5 s |
| kotlin-language-server ready in its worker (it starts when kotlinc has) | 3.4 s, 10.3 s after the server started |
| its completion (`"abc".tr`, `hyp`), hover | 0.1 s, 0.08 s |
| the runner's kotlinc ready, warm-up included | 16.6 s, of which the warm-up compile and link is 13.5 s |
| first Run in the app (the runner warm since the language started) | 8.6 s |
| a warm Run of the sample: compile, link, run | 1.0 s (0.2 + 0.7 + 0.1) |
| a warm Run of another program | 1.9 to 2.9 s (linking is 1.8 to 2.6 s) |
| Test of the sample (kotlin.test linked for the first time) | 3.4 s |
| Stop of an endless loop to the next run's output | 2.1 s, kotlinc kept |

The warm-up's first compile is slow because V8 tiers up kotlinc's 89 MB
of code as it runs; it happens while the person reads the sample, which
is why the runner is started ahead (`warmRunner`).

## What the server does

Once kotlin-language-server has started (`src/analysis.js`), completion,
hover, signature help, definition, references, highlights and rename are
its: Kotlin's own analysis, with inferred types, every library type's
members and extensions (`"abc".tr`, `names.`), KDoc, and the import a name
needs. Its answers are used as they are, except that a location outside the
project (a library's declaration, which the editor cannot open) is dropped,
and that an empty answer, an error, or one slower than ten seconds is
answered from the trees instead, as everything is while it loads. What the
trees answer:

* **Diagnostics:** kotlinc's, every error and warning with its range, in
  kotlinc's words, source `kotlinc`. A check compiles every `.kt` of the
  project, tests included, against the standard library and `kotlin.test`
  for Kotlin/Wasm WASI, as Test does, into a klib it throws away. Checks
  are debounced (150 ms) and a newer one replaces one still waiting;
  their results are published only for documents that have not changed
  since. Until kotlinc is ready, and for `.kts` scripts, which it does not
  check, tree-sitter's syntax errors are shown ("Syntax error: unexpected
  …", source `kotlin (syntax)`), as is everything if kotlinc cannot start
  (a browser without WebAssembly GC), which the server logs.
* **Completion:** after `.`, the members of a project class when the
  receiver's class is known (a parameter or property with a declared type,
  a `val` initialised with a constructor call, `this`, a class or object
  name), with its supertypes' members from the project, `Any`'s, and
  `copy` for a data class. After a receiver of any other type it offers
  nothing, and Monaco falls back to the document's words. After a class's
  own name (`Color.`): its enum entries, `entries`, `values` and `valueOf`,
  its companion object's members and its nested classes. In a branch
  condition of `when (c) {` whose subject has a project enum as declared or
  constructed type (`c: Color`), that enum's entries, inserted qualified
  (`Color.GREEN`: unqualified entries in `when` need an import, or Kotlin's
  experimental context-sensitive resolution); found by a scan of the text,
  so it works while the `when` is unfinished. Elsewhere: the
  names visible at the cursor (locals declared before it, parameters,
  lambda parameters and `it`, members of the enclosing class, top-level
  declarations of every file), keywords, and every top-level class,
  function and property of the standard library and `kotlin.test`, with
  each overload's signature and its package. A name outside the default
  imports comes with its import: accepting `hypot` adds
  `import kotlin.math.hypot` after the file's imports (none if the file
  already imports it or `kotlin.math.*`). After a standard library type's
  name (`Int.`, `Random.`): its companion's members and nested types.
  These come from `stdlib-index.json`, which the build makes from kotlinc's
  ABI dump of the two klibs a Run compiles against
  (`kotlinc/tools/src/yk/DumpAbi.java`, `scripts/stdlib-index.mjs`), so they
  are exactly Kotlin/Wasm's; a klib keeps no parameter names, so their
  signatures have types only (`fun hypot(Double, Double): Double`).
* **Hover:** the declaration's signature, its KDoc, and where it is; for a
  standard library name, its overloads and package.
* **Signature help** in calls of project functions and constructors, and
  of standard library functions (every overload).
* **Definition, references and highlights** of project declarations, by
  scope: a parameter, a local, a member through a receiver of known class,
  an enum entry or companion member through its class's name, a top-level
  declaration.
* **Rename** (with prepareRename) edits exactly what references finds, in
  every file. It refuses, with the reason the editor shows: a keyword, a
  name the project does not declare (the standard library's, a library's,
  or one the server cannot resolve), the implicit `it`, and a new name that
  is not a Kotlin name or is a hard keyword (backticks allowed).
* **Document symbols:** classes, objects, their properties and functions,
  top-level functions and properties, type aliases, enum entries.

## Running

Run compiles every `.kt` of the project except the tests (files under a
`test/` or `tests/` directory, such as `src/test/kotlin/`), in two steps as
Gradle does: sources to a klib (`-nopack`), then the klib to `main.wasm`
(`-Xir-produce-js`), with the standard library's linked code cached in
kotlinc's file system (`-Xcache-directory`) from the first link on. The
runner starts kotlinc as soon as the app starts it (`warmRunner`) and
compiles and links a small program out of sight, so the first Run already
links in about a second.

* **Output:** `stdout` and `stderr` messages as the program writes, a
  prompt without a newline included.
* **Input:** `readln()`, `readlnOrNull()` and `readLine()` read the
  terminal, blocking in `fd_read` on the contract's SharedArrayBuffer
  (CONTRACT.md, "Standard input"): a read with nothing left asks the app
  for a line. Ctrl-D answers one read with end of file. With no buffer,
  every read is end of file.
* **Compile errors:** kotlinc's, on stderr, as kotlinc prints them:
  `src/main/kotlin/Main.kt:2:18: error: …`, then the line with the range
  underlined. The run exits with kotlinc's code (1).
* **Uncaught exceptions:** `Exception in thread "main" IllegalStateException:
  boom`, on stderr, and exit code 1, as on the JVM. A WASI program cannot
  say this by itself (its uncaught exception is a WebAssembly exception
  without a message, and Kotlin/Wasm's WASI library has no stderr), so the
  runner compiles a small wrapper beside the project (`mainWrapper` in
  `runner.js`) that calls the entry file's `main` or `main(args)` (with no
  arguments), catches what it throws, and hands its text to the runner one
  character at a time. Kotlin/Wasm's traces have no stack frames, so only
  the exception and its message are shown. A `suspend fun main`, or a main
  the wrapper cannot call, runs without it, from WASI's `_start`.
* **Stop:** the runner understands `cancel`: it terminates the program's
  worker and answers `exit` 130 with `reusable: true`, keeping kotlinc warm.
  A cancel during a compile waits for it (a compile cannot be interrupted);
  the app terminates the runner if that takes longer than its grace period.
* **Reusable:** every exit says `reusable: true` unless kotlinc itself
  failed, and the next run starts from a fresh project directory.
* **Timings:** `mark` messages: `kotlinc-ready`, `kotlinc-warm-up`,
  `compiled`, `linked`, `first-stdout`, `exit`.

**Test** compiles every `.kt`, tests included, against `kotlin.test`
(`kotlin-test-wasm-wasi` 2.4.21, from Maven Central, sha256-pinned in
`kotlinc/build.sh`), and calls the module's `startUnitTests`, which runs
every `@Test` (with `@BeforeTest`, `@AfterTest` and `@Ignore`). kotlin.test
for WASI reports in TeamCity service messages (`##teamcity[testStarted
…]`), which the runner turns into a report for people: each class, each
test with ✓ or ✗, a failure's message under its test, and `3 tests: 3
passed`. Lines the tests print themselves pass through. Exit 0 only when
every test passed and at least one ran; a project with no `@Test` under
`test/` gets "No tests" and exit 1.

## Optimization: not offered

kotlinc for Kotlin/Wasm has no optimisation levels to choose from (its
own optimisations always run, Binaryen's are a Gradle step this pack does
not take), so the app's Optimization select is not shown.

## Download (Gradle)

Download writes `build.gradle.kts` (Kotlin 2.4.21, the `application`
plugin with the entry's `MainKt` class, `kotlin.test` on JUnit 5) and
`settings.gradle.kts`. `gradle run -q --console=plain` runs the program on
the JVM (stdin connected) and `gradle test` runs the tests. Checked with
Gradle 8.14.3 and Temurin 25: the sample prints
`Point(x=0.0, y=0.0) to Point(x=3.0, y=4.0): 5.0` and its three tests pass.
A project written for the browser also builds there: the common standard
library is part of the JVM's.

## What does not work

* **No JDK.** Programs use Kotlin's common standard library (see "Why
  Kotlin/Wasm for WASI"). No files, threads, networking, `exitProcess` or
  `System.currentTimeMillis()`; `kotlin.time` works.
* **The language server analyses for the JVM**, against the JVM standard
  library without the JDK (kotlinc/kls/README.md): completion can offer the
  few JVM-only names of `kotlin.jvm`, which kotlinc's check then reports.
  It is K1, Kotlin's previous frontend, as fwcd/kotlin-language-server is.
* **While it loads, resolution is by name and written types:** no
  inference across calls, no library types' members. Rename then misses
  what references misses: a simple string template (`"$name"`), an override
  of a renamed member, a named argument (`copy(x = 1.0)`).
* **Memory:** kotlinc is a 111 MB WebAssembly module, and the server's
  checker, its analyser and the runner each hold one: about 600 MB of the
  tab's memory each in Chromium.
* **No formatting, no quick fixes, no property-based or mutation
  testing.** kotest-property and PIT need the JVM; they work in the
  downloaded Gradle build.

## Licences

kotlinc, its standard library and `kotlin.test` are JetBrains', Apache 2.0
(`LICENSE-kotlin.txt`, with kotlinc's NOTICE and the licences of the
libraries it bundles). `kc.js.wasm` also contains GraalVM's Native Image and
Web Image runtime, with jimfs and Guava (`LICENSE-graalvm.txt`), and the
OpenJDK class library (`LICENSE-openjdk.txt`, with its third-party notices):
GPLv2 with the Classpath Exception, and Apache 2.0 for jimfs and Guava.
That GraalVM is Community, built from source (`graalvm/build.sh`), and its
corresponding source is attached to the release `SOURCES.txt` names.
fwcd/kotlin-language-server is MIT, and the libraries it is linked with are
EPL-2.0 (Eclipse LSP4J), MPL-2.0 (H2), Apache 2.0 and MIT
(`LICENSE-kotlin-language-server.txt`; `SOURCES.txt` says where the EPL and
MPL parts' source is).
web-tree-sitter and tree-sitter-kotlin are MIT
(`LICENSE-web-tree-sitter.txt`, `LICENSE-tree-sitter-kotlin.txt`). The app
lists every one of these files in its Licences dialog.

## Building and testing

```sh
./build.sh            # into ../../app/static/packs/kotlin/
node test.mjs         # the language server (playwright-core: npm install)
node test-run.mjs     # the runner: Run, stdin, errors, Test, Stop
```

`build.sh` fetches the tree-sitter packages from npm (sha512-checked) and
builds kotlinc with `kotlinc/build.sh` into
`$PACK_CACHE/kotlin/kotlinc-<key>`, `<key>` a hash of the image's inputs in `kotlinc/`: a change
of the pack's JavaScript reuses it, a change of `kotlinc/` builds it again,
in about 6 minutes with a peak of about 11 GB of memory (15 minutes the
first time, with about 1 GB of downloads: GraalVM, Binaryen, kotlinc and
kotlin.test, all sha256-pinned). Brotli at quality 11 on `kc.js.wasm`
takes about 4 minutes more, also once per key.

The app's `tests/e2e.mjs kotlin` drives the built app: diagnostics, Run
and Test.
