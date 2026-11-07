# Examples

Hosts other than Light's app, built the way another site would build them,
each a project of its own with its own `package.json`, tests and CI job.
They use the shared modules (`../modules`) as a host outside this
repository would, by package name, and they are where the modules' API is
tried before it is called stable (section 5 of the architecture plan).

| Example | What it shows |
|---|---|
| `hylo/` | a docs page of Hylo snippets running Hylo's own compiler, bundled by the page, through one runner pool (step HY1), run through an instance of `@yukibana/core` (DESIGN.md step 8) |
| `two-up/` | two instances of `@yukibana/core` on one page, C++ in Monaco and Python in a textarea, sharing one runner pool (DESIGN.md step 8) |
| `svelte-course/` | a Svelte 5 lesson page of graded exercises in Python, JavaScript, Rust, C++ and Swift: Run with stdin, Check through std's `test` token into a checklist, progress in `localStorage`, the solution as a diff; one instance and one runner pool for the page, Monaco loaded lazily with a textarea on phones |

An example imports the shared modules by their package names, the npm
packages its `package.json` declares and its own files, never Light's app
(`light/modules/boundaries.test.mjs`).
