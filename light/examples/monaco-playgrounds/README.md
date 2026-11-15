# C++ snippets in Monaco

Three C++ playgrounds on one page, in the one Monaco the page imports,
each with a language server of its own answering in its own editor alone:
errors as you type, hover, completion, F12 into a header that belongs to
one snippet, F2 to rename, Shift+Alt+F to format, and Run. Each is one
`createPlayground` call of `@yukibana/playground`; the page is
`src/main.ts`. `../codemirror-playgrounds` is the same page in
CodeMirror 6, and its snippets are copied here.

```text
cpp/hello.cpp      the first snippet
cpp/greet.cpp      the second, which includes greet.h
cpp/greet.h        a hidden file of the second snippet alone: read-only, shown by F12
cpp/squares.cpp    the third
src/main.ts        the page: one playground per section of index.html, in a frame (the shown file's name, server status, Run, output)
vite.config.ts     serving: the packs at /packs/, the page cross-origin isolated
```

## Why several in one Monaco work

Monaco keeps two things once per page: one model per URI, and one
registry of language features, chosen by language id. Three snippets
each have a `main.cpp`, and three C++ servers would each be asked about
all three. So every playground makes its models under a URI scheme of
its own (`playground-<uuid>:/main.cpp`) and registers its server's
features for that scheme, while each server still sees
`file:///workspace/main.cpp`, as the packs expect: the binding
translates (`../../modules/monaco/README.md`, "Several bindings in one
Monaco"). Nothing is shared between the playgrounds, and none knows of
another. What is Monaco's own stays the page's: `src/main.ts` sets the
editor worker and the theme, once, for all three.

The price is the CodeMirror page's: a server per playground, so three
snippets run three clangd workers.

## Running it

```sh
(cd ../.. && pnpm install --filter ./setup)   # the setup tool's own dependencies, once
node ../../setup/cli.mjs cpp --latest         # the C++ pack, in light/app/static/packs (once)
pnpm install --filter .
pnpm run dev                                  # http://localhost:5173
```

`pnpm run build && pnpm run test:e2e` drives the built page in Chromium
(`CHROMIUM` names a browser, a Chrome or Edge executable will do): the
three servers start; the three `main.cpp` are three models; a problem
typed into one snippet is marked in that snippet only; completion offers
what the snippet's server knows and nothing of another's; a hover is
that snippet's server's, once; F12 opens the snippet's header,
read-only; F2 renames `main` in one snippet and in no other; disposing
one playground takes its models and leaves the others answering;
nothing logs an error. With the C++ pack installed these run against
clangd and Run is checked too; without it (or with `FAKE_SERVER=1`) the
server is the CodeMirror example's stand-in
(`../codemirror-playgrounds/tests/fake-server.js`), which answers from
its own documents under a name of its own, and Format Document is
checked instead of Run, in the first playground made and the last:
Monaco asks one formatter per model, so this is the check that fails
when the features are not scoped. CI runs the latter.
