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
| `convert.ts` | every conversion between a language server's values (`@yukibana/protocol`'s `lsp.ts`) and Monaco's, as pure functions: positions and ranges both ways, markers, hovers and documentation, completions and their contexts, signature help, symbols, locations, highlights, workspace edits, code actions and their context (one the editor can make only in part is disabled, with the reason), code lenses, document links, folds, smart select, inlay hints, a refused rename's reason |

Three things a conversion cannot make without the host's Monaco, and how
`convert.ts` does without it:

* **Monaco's enums** are written out as numbers, in tables typed as the
  installed Monaco's own enums, so a Monaco upgrade that renumbers, adds or
  removes a member fails `npm run check` (and `tests/convert.test.mjs`
  proves that the check fires).
* **A server's command** runs through a Monaco command the host registers,
  so code actions and code lenses take the host's `CommandOf`.
* **A document's model** is the host's to name: a conversion that meets a
  server's URI asks the host's `UriOf`, and a place in a document it
  answers null for is left out, or, in a workspace edit, named in
  `unsupported` rather than dropped. Light's app answers with
  `monaco.Uri.parse`; a host with a model per snippet answers from its
  session's map (step M7). Which document links are worth showing is the
  host's too, for the same reason: Light's app leaves out a `file:` link
  to a file it has no model for.

| `internals.ts` | the one adapter over Monaco's internals, the things a host needs that Monaco has no public API for: replacing editor services (file labels, notifications, the bulk edit service, dialogs), the inline message, the quick pick, the references peek's tree, commands, undo steps across files, and the built-in themes' rules |

Its tests are `../tests/convert.test.mjs`, run with the other modules'.

## Monaco's internals

A host makes the adapter with `monacoInternals(modules)`, passing the
exports `INTERNALS` lists, imported by name from its own Monaco, under
`INTERNALS`'s keys (Light's app does it in
`app/src/lib/monaco-internals.ts`).
That keeps H1: the adapter never imports Monaco, so a host never ends up
with a second copy of Monaco's services. `INTERNALS` lists every internal
the adapter relies on, as data: its module under `monaco-editor/esm/vs/`,
the export, the members called, and why it is needed. What a host matches
in the page rather than imports is data too: `REFERENCES_PEEK` names the
classes of the references peek's tree (`REFERENCES_TREE_SELECTOR`) and the
command that goes to the focused reference, and `executeCommand` rejects,
for the host to report, when Monaco has no such command.

* **Checked when made.** `monacoInternals` throws `MonacoInternalsError`
  naming every module or export that is missing or is not what it was. A
  service's own methods are checked the first time it is used, because
  asking Monaco for a service creates it.
* **Nothing is ignored without a word.** Monaco takes replacement services
  once, before its services start, and ignores a late one or an unknown id
  silently; `startServices` checks that each replacement is now the
  service, and throws, naming it, when it is not.
* **The upgrade canary.** `../tests/internals.test.mjs` reads the installed
  monaco-editor's sources for every entry of `INTERNALS` and fails, naming
  the entry, when one has moved, stopped being exported, become another
  service, or lost a member; and for `REFERENCES_PEEK`, when the peek's
  classes are no longer the ones Monaco gives it or the command is no
  longer registered. It also fails on any version but
  `CHECKED_WITH`, since an internal can keep its name and change what it
  does: a person reads each entry's `why` against the new source, then
  changes `CHECKED_WITH`.

The editor features a host imports for their side effects
(`monaco-editor/editor/contrib/...`) are internal paths too; one that moves
fails the host's build by name, so they are not listed here.

## Allowed imports

Files of this module, `@yukibana/runtime` and `@yukibana/protocol`, by
relative paths ending in `.ts` or by the package name, and `import type`
from `monaco-editor`: a value import would bundle a second editor. Never
Svelte, dockview or `$app`.
