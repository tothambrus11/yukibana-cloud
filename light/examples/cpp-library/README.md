# C++ with my library

C++ in Monaco against a library of one's own: the language server's
answers in the editor (errors, hover with the library's comments,
completion of its members, go to its definitions), and Run compiling
`main.cpp` with the library, linking them and running the program. The
page is `src/main.ts`, one `createPlayground` call of
`@yukibana/playground` and a Run button.

```text
cpp/main.cpp                  what the reader edits
cpp/lib/include/geometry.h    the library's header: an include, read-only in the editor
cpp/lib/src/geometry.cpp      its source: compiled and linked with main.cpp
src/main.ts                   the page
vite.config.ts                serving: the packs at /packs/, the page cross-origin isolated
```

## How the library gets in

Everything is a file of one project:

```ts
files:  { 'main.cpp': main },
hidden: {
	'lib/include/geometry.h': header,
	'lib/src/geometry.cpp': source,
	'compile_flags.txt': '-std=c++20\n-Ilib/include\n',
},
```

* **The include.** `compile_flags.txt` is read by clangd (the language
  server) and by the C++ pack's compiler alike, so `-Ilib/include` makes
  `#include "geometry.h"` resolve in both, and `-std=c++20` is the same
  standard for both.
* **The link.** Run compiles every `.c` and `.cpp` file of the project
  (outside `tests/`) and links them into one program, so the library's
  source is in the build because it is in the project.
* **Read-only.** `hidden` files are in the project but not offered for
  editing: go to definition into the library shows them read-only.

A library from elsewhere (a fetched archive, a generated header) is the
same: its files as strings under `hidden`.

## Running it

```sh
node ../../setup/cli.mjs cpp --latest   # the C++ pack, in light/app/static/packs (once)
npm install
npm run dev                             # http://localhost:5173
```

`npm run build && npm run test:e2e` drives the built page in Chromium
(`CHROMIUM` names a browser, a Chrome or Edge executable will do): the
server starts; hovering a library function shows its header comment;
completion offers the class's members; go to definition opens the
library's source and go to declaration its header, both read-only; Run
prints the library's results; an error typed into `main.cpp` is marked.
