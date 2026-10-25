# Examples

Hosts other than Light's app, built the way another site would build them,
each a project of its own with its own `package.json`, tests and CI job.
They use the shared modules (`../modules`) as a host outside this
repository would, by package name, and they are where the modules' API is
tried before it is called stable (section 5 of the architecture plan).

| Example | What it shows |
|---|---|
| `hylo/` | a docs page of Hylo snippets running Hylo's own compiler, bundled by the page, through one runner pool (step HY1) |
