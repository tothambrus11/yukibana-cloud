# @yukibana/editors

Editors other than Monaco, each an entry point of its own, each the core's
`EditorPort` of its kind over the document it shows. Step 8 of
`../DESIGN.md` (the second host, `../../examples/two-up`).

| Entry | What |
|---|---|
| `@yukibana/editors/textarea` (`textarea.ts`) | `textareaEditor(element, path, hidden)`: a `<textarea>` as an `EditorPort<'textarea'>` (its `native` is the element; the caret is its one capability) and the one-document `Project` it edits, with hidden files beside it; `positionAt` and `offsetAt`, a line and column of a text and back |

## Contract

* **A kind of its own.** Each editor adds its kind to the core's
  `EditorKinds` (`textarea: { native: HTMLTextAreaElement }`), so a check
  of a port's `kind` narrows its `native`, and a textarea's is never taken
  for a Monaco editor.
* **No language session yet.** A textarea has no completions, diagnostics,
  decorations or breakpoints (decision D10); a host runs its project
  through an instance as it would any other.
* **Nothing on import.** An editor listens to its element only once made,
  and stops when disposed (`../tests/imports.test.mjs`).

It may import core. Its tests are in `../tests/editors.test.mjs`.
