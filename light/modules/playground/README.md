# @yukibana/playground

One call from a language package and some files to a working playground
in the host's Monaco (`@yukibana/playground`) or CodeMirror 6
(`@yukibana/playground/codemirror`, below): the language server answering in the editor, the
files in one project with hidden files beside them, and Run through the
language's runner. For a host that wants a concrete thing (my C++ against
my library, its errors as I type, Run) rather than the parts, which it can
still reach: `editor`, `project`, `instance`.

```ts
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { LANGUAGES } from '@yukibana/lang-cpp';
import { createPlayground } from '@yukibana/playground';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const playground = createPlayground({
	monaco,
	element: document.getElementById('editor')!,
	language: LANGUAGES.cpp,
	files: { 'main.cpp': mainText },
	hidden: { 'lib/include/geometry.h': header, 'lib/src/geometry.cpp': source, 'compile_flags.txt': '-std=c++20\n-Ilib/include\n' },
});
runButton.onclick = () => playground.run({ output: (text) => output.append(text) });
```

`../../examples/cpp-library` is that page, whole.

## What it puts together

| Part | From |
|---|---|
| a Monaco model per file, `files` editable and `hidden` read-only in the playground's editor (Monaco's peek view follows the editor's options, so a hidden file peeked from a shown one can still be edited there), the entry shown, and an editor opener so go to definition into another file switches to it (standalone Monaco does nothing there) | the host's Monaco, passed in |
| the language's server, `server.js` of its pack in a worker, bound to the models | `LanguageSession` (runtime), `MonacoBinding` with no internals (monaco) |
| an instance with the language and its package's providers, over a page host whose runner pool and explorers are made on first use | `createInstance` (core), `packLanguage`, `pageExplorers`, `run` (std) |
| `run`, `input`, `stop`, and the run's and the server's states in words | `describeRun`, `describeServer` |

The language's body is the playground's own (its files, no build
properties, `serverSettings` as given): running never reads a language's
body, so the package's samples are never loaded.

## The host's part

* **Monaco**, imported whole (`import * as monaco from 'monaco-editor'`),
  so its editor features (hover, suggest, peek) are there to show the
  server's answers; this module only takes it (H1).
* **`MonacoEnvironment`**, the editor worker: the host's alone (H1).
* **A language Monaco has no grammar for** (Haskell, Zig) is registered
  with Monaco by the host first, through its language package's `/monaco`
  entry; an entry file Monaco has no language for is refused with a
  `RangeError`. Monaco imported whole also brings its own TypeScript and
  JavaScript service, which answers next to a JavaScript pack's server.
* **The packs**, served on the page's origin at `packs/` beside the page
  (or `options.packs`, ending in `/`), the page cross-origin isolated for
  a program that reads input.

## Contract

* Nothing on import (`../tests/imports.test.mjs`); `createPlayground`
  makes everything and `dispose` takes it all back.
* It names no language (`../boundaries.test.mjs`): the language is the
  package the host passes.
* One playground per Monaco at a time (the CodeMirror entry has no such
  limit): every playground's files are under
  one workspace folder, which the language servers are told, and a
  binding's providers answer for its language ids alone. A second one is
  refused with a `RangeError` before anything is made; dispose the first.
* A run resolves exactly once, with how it ended: a final state,
  `refused`, or `cancelled` when a newer run replaced it or the playground
  was disposed.
* Without Monaco's internals the binding does two things less
  (`MonacoBindingOptions.internals`): a server's own workspace edit is
  applied a file at a time, and Go to Symbol in Workspace is not offered.
  Show Call Hierarchy is not offered either: a playground has no view for
  it.

## In CodeMirror, any number per page

`@yukibana/playground/codemirror` is the same playground in the host's
CodeMirror 6, over `@yukibana/codemirror`:

```ts
import * as state from '@codemirror/state';
import * as view from '@codemirror/view';
import * as lint from '@codemirror/lint';
import * as autocomplete from '@codemirror/autocomplete';
import * as language from '@codemirror/language';
import * as highlight from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { LANGUAGES } from '@yukibana/lang-cpp';
import { playgroundTheme } from '@yukibana/codemirror';
import { createPlayground } from '@yukibana/playground/codemirror';

const cm = { state, view, lint, autocomplete };
const syntax = { language, highlight };
const playground = createPlayground({
	cm,
	syntax,
	element,
	extensions: () => [basicSetup, playgroundTheme(cm, syntax, { dark: false }), cpp()],
	language: LANGUAGES.cpp,
	files: { 'main.cpp': mainText },
});
```

`../../examples/codemirror-playgrounds` is a page of three.

* **Any number per page.** Each playground is a project of its own (a
  state per file), a server of its own and a view; the server's features
  are extensions of that project's states (`../codemirror/README.md`), so
  two playgrounds never answer for each other. What that costs: every
  playground runs one server worker, so a page of ten C++ snippets runs
  ten clangd, each with its memory. A page with many snippets that need no
  server can leave the language session out by using
  `@yukibana/codemirror`'s project alone.
* **The host's part** is CodeMirror, passed in as its four packages, and
  `extensions(path)`: the language mode, `basicSetup` or the parts it
  wants, a theme. The playground adds the server's features and makes
  hidden files read-only in their states, so in every view. `syntax`
  (`@codemirror/language` and `@lezer/highlight`) is optional: with it, a
  hover's code blocks are coloured as the editor colours its own text;
  without it they are plain. `playgroundTheme` is Monaco's look (its
  light and dark palettes, font, gutter, tooltips and squiggles) for a page
  that wants its playgrounds to look like Light's.
* **Tabs are the page's.** The playground shows one file at a time;
  `show(path)` changes it, and `shownChanged(path, hidden)` says when it
  changed, F12 into a header included, so a page's tab bar follows.
* **What the editor offers** is `CodeMirrorBinding`'s: diagnostics,
  completion, hover, F12 go to definition (into a hidden file too, shown in
  the same view), F2 rename and Shift-Alt-F formatting. Signature help
  and code actions are not there yet.
* **Tab is the host's.** CodeMirror leaves `indentWithTab` out of
  `basicSetup` so a keyboard can always leave an editor; a page that wants
  Monaco's Tab adds `keymap.of([indentWithTab])` from
  `@codemirror/commands` to `extensions` (the example does), and Escape
  then Tab still moves the focus on.
* The Monaco entry and this one share everything that is not the editor
  (`page.ts`): the checks of the files, the page host, the session, why a
  server did not start, and Run.
