# kotlin-language-server in kotlinc's image

The Kotlin pack's editor gets completion, hover, signature help, go to
definition, references, highlights and rename from
[fwcd/kotlin-language-server](https://github.com/fwcd/kotlin-language-server)
(MIT), an existing language server, compiled with kotlinc into the same
GraalVM Web Image (`../build.sh`), rather than from analysis of our own.

It runs in the pack's analysis worker (`../../src/analysis.js`), a third
instance of the image beside the checker and the runner, behind
`yk.LanguageServerBridge` (`../service/src/yk/LanguageServerBridge.java`):
one JSON-RPC message in, the messages it answers with out, on the caller's
thread. The pack's server (`../../src/server.js`) forwards the open `.kt`
documents and those requests to it once it has started, and answers them
from tree-sitter until then, and if it fails or takes over ten seconds.

## What it analyses against

The server analyses for the JVM (K1, its frontend), against the JVM
standard library (`kotlin-stdlib.jar`) and no JDK. A Kotlin/Wasm program sees
the common standard library, which is in that jar too, so completion and
hover cover what a program can use, plus a few JVM-only names
(`kotlin.jvm.*`). The diagnostics that count are the checker's, from kotlinc
for Kotlin/Wasm; the server's own are switched off.

## The source and the patch

`../build.sh` fetches the server's source at a pinned commit, applies
`kotlin-language-server.patch`, and compiles it with kotlinc
2.4.21 (the server's own Gradle build is not used). The patch:

* **Compiles against kotlinc 2.4.** The K1 API it uses now needs opt-ins
  (`../build.sh` passes them) and an extension storage in the compiler
  configuration; scripting (`.kts`) and code generation are gone, as nothing
  here uses them.
* **Runs on one thread.** Web Image has one. With the system property
  `kotlinLanguageServer.singleThreaded`, `AsyncExecutor` runs its work at
  once, and `Debouncer` defers it to `SingleThread.runPending()`, which the
  bridge calls when the worker is idle. The index of the class path's
  declarations (what completion offers with an import) is built the same way.
* **Takes its class path and no JDK from system properties**
  (`kotlinLanguageServer.classPath`, `kotlinLanguageServer.noJdk`), instead
  of asking Gradle or Maven.
* **Completion**: a library's private and internal declarations are not
  offered (the standard library's `SynchronizedLazyImpl`, say), and the
  import a name needs goes on a line of its own in a file without a package
  or imports.

To change it: clone the server at the commit `../build.sh` pins, `git apply`
the patch, edit, and save `git diff` here (new files included, with
`git add -N`).

## Licences

The pack ships `LICENSE-kotlin-language-server.txt`, which `../build.sh`
assembles: the server's licence (MIT) and those of the libraries it is
linked with, which are in `licenses/` (the jars carry few of them):
Eclipse LSP4J (EPL-2.0), Gson, Guava, Exposed, JCommander, ktfmt and
Vineflower (Apache-2.0), H2 (MPL-2.0, of its dual MPL-2.0/EPL-1.0 licence),
and SLF4J (MIT). `SOURCES.txt` says where the source of the EPL and MPL parts
is.
