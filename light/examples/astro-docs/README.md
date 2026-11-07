# Snowflower Cookbook: an Astro docs site with Yukibana playgrounds

A static documentation site, built by Astro 5 from MDX, whose code samples
are programs you can run. The page is plain HTML and reads fine with
JavaScript off; each sample is an island hydrated with `client:visible`, so
nothing of it loads until you scroll to it, and its compiler (a Yukibana
Light *pack*) is fetched only when you press Run.

It shows what a docs or cookbook site needs from Yukibana:

| Page | Use case |
|---|---|
| `/cookbook/word-frequency` | **The same recipe in five languages.** Word frequency over standard input in JavaScript, C++, Swift, Rust and Python, in tabs. The tabs are radio buttons and CSS, so a tab never opened is `display: none`, never "visible", and never hydrates. The input is editable under the code. |
| `/web/live-canvas` | **A web page with a live preview.** A TypeScript page drawing on a canvas (`lang="web"`), and a p5.js sketch (`lang="p5"`), built by std's `preview` and rebuilt 300 ms after you stop typing. |
| `/python/csv-table` | **Data from the page.** The page ships a CSV file as a file of the playground's project. Python reads it and prints a table, and a second snippet continues it with a chart. |
| `/chaining` | **Snippet chaining.** Each snippet names the earlier ones it continues and runs after them in one program. The last one is a `node:test` file run by **Test**. |
| `/` | An overview with one TypeScript playground. |

```sh
npm ci
npm run dev                  # http://localhost:4321, packs served under /packs/
npm run check                # astro check (strict TS in .astro/.tsx/.ts), tsc, tsc for the Node files
npm run build                # static site in dist/
npm run preview              # links dist/packs to the packs, then astro preview
npm run test:e2e             # builds, astro preview, every playground in Chromium
```

The packs are Light's installed ones (`light/app/static/packs`). Set
`PACKS=/path/to/packs` to use others (from a git worktree, for example).
A playground whose pack is not installed is skipped by the test with a
message. Swift is the usual one: its snippet is built and type-checked as
part of the page, but it is run only where `packs/swift` has been built.

## The component

```mdx
import Playground from '../components/Playground.astro';
import code from '../../snippets/csv/table.py?raw';

<Playground lang="python" code={code} files={{ 'snowfall.csv': csv }} id="table" />
<Playground lang="python" code={bars} continues={['table']} />
<Playground lang="rust" code={rust} stdin={input} />
<Playground lang="javascript" path="words.test.js" code={tests} test />
<Playground lang="web" path="main.ts" code={ts} files={{ 'index.html': html }} preview />
```

| Prop | Meaning |
|---|---|
| `lang` | `javascript`, `typescript`, `cpp`, `rust`, `swift`, `python`, `web`, `p5` (`src/lib/langs.ts`). An unknown name fails the build and names it. |
| `code` | The program: the document the reader may edit. |
| `run` / `test` / `preview` | Which actions to offer. If none is given, it is `run`. `web` and `p5` always preview. |
| `stdin` | What the program reads, line by line, then end of input. It is shown (and editable once hydrated) under the code. |
| `files` | Files beside the code, by project path, shown under *Beside it*. |
| `path` | The code's project path, if it is not the language's entry (`main.py`, `src/main.rs`). |
| `id`, `continues` | Chaining: a later playground runs the code of the ids it continues first. |
| `title` | A caption. |

`Playground.astro` renders the highlighted code with Shiki (light and dark
themes) and passes it as the children of `PlaygroundIsland.tsx`, a Preact
island hydrated with `client:visible`. Before hydration the island is that
code and the input, with no buttons. Once hydrated it adds Edit, Run, Test
or Show page, Stop, a status line and the output. The editor is
`@yukibana/editors/textarea` (Ctrl-Enter runs, Tab indents), with no
Monaco, so a page stays light.

### Snippet chaining

The packages have no prelude (a run is a project's files and an entry,
std's `RunInput`), so the island makes one in `src/lib/prelude.ts`. Each
continued snippet's text goes in under a comment naming it, then the
playground's own code, in one file. A hydrated snippet contributes the
reader's edits. One never hydrated contributes the text the page was built
with, which `Playground.astro` writes into a `<template data-snippet>`. The
cost is line numbers: an error is reported at its line in the joined file,
and the earlier snippets' output comes first, as a notebook re-run from the
top would show it.

## What of Yukibana it uses

* `@yukibana/core`: one `createInstance` per language on the page, made
  when its first playground hydrates (`src/lib/languages.ts`), with
  `availability` deciding whether Run is enabled, `perform` running it,
  `snapshotOf`, and `slot` for one live-page build at a time.
* `@yukibana/std`: `packLanguage`, the `run`, `test` and `preview` tokens,
  and `PackHost`.
* `@yukibana/runtime`: one `RunnerPool` per page (`src/lib/host.ts`), shared
  by every island because they import the same module. A `RunHandle`'s
  `input`/`endInput` gives `stdin`, and `PackLocator.unpinned` points at
  `/packs/`.
* `@yukibana/protocol`: `Requires` (the runners' needs) and `isFromPage`
  (the live page's console).
* `@yukibana/editors/textarea`: the editor.
* `@yukibana/lang-javascript`, `-cpp`, `-rust`, `-swift`, `-python`: each
  imported with `import()` only when a playground of it hydrates. Their
  `/body` entries are never asked for.

No package was changed for this example.

## Hosting the packs, and the headers

The packs are static files and are never bundled. The runners need them
on the page's own origin (`sameOriginPacks`), under `/packs/<pack>/…`, or
under the path `PUBLIC_YUKIBANA_PACKS` names at build time. A real site
copies the packs it uses (only those: Rust's alone is 2.3 GB, most of it
fetched only on demand) into its static hosting beside `dist/`, or routes
`/packs/` to a bucket on the same origin.

Every response must carry the cross-origin isolation headers, so that a
program can read `stdin` (a `SharedArrayBuffer`):

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

`astro.config.ts` sends them in `astro dev` and `astro preview`
(`server.headers`, from `packs.ts`). On Netlify or Cloudflare Pages they go
in a `_headers` file. Without them everything runs, but a program reads end
of input at once, and the playground says so. The live page is an
`about:srcdoc` iframe sandboxed without `allow-same-origin`. It inherits
COEP and fetches nothing.

In dev, `/packs/` is served by a middleware (`packs.ts` `servePacks`,
installed through the `astro:server:setup` hook). `astro preview` takes no
plugin of the site's, so `npm run preview` and `test.mjs` make `dist/packs`
a symbolic link to the packs first (`node packs.ts link`). Neither the
packs nor the link are committed (`dist/` is ignored); do not deploy the
link.

## Bundle

Measured by `test.mjs` in Chromium, as the gzip of every script the page
fetched, packs excluded:

| When | Scripts | gzip |
|---|---|---|
| A page with no playground in view (the cookbook in a 260 px window) | none: Astro's island loader is inline | 0 KiB |
| The first playground in view (any page) | the island (16.3 KiB: Preact component, Yukibana core, std, runtime, textarea editor), Preact (4.9 + 1.2 KiB hooks), Astro's Preact renderer (0.7 KiB), and the language's package index (0.5 to 0.7 KiB) | 23.8 KiB |
| Each further language on the page | its package index (`lang-cpp` 1.8 KiB, `lang-rust`, `lang-python`, …) | about 1 to 2 KiB |
| Run | the pack's runner and compiler (clang, rustc, CPython, TypeScript), from `/packs/`, once per page | the packs' own sizes |

The cookbook's hidden tabs load nothing, not even their language package:
the test checks that `lang-cpp`, `lang-rust`, `lang-swift` and
`lang-python` are not fetched before their tab is opened, and that nothing
is fetched from `/packs/` before a Run. The languages' `/body` entries
(sample projects) are built as chunks and never fetched. No Monaco is
used.

## Files

```text
astro.config.ts               MDX, Preact, the headers, the @yukibana/source condition, /packs/ in dev
packs.ts                      where the packs are; dev middleware; the preview link (Node)
src/components/Playground.astro   the MDX component: static code, the island, files beside it
src/components/PlaygroundIsland.tsx   the island: edit, run, test, live page, output
src/components/Tabs.astro, Tab.astro  script-free tabs
src/lib/langs.ts              the playground languages as plain data
src/lib/languages.ts          a language's package, loaded on first use, and its instance
src/lib/host.ts               the page's one host: pool, packs, needs
src/lib/live-page.ts          a web project's live preview in a sandboxed frame
src/lib/prelude.ts            snippet chaining
src/lib/status.ts             the status line, from a run's state
src/pages/**/*.mdx            the site
snippets/                     the programs the pages show, as real files (imported with ?raw)
test.mjs                      the end-to-end check
```
