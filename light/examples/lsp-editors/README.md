# Language servers in two editors

The packs' language servers, each its pack's `server.js` in a worker as a
`LanguageSession` of `@yukibana/runtime`, with two different editors as
the session's client. The two pages share everything but the editor
(`src/session.ts`, `src/languages.ts`).

| Page | Editor | What the server's answers become |
|---|---|---|
| `monaco.html` | Monaco, bound by `@yukibana/monaco`'s `MonacoBinding` | Monaco's own UI: squiggles, hover, completion, signature help, go to definition and references across the project's files, rename, code actions, semantic highlighting, inlay hints, the outline |
| `textarea.html` | a `<textarea>`, `@yukibana/editors/textarea` | the page's own client (`src/textarea-page.ts`): a problems list, the hover where the caret stops, completion on Ctrl+Space and the server's trigger characters, go to definition (F12) |

Each page opens a language's sample project (its package's `body`): in
Monaco, one model per file with a tab each; in the textarea, the entry
file, with the others as the adapter's hidden files, open in the server so
that imports resolve. `?language=` picks the language: `python`, `cpp`,
`rust`, `go`, `typescript` or `javascript`.

```sh
(cd ../.. && pnpm install --filter ./setup)   # the setup tool's own dependencies, once
node ../../setup/cli.mjs --latest   # the packs, in light/app/static/packs (once)
pnpm install
pnpm run dev                        # http://localhost:5173/monaco.html, /textarea.html
```

## What each editor takes of the modules

* **Monaco** needs nothing of its own for the language features: the
  binding registers them for the server's capabilities and keeps the
  models in sync. The page brings what a binding cannot: Monaco's editor
  contributions (`src/monaco-features.ts`; the bare `editor.api` has no
  hover or suggest widget to show answers in), the adapter of Monaco's
  internals the binding asks for (`src/monaco-internals.ts`), and an
  editor opener (`monaco.editor.registerEditorOpener`) that switches the
  editor to another file's model, without which standalone Monaco's go to
  definition never leaves the file it is in. Monaco's own TypeScript
  service is not loaded, so JavaScript and TypeScript are answered by the
  JavaScript pack's server alone.
* **The textarea** has no language features (DESIGN.md decision D10), so
  the page is the session's client (`SessionClient`): it announces only
  what it can show (no snippets, no workspace edits), opens every file of
  the project, tells the session of each edit as the whole text replaced
  (a textarea's input events do not say where it changed), and turns LSP's
  positions into the textarea's offsets and back (`src/text.ts`, tested
  in `tests/text.test.mjs`).

## Tests

* `pnpm test`: `src/text.ts`'s tables.
* `pnpm run build && pnpm run test:e2e [language...]`: Chromium against the
  installed packs. On both pages, for each language, the server starts and
  reports an error the test types in; for Python, also a hover, a
  completion accepted, and go to definition into another file. A language
  whose pack is not installed is skipped and named. `CHROMIUM` names the
  browser (a Chrome or Edge executable will do); otherwise
  playwright-core's own.
