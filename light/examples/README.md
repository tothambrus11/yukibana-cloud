# Examples

Hosts other than Light's app, built the way another site would build them,
each a project of its own with its own `package.json`, tests and CI job.
They use the shared modules (`../modules`) as a host outside this
repository would, by package name, and they are where the modules' API is
tried before it is called stable (section 5 of the architecture plan).

| Example | What it shows |
|---|---|
| `astro-docs/` | a static Astro 5 docs site (MDX) whose samples are Preact islands hydrated with `client:visible`: one recipe in five languages in script-free tabs, a live web preview (std's `preview`), a Python page reading a CSV it ships, and snippets that continue earlier ones |
| `hylo/` | a docs page of Hylo snippets running Hylo's own compiler, bundled by the page, through one runner pool (step HY1), run through an instance of `@yukibana/core` (DESIGN.md step 8) |
| `two-up/` | two instances of `@yukibana/core` on one page, C++ in Monaco and Python in a textarea, sharing one runner pool (DESIGN.md step 8) |

An example imports the shared modules by their package names, the npm
packages its `package.json` declares and its own files, never Light's app
(`light/modules/boundaries.test.mjs`).
