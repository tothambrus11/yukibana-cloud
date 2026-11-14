# C++ with my library, in SvelteKit

`../cpp-library` as a SvelteKit 3 app: C++ in Monaco against a library of
one's own, the language server's answers in the editor, and Run compiling
`main.cpp` with the library and linking them. The playground is a
component, `<CppPlayground files={…} hidden={…} />`, over one
`createPlayground` call of `@yukibana/playground`.

```text
src/routes/+page.svelte        the page: the component, given main.cpp and the library
src/lib/CppPlayground.svelte   the component: editor, Run, Stop, status and output
src/lib/playground.ts          its browser half: Monaco, its worker, createPlayground
src/cpp/                       main.cpp and the geometry library (lib/include, lib/src)
vite.config.ts                 SvelteKit (adapter-static) and serving: /packs/, cross-origin isolation
```

## What SvelteKit changes

Only where the playground is made. A SvelteKit page is rendered in Node
too (here prerendered to `build/`), where Monaco, which needs a DOM, and a
worker cannot load. So the component's markup renders everywhere, and its
`onMount` imports `src/lib/playground.ts` (Monaco, its worker and
`createPlayground`) and makes the playground in the browser, disposing it
when the component goes. The prerendered HTML has the playground's markup
and no Monaco.

The library gets in as in `../cpp-library`: its files under `hidden`, and
`compile_flags.txt`'s `-Ilib/include`, which clangd and the compiler both
read; Run compiles and links every `.cpp` of the project.

## Running it

```sh
node ../../setup/cli.mjs cpp --latest   # the C++ pack, in light/app/static/packs (once)
npm install
npm run dev                             # http://localhost:5173
```

`npm run build && npm run test:e2e` checks the prerendered page, then
drives the built site in Chromium (`CHROMIUM` names a browser, a Chrome or
Edge executable will do) through `../cpp-library`'s checks: hover with the
library's comment, completion of its members, go to its definition and
declaration (read-only), Run printing its results, an error marked.
