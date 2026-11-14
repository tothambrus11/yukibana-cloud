# Examples

Hosts other than Light's app, built the way another site would build them,
each a project of its own with its own `package.json`, tests and CI job.
They use the shared modules (`../modules`) as a host outside this
repository would, by package name, and they are where the modules' API is
tried before it is called stable (section 5 of the architecture plan).

| Example | What it shows |
|---|---|
| `cpp-library/` | the simplest concrete case, one `createPlayground` call (`@yukibana/playground`): C++ in Monaco against a library of one's own (a header found through `compile_flags.txt`'s `-I`, a source compiled and linked with `main.cpp`), the language server's answers in the editor, and Run |
| `cpp-library-sveltekit/` | `cpp-library/` as a SvelteKit 3 app: a `<CppPlayground>` component whose markup prerenders and whose Monaco and playground load on mount |
| `astro-docs/` | a static Astro 5 docs site (MDX) whose samples are Preact islands hydrated with `client:visible`: one recipe in five languages in script-free tabs, a live web preview (std's `preview`), a Python page reading a CSV it ships, and snippets that continue earlier ones |
| `lsp-editors/` | the packs' language servers in two editors, for Python, C++, Rust, Go, TypeScript and JavaScript: Monaco bound by `@yukibana/monaco`'s `MonacoBinding` (diagnostics, hover, completion, go to definition across files, rename, code actions), and a plain textarea (`@yukibana/editors/textarea`) whose page is the session's client, drawing problems, hover, completion and go to definition beside it |
| `hylo/` | a docs page of Hylo snippets running Hylo's own compiler, bundled by the page, through one runner pool (step HY1), run through an instance of `@yukibana/core` (DESIGN.md step 8) |
| `react-explorer/` | a systems-programming article in React 19 whose C++, Rust, Swift, Python and JavaScript samples compile, run, show their assembly (source and output lines linked), step under LLDB and report AddressSanitizer errors in the page; reusable hooks `useInstance`, `useRun`, `useExplore`, `useDebug` |
| `two-up/` | two instances of `@yukibana/core` on one page, C++ in Monaco and Python in a textarea, sharing one runner pool (DESIGN.md step 8) |
| `svelte-course/` | a Svelte 5 lesson page of graded exercises in Python, JavaScript, Rust, C++ and Swift (Swift untested: never compiled, its pack was never installed where it ran): Run with stdin, Check through std's `test` token into a checklist, progress in `localStorage`, the solution as a diff; one instance and one runner pool for the page, Monaco loaded lazily with a textarea on phones |

An example imports the shared modules by their package names, the npm
packages its `package.json` declares and its own files, never Light's app
(`light/modules/boundaries.test.mjs`).
