# A compiler-explorer article in React

A systems-programming blog post, *What your compiler does with a loop*,
written as a React 19 + Vite page whose code samples are live: they
compile, run, show their assembly and step under a debugger in the
reader's browser, through the embeddable Yukibana packages. It is the use
case of a technical blog or course notes that want Compiler Explorer and a
debugger inline, with no server.

The reusable part is `src/yukibana/`: a few React hooks over
`@yukibana/core`, with contracts, that another React site copies whole.
The article (`src/article/`) and its components (`src/components/`) are
one way to use them.

## The four widgets

| # | Widget | What it shows | Yukibana it uses |
|---|---|---|---|
| 1 | `ExploreWidget` | a C++ loop and clang's WebAssembly or LLVM IR side by side; the optimisation level as a segmented control; pointing at a source line lights up the instructions it became, and the reverse; a click on an instruction shows its line; at `-O2` the loop turns into its closed form, and a note counts the source lines optimised away | std's `explore` token through lang-cpp's provider (`CPP_VIEWS`, its toggles), the answer's `lines` (source mapping) and `unoptimized`; lang-cpp's `CPP_LEVEL` property (the `-O` line of compile_flags.txt) and `CPP_LEVELS`; std's `run` |
| 2 | `CompareWidget` | the same algorithm in **C++, Rust, Swift, Python and JavaScript**, one tab each: Run and its output, and each compiler's views (Rust's MIR / LLVM IR / assembly, Swift's SIL / LLVM IR / assembly, Python's bytecode) with each language's own level picker; a scoreboard across the tabs; JavaScript says it has no compiler output view, from the instance (`has(explore)` is false) | one instance of five languages; `run`, `explore`; lang-rust's `RUST_LEVEL`, lang-swift's `SWIFT_LEVEL` (saved with the project, sent as `options.optimization`) |
| 3 | `DebugWidget` | a C++ insertion sort under LLDB: breakpoints in Monaco's gutter, Debug, Continue, Step over / in / out, Stop, the call stack and the selected frame's locals (opening a pointer to what it points at), all React state | std's `debug` token through lang-cpp's provider; the lldb pack's `debugger.js` (DAP); `@yukibana/monaco`'s `monacoPort` |
| 4 | `SanitizerWidget` | a heap off-by-one that exits 0, then the same program with AddressSanitizer: the runtime's report with its colours, a banner with the error and the SUMMARY's `main.cpp:7:19` as a link that shows the line | lang-cpp's `SANITIZERS` property (`-fsanitize=` line of compile_flags.txt); the C++ runner's sanitizer runtime (works on WebAssembly) |

Swift's widgets are written from lang-swift and the Swift pack's docs and
type-checked with the rest; where `packs/swift` is not installed the tab
says so in the runner's and the explorer's own words ("not installed"),
and the end-to-end test skips its two Swift checks, saying why.

## Run it

```sh
npm ci
PACKS=/path/to/light/app/static/packs npm run dev   # http://localhost:5173
npm run check                                       # TypeScript, strict, the modules' settings
npm run build && npm test                           # unit tables and bundle fixtures
npm run build && PACKS=… npm run test:e2e           # every widget in Chromium, with the packs
```

`PACKS` defaults to `../../app/static/packs`, where Light's app installs
them. The e2e test needs the cpp, rust, python, javascript and lldb packs;
swift is optional.

## The hooks (`src/yukibana/`)

```tsx
const CPP = defineLanguage(LANGUAGES.cpp, () => import('@yukibana/lang-cpp/body').then((b) => b.BODIES.cpp), 'cpp');

function Snippet() {
  const yukibana = useInstance([CPP]);                    // an instance of these languages, borrowing the page's host
  const project = useProject({ 'main.cpp': source });     // files and saved settings, edited in place
  const run = useRun(yukibana, CPP, project, { snippet: 'intro' });
  const asm = useExplore(yukibana, CPP, project, { kind: viewKind('asm') });
  const dbg = useDebug(yukibana, CPP, project, { snippet: 'intro-debug' });
  const level = useProperty(project, CPP_LEVEL);         // read and write a build setting
  …
}
// once, at the root:
<YukibanaProvider host={new PageHost(new URL('packs/', document.baseURI))}>…</YukibanaProvider>
```

| File | What |
|---|---|
| `host.ts` | `PageHost`, std's `PackHost` for the page: one `RunnerPool`, one set of explorer workers, the packs' locator, made on first use |
| `context.tsx` | `YukibanaProvider` and `useHost`: one host for every widget |
| `language.ts` | `defineLanguage`: a package's spec as a `PackLanguage`, its providers, its explore provider (for its views) and its Monaco language |
| `project.ts` | `MemoryProject`, the core's `Project` over files and saved settings (`meta`), applying the `ProjectEdit`s `writeProperty` returns |
| `useInstance.ts` | `useInstance(languages)`: `createInstance` once per widget |
| `useProject.ts` | `useProject`, `useSnapshot` (`useSyncExternalStore` over the project) |
| `useProperty.ts` | `useProperty(project, property)`, `levelOptions` (a level saved with the project, as runner and explorer options) |
| `useRun.ts` | `useRun`: availability, Run, Stop, the state and the output; `statusOf` |
| `useExplore.ts` | `useExplore`: one view, asked at once and 500 ms after each change, the newest answer only (a newer request aborts the older, whose answer is `dropped`), the worker released on unmount |
| `useDebug.ts` | `useDebug`: availability, breakpoints, Debug, Continue, steps, Stop, frames and variables; loads `debugger.ts` on the first Debug |
| `debugger.ts` | a DAP client of lldb-dap (the lldb pack's worker), framework-free; a copy of what Light's app has |
| `useLinkedLines.ts`, `mapping.ts` | source line ↔ output line: colour bands, what the pointer lights up (`tests/mapping.test.mjs`) |
| `ansi.ts` | terminal colours in output as styled segments (`tests/ansi.test.mjs`) |
| `useNearScreen.ts` | a widget asks for nothing until the reader scrolls near it |

Each widget makes its own instance, knowing only its languages; all share
the page's host, so the page has one runner per pack and one explorer
worker per toolchain however many widgets there are (the e2e test checks
that no pack ever had two runners at once).

## Hosting the packs

The packs (compilers, runtimes, LLDB, sanitizer runtimes) are static files,
served beside the page under `packs/<pack>/…`; the page finds them with
`PackLocator.unpinned(new URL('packs/', document.baseURI))`. Nothing of them
is bundled or committed here: `vite.config.ts` serves them in dev and
preview from `$PACKS`, streamed. A real site:

* copies (or syncs) the built packs it needs to its static host, under
  `packs/` (here: `cpp`, `rust`, `python`, `javascript`, `lldb`, `linux`
  and `swift`); the C++ pack's runner imports `../lldb/runtime.js`, so the
  packs must be siblings;
* serves `.wasm` as `application/wasm` and `.js` as `text/javascript`, and
  the precompressed `.br`/`.gz` beside each file with `Content-Encoding`
  if its host can (rustc.wasm is 114 MB raw);
* serves them from the page's own origin (the runners' needs say
  `sameOriginPacks`), or pins a build with `PackLocator.pinned` and gives
  the packs long cache lifetimes; files over a host's per-asset limit
  (lldb-dap.wasm is 47 MB) go to object storage under the same path.

## Cross-origin isolation

The debugger's channel and a program's standard input are
`SharedArrayBuffer`s, which exist only in a cross-origin isolated page, so
every response of the page and its packs carries

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`vite.config.ts` sends both in dev and preview (`isolatedWithPacks`), and
`test.mjs`'s server does too (with `Cross-Origin-Resource-Policy:
same-origin`). A consequence for the design: no third-party font or image
without CORP headers, so the page uses system fonts only. Without
isolation, runs work but cannot read input, and Debug cannot start.

## What loads when

A first load runs **91,854 B gzip** of script (`bundle-budget.json`;
about 60 KB of it is React and react-dom), checked within 1% by
`tests/bundle.test.mjs`, which also holds that the first load has none of:

* **Monaco** (696 KB gzip, one chunk, `MonacoEditor.tsx`), loaded when the
  first editor renders; until then each widget shows its source as text
  and can already Run;
* the **DAP client** (`debugger.ts`, 2.5 KB gzip), loaded at the first
  Debug, and LLDB itself (`lldb-dap.wasm`, 47 MB) then;
* the **explorer workers' code** and each **compiler**, loaded at a view's
  first request, which a widget makes only once it is near the screen;
* each language's **body**, which nothing here asks for.

No module is in two chunks: the four widgets' instances share one core,
std and runtime.

## What it checks

`test.mjs`, in Chromium with the installed packs (27 checks, 2 skipped
without the Swift pack): the page is isolated and asks for nothing below
the fold at load; widget 1's assembly at `-O0` has the loop, the pointer
links both sides, `-O2` removes the loop and reports the lines optimised
away, LLVM IR shows `define`, its program prints the sum; C++, Rust and
Python print the same line and show their views, Rust's `opt-level 3`
emits fewer instructions than `0` (the level reaches the explorer),
JavaScript prints it and says it has no views, the Swift tab says the pack
is missing (or, installed, runs and shows its views), the scoreboard lists
every result; the debugger stops at line 6 in `insertion_sort` with
`i = 1`, steps to line 7 with `key = 2`, continues to `i = 2`, opens a
pointer, clears the breakpoint from the gutter and runs to `1 2 5 7 9`;
the plain run of the overflow exits 0 and the AddressSanitizer run reports
`heap-buffer-overflow` at `main.cpp:7`; never two runners of a pack at
once; the dark scheme reaches the page and Monaco; no page error.

## Limits

* No language server: the editors colour and edit, but have no
  completions or diagnostics (binding clangd needs `MonacoBinding` and
  Monaco's internals, as DESIGN.md section 17 says).
* The DAP client is copied from Light's app; `@yukibana/runtime` has none
  yet.
* The sanitizer widget compiles at `-O0`: at `-O2` clang deletes the
  allocation and the overflow with it.
