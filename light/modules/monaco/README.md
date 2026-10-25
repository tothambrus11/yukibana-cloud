# @yukibana/monaco

A language session's results in the host's Monaco editor: converting between
LSP and Monaco, registering language features, keeping models for a chain of
files, the theme, and Monaco's editor services for a host that wants them.

## Contract

* The host's Monaco is injected (a `typeof monaco` argument). This module
  never bundles, configures or starts an editor, and never sets
  `MonacoEnvironment`.
* Importing it registers nothing. A feature or service exists from the call
  that registers it and is removed by disposing what that call returned.
* It never parses `yukibana.json`, and keeps nothing in `localStorage`.

## What is here

| File | What |
|---|---|
| `convert.ts` | every conversion between a language server's values (`@yukibana/protocol`'s `lsp.ts`) and Monaco's, as pure functions: positions and ranges both ways, markers, hovers and documentation, completions and their contexts, signature help, symbols, locations, highlights, workspace edits, folds, smart select, inlay hints, a refused rename's reason |

Two things a conversion cannot make without the host's Monaco, and how
`convert.ts` does without it:

* **Monaco's enums** are written out as numbers, in tables typed as the
  installed Monaco's own enums, so a Monaco upgrade that renumbers, adds or
  removes a member fails `npm run check` (and `tests/convert.test.mjs`
  proves that the check fires).
* **A document's model** is the host's to name: a conversion that meets a
  server's URI asks the host's `UriOf`, and a place in a document it
  answers null for is left out, or, in a workspace edit, named in
  `unsupported` rather than dropped. Light's app answers with
  `monaco.Uri.parse`; a host with a model per snippet answers from its
  session's map (step M7).

Its tests are `../tests/convert.test.mjs`, run with the other modules'.

## Allowed imports

Files of this module, `@yukibana/runtime` and `@yukibana/protocol`, by
relative paths ending in `.ts` or by the package name, and `import type`
from `monaco-editor`: a value import would bundle a second editor. Never
Svelte, dockview or `$app`.
