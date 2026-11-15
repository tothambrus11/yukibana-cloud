# C++ snippets in CodeMirror

Three C++ playgrounds on one page, in CodeMirror 6, each with a language
server of its own answering in its own editor alone: errors as you type,
hover, completion, F12 into a header that belongs to one snippet, F2 to
rename, Shift+Alt+F to format, Tab to indent (Escape then Tab leaves the
editor), and Run. Each is one `createPlayground` call of
`@yukibana/playground/codemirror`; the page is `src/main.ts`.

```text
cpp/hello.cpp      the first snippet
cpp/greet.cpp      the second, which includes greet.h
cpp/greet.h        a hidden file of the second snippet alone: read-only, shown by F12
cpp/squares.cpp    the third
src/main.ts        the page: one playground per section of index.html, in a Monaco-like frame (file tabs, server status, Run, output)
tests/fake-server.js  a stand-in language server for test.mjs where the C++ pack is not installed
vite.config.ts     serving: the packs at /packs/, the page cross-origin isolated
```

## Why several on one page work here and not in Monaco

Monaco's language features are registered once per page and chosen by
language id, so a second C++ editor with a second server would have both
servers answer in both editors: `@yukibana/playground` allows one
playground per Monaco. CodeMirror keeps an editor's features in its
state, and `@yukibana/codemirror` puts a server's completion, hover and
keys in the states of the one playground it serves
(`../../modules/codemirror/README.md`). The price is a server per
playground: three snippets run three clangd workers.

## Running it

```sh
(cd ../.. && pnpm install --filter ./setup)   # the setup tool's own dependencies, once
node ../../setup/cli.mjs cpp --latest         # the C++ pack, in light/app/static/packs (once)
pnpm install --filter .
pnpm run dev                                  # http://localhost:5173
```

`pnpm run build && pnpm run test:e2e` drives the built page in Chromium
(`CHROMIUM` names a browser, a Chrome or Edge executable will do): the
three servers start; a problem typed into one snippet is marked where it
is, in that snippet only (two changes in one transaction, so the server
must rebuild its text from both ranges); completion offers what the
snippet's server knows and nothing of another's; a hover is that
snippet's server's; F12 opens the snippet's header, read-only; F2
renames a local name and says why it will not rename one declared in the
read-only header; Tab indents and keeps the focus; disposing
one playground leaves the others answering; nothing logs an error. With
the C++ pack installed these run against clangd and Run is checked too;
without it (or with `FAKE_SERVER=1`) the server is `tests/fake-server.js`,
which answers from its own documents under a name of its own, and
Shift+Alt+F is checked instead of Run. CI runs the latter.
