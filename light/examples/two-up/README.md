# Two snippets, two instances

A page with a C++ snippet edited in Monaco and a Python snippet edited in a
plain `<textarea>`, each run by an instance of `@yukibana/core` of its own,
both borrowing one host, so one runner pool for the page. It is step 8 of
`light/modules/DESIGN.md`: the second host, which proves the packages work
without Light's app, imported by name as another site would import them.

```sh
npm ci
npm run dev                        # http://localhost:5173, packs from light/app/static/packs
npm run check                      # TypeScript, strict, the modules' settings
npm run build && npm test          # the bundle fixtures (tests/bundle.test.mjs)
npm run build && npm run test:e2e  # the page in Chromium with the C++ and Python packs
```

The end-to-end test (`test.mjs`) serves `dist/` cross-origin isolated and
the packs from `light/app/static/packs` (or `$PACKS`): the C++ and Python
packs must be installed there, which CI does not do, so CI checks the
types, the build and the bundle fixtures, and the end-to-end test runs
where the packs are.

## How it is put together

```text
index.html, src/main.ts   the page: one host, two instances (C++ alone, Python alone),
                          each with its package's own providers
src/host.ts               the host both borrow (std's PackHost): one pool, one set of
                          explorer workers, the packs' locator
src/snippet.ts            one snippet: Run (enabled as the instance says), Stop, status,
                          output; it sees an editor only as a core Project and EditorPort
src/cpp-editor.ts         Monaco's bare editor with C++'s grammar, loaded by import():
                          a one-model project and @yukibana/monaco's monacoPort
                          (the Python snippet's editor is @yukibana/editors/textarea)
```

```text
C++ instance ──┐                    ┌─ cpp runner worker
               ├── one PageHost ── one RunnerPool
Python instance┘                    └─ python runner worker
```

## What it checks

In Chromium (`test.mjs`): each instance knows its own language and
nothing of the other's (`languageOf`, `has`); nothing starts a runner
before the first Run; each snippet runs on its own instance and shows its
own output only; what is typed in the textarea is what runs; both run
again together through the one pool, never with two runners of one pack
at once.

From the build (`tests/bundle.test.mjs`, over the chunk list
`vite.config.ts` writes to `dist/.vite/chunks.json`): a first load runs at
most 1% more script than `bundle-budget.json` records, and neither Monaco
nor any language's body; no module is bundled into two chunks, so the
second instance shares the first's core, std and runtime; Monaco is one
chunk, the C++ editor's, which the page imports lazily.

The page keeps its host and instances in `globalThis.twoUp`, for the
test. Neither snippet has a language server (DESIGN.md section 17 says
why).
