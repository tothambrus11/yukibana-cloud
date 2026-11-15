# @yukibana/codemirror

A language session's results in the host's CodeMirror 6: a project of a
few files as one `EditorState` each, a language server kept in sync with
them, and its answers shown in that project's editors and no other.

```ts
import * as state from '@codemirror/state';
import * as view from '@codemirror/view';
import * as lint from '@codemirror/lint';
import * as autocomplete from '@codemirror/autocomplete';
import { basicSetup } from 'codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { CodeMirrorBinding, codeMirrorProject } from '@yukibana/codemirror';
import { pathOf } from '@yukibana/core';

const project = codeMirrorProject({
	cm: { state, view, lint, autocomplete },
	files: { 'main.cpp': main, 'lib.h': header },
	extensions: () => [basicSetup, cpp()],
	readOnly: (path) => path === 'lib.h',
});
const shown = project.view(element, pathOf('main.cpp'));
const binding = new CodeMirrorBinding({
	session, // a LanguageSession of @yukibana/runtime
	project,
	documentUri: (path) => root.uriOf(path),
	languageId: () => 'cpp',
	syntax: null, // or { language, highlight }: a hover's code coloured as the editor's
	events: { log: console.warn, open: (path, selection) => shown.show(path, selection) },
});
await binding.start();
```

`@yukibana/playground/codemirror` is that and Run in one call, and
`../../examples/codemirror-playgrounds` a page of three of them.

| File | What |
|---|---|
| `codemirror.ts` | `CodeMirror`: the host's `@codemirror/state`, `view`, `lint` and `autocomplete`, as namespaces |
| `project.ts` | `codeMirrorProject`: a state per file, the views that show them (`view`, then `show` and `dispose` on what it returns), `update`, the edits as transactions (`onEdit`), and the core's `Project` over them |
| `bind.ts` | `CodeMirrorBinding`: the session's client: files opened, edits sent as ranges by version, diagnostics through `@codemirror/lint`, completion (snippets and additional edits included), hover, F12 go to definition, F2 rename, Shift-Alt-F formatting, a server's workspace edit |
| `markdown.ts` | `markupBlocks`: a server's Markdown (a hover, a completion's documentation) read into data, a safe subset: headings, rules, fenced code, paragraphs, lists, code spans, strong, emphasis, links |
| `render.ts` | `renderMarkup`: those blocks as DOM, text through text nodes only and links followed for http(s) only; `stateHighlighter`: a code block coloured as the editor colours its own text |
| `convert.ts` | positions and offsets, a transaction's changes as LSP's, diagnostics, completions, hover text as blocks, definition answers, workspace edits |
| `theme.ts` | `playgroundTheme(cm, { language, highlight }, 'light' | 'dark')`: Monaco's `vs` or `vs-dark` as a CodeMirror theme and highlight style, the binding's widgets (hover, completion list, problems) included, so a CodeMirror snippet looks like the Monaco playground; the host adds it to its extensions |

## Why it can have many editors on a page

Monaco keeps language features in one registry per page and one model
per URI, so its playgrounds each give their models a URI scheme of their
own and register their server's features for it (`../monaco/README.md`).
CodeMirror has nothing page-wide to scope: it keeps an editor's features
in its state's extensions. Every state of a project
has a compartment of the project's, which a binding fills with its
server's features when the server is ready and empties when it closes, so
a server's completions, hovers and keys exist in the states of the one
project it serves. Two projects on a page are two sets of states and never
meet.

## Contract

* **The host's CodeMirror is passed in** and only its types are imported
  (`../boundaries.test.mjs`): a second copy of `@codemirror/state` in a
  page makes extensions the host's copy silently ignores.
* **One state per file, one view per file at a time.** A view's
  transactions are the file's; `show` swaps a view to another file and
  keeps the first's state, undo history included. A view is destroyed
  through `dispose`, never by the host's own `destroy`.
* **Edits reach the server as ranges.** Each transaction that changes a
  document is one `didChange` of its changes, counted in the state it
  started from, last first; the file's version is one more per such
  transaction.
* **Read-only is the state's.** `EditorState.readOnly` stops typing in a
  hidden file in every view; completion is not offered there, and
  formatting and rename are refused, a rename too when it would change a
  read-only file elsewhere (a hidden header's declaration). An edit the
  server asks for itself (`workspace/applyEdit`) is still made.
* **A refused rename says why, in the editor.** F2 opens a box over the
  name (the server's `prepareRename` range, else the word); Enter asks
  for the rename and makes it, one undo step per file, or puts the
  reason in that box: the server's error, a read-only file, a file not of
  the project. `renameTarget` and `rename` are that logic without the
  box, for a host with its own UI.
* **Text from a server is text.** A hover's or a completion's
  documentation is drawn as paragraphs and code blocks through
  `textContent`, never as HTML (`markdown.ts` parses a safe subset into
  data, `render.ts` draws it).
* **Not yet offered:** signature help, code actions, references,
  document symbols, semantic tokens and the rest of what `MonacoBinding`
  has. The client capabilities say so, so no server sends what nothing
  would show.
* **The look is the host's choice.** `playgroundTheme` is an extension a
  host adds; it takes `@codemirror/language` and `@lezer/highlight` as it
  takes the rest of CodeMirror, injected (optional peers: a host that
  does not use it needs neither).
* **Nothing on import** (`../tests/imports.test.mjs`).

It may import core, runtime and protocol, and `import type` from the
`@codemirror/*` packages its package.json names as peers. Its tests are
`../tests/codemirror.test.mjs`, against the app's installed CodeMirror
(installed there for the type-check and the tests alone), and the
example's browser test.
