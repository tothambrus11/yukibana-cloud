# Settled design: the embeddable Light core, v1

The reference for rewriting Light's app onto the shared modules: what was
decided after the review of the prototypes, the core's concepts, the
packages, where each of the app's files goes, and the steps in order. Paths
of the app's files are under `light/app/src/lib`; of the modules, under
`light/modules`. Sections 8 to 18 record how steps 1 to 9 were built, and
what the reviews of them changed, and where they depart from the sketches
here; the code and its `/** */`
contracts are the authority where the two differ.

This design is grounded in today's code: `languages.ts` (the `Language` booleans), `workspace.svelte.ts:382-425` (start/debug branches), `run.svelte.ts` (RunnerPool + RunHandle), `explorer.svelte.ts:294` (its own `explorer.js` worker), `preview.ts` (busy/again coalescing), `packs.ts` (`packOf`/`packsOf`/`runnerSourceOf`), `build-settings.ts`, `cpp-targets.ts` (the target is a line of `compile_flags.txt`), `modules/runtime/run-session.ts` (`RunEvent`, `RunState`), `modules/protocol/runner.ts` (`RunMode`, `RunMessage`), and `modules/boundaries.test.mjs` (the hand-written `ALLOWED` table).

Governing rule: the rewrite moves decisions out of the app into providers that send today's pack messages unchanged. No pack contract changes. No new execution architecture.

One exception, agreed with Ambrus after the rewrite's steps: a test run's optional `tests` and `breakOnFailure` (packs/CONTRACT.md, "Tests (optional)"), additive fields a runner that does not know them ignores, offered only through std's `testCase` and `debugTestCase`, which a language provides only where its runner honours them. The messages of every other token are unchanged.

## 1. Decisions

| # | Decision | Reason (the review's concerns that moved it) |
|---|---|---|
| E1 | **No environments in the core.** Delete `Environment`, `Execute`, `Artifact`, `Placement` and `Execution` as nouns. Environments stay inside packs (`runner.js` plus `uses: ['linux']`). Linux run options stay pack-owned `RunnerOptions`. A Compile/Execute split is added later, per pack, only when a page-side artifact consumer exists (web target, grader). | Compile and run happen in one runner worker today. Six reviews (Simplicity, Extensibility, Efficiency, Flexibility, Maintainability, Generalizability) showed the split means a re-architecture, extra hops and copied artifacts. Bundle showed env-c builds as one chunk anyway. |
| E2 | **Not a core decision.** Features, toggles, `featureElement`, `LoadPolicy` attributes and regions belong to a future `elements` kit and are out of the rewrite. When built: a typed array model, child elements as one way in, no attribute toggles, no registration at module top level, `/* @__PURE__ */` on factories. | The Svelte app needs none of it (Simplicity, Generalizability). Bundle showed F1's top-level registration cannot be shaken out. |
| E3 | **One mechanism: branded tokens plus providers keyed by (subject, token[, key]).** The Registry and the task Engine merge into it. There is no Query/Action split and no memo table in v1. Supersession is a separate `Slot` primitive (`latest`, at most one in flight). The engine's abort fixes go into `Slot`. | Simplicity: the two mechanisms are one idea built twice. Efficiency: the memo is unbounded and has abort bugs, and nothing in Light shares a compile. Type-safety: identity must be the object, not the id string. |
| E4 | **Run options belong to the language's property model**, stored as project metadata (`Project.runOptions`, unchanged on disk and in links). They are sent to the runner as `RunnerOptions` and never enter any cache key. | With no environment noun, the language owns them. cpp and rust already share them (`workspace.svelte.ts:404`). Flexibility and Efficiency asked for a storage binding and no key pollution. |
| E5 | **Not core.** The context protocol is internal to `elements` later. Svelte hosts pass the instance through Svelte context. Non-DOM hosts call `instance` directly. | Generalizability, Extensibility. |
| E6 | **Yes.** `runs`, `tests`, `mutates`, `debugs` and `preview` become providers of tokens, and `cannotRun` becomes an `unavailable` reason. "Mutates only with tests" is `mutate.requires = [test]`. `warmRunner` becomes a field of the run provider (`warm: 'after-language-server'`). Explore views become one `explore` provider per pack. Export build systems become a `many` token, late in the plan. All of these live in the language's own package as subpath entries, not in separate conformance packages. | Every review agreed, with conditions: availability over the project snapshot (Extensibility, Flexibility), cardinality `many` (Extensibility, Flexibility), and same-package conformances (Maintainability). |
| N1 | **Availability is a pure function of a `ProjectSnapshot`, not of the language alone.** Examples: Debug refused on Linux targets, Catch2/doctest refused on Linux, Miri changing Run, Intel syntax only on x86. | Extensibility, Flexibility, Type-safety: otherwise `commands()` would contradict what the runner refuses. |
| N2 | **Tokens declare cardinality: `'one'` (coherent, two providers throw at `createInstance`) or `'many'` (providers carry a `key`; a property or detector picks one).** | Extensibility (Catch2/GoogleTest, local vs remote), Flexibility (export build systems, CI services). |
| N3 | **Type facts come from values only.** No global `Conformances`, `Blankets` or `Register` merges. Tokens are branded and invariant, created only by `defineToken`. Subjects are a discriminated union. Runtime language strings become `LanguageKey` only through `instance.languageOf`. No type-level conformance closure. | Type-safety's attacks 1–4. Simplicity and Maintainability: one system, not three. Availability is runtime anyway (N1), so type-level facts would lie. |
| N4 | **Run, Test, Mutate, Debug and Preview are typed by today's runtime vocabulary.** Input builds a `RunMessage`. Output is today's `RunHandle`/`RunEvent`/`RunState`. The prototypes' `RunEvent`, `Artifact` and `Io` types are deleted. | Every review: the prototype unions drop `queued`, `trace`, `kernel`, `mark`, `test-report`, `debug`, `notice`, `problem` and `reusable`, which the terminal and examples/hylo consume. |
| N5 | **A platform-free `@yukibana/core`** (lib es2024 plus `protocol/platform.d.ts`, no DOM). `@yukibana/runtime` stays the browser host. A Node host is possible, not built. | Generalizability. Bundle: core ≈ 1.4 KB gzip. |
| N6 | **A `Project` port (multi-document, per-file versions) is a core noun. `EditorPort` is a view of one document.** | Flexibility, Generalizability: Light is a multi-file workspace with hidden config files and workspace edits. |
| N7 | **The host owns one `LanguageSession` per (project, language)**, a same-thread object over the `Connection`. Editor adapters bind to it by function call, with no per-editor `MessagePort`. Preview's ErrorCheck, call hierarchy and the Linker use the same session. | Efficiency, Flexibility: one LSP per server today (`lsp/client.ts`). |
| N8 | **Properties are typed lenses with a storage union `file` \| `meta`.** `file` lenses keep the rest of the file byte for byte and have an `unrecognised` state. `meta` lenses map onto today's `Project` fields with no schema change. | Every review. `cpp-targets.ts` says the file is the single source of truth. |
| N9 | **Providers load `eager` (a static import) or `lazy` (an `import()` thunk).** Light marks run, test, mutate, preview and the current language as eager, so first Run and offline behave as today. Embeds default to lazy. | Bundle, Efficiency: a serial chunk chain before the first Run would be a behaviour change. |
| N10 | **Workers are page-shared, state is per instance.** The page's `RunnerPool` (already page-scoped) and language servers are leased through a host value. There is no `packCache` Map; bytes stay in HTTP and Cache Storage. | Efficiency, Generalizability. |
| N11 | **Lockstep packaging.** One version and one tag (`light-modules-vX`) for every package under `light/modules`. `build.mjs PUBLISHED`, the app's `check` tsc list and `boundaries.test.mjs ALLOWED` are derived from directories and `package.json` dependencies. `core` is a peerDependency of everything else. | Maintainability: about 18 packages, not about 50, and no version matrix. |
| N12 | **A bundle gate before any extraction.** Commit Light's baseline (1,240,796 B gzip initial set). Extend `tests/unit/bundle.test.mjs`: Light's initial set must stay ≤ baseline + 1%, nothing may self-reference in `dynamicImports`, and the eager list must be in the initial set. The offline manifest must classify by graph, not by path prefix. | Bundle. |

### Decisions for steps 4 to 9

Taken after the review of steps 1 to 3, before step 4 was built. Sections 11 to 15 cite them by these ids; where a section records a departure, the section holds.

| # | Decision | Reason |
|---|---|---|
| D1 | **Language packages live in flat `light/modules/lang-<pack>/` directories**, each `@yukibana/lang-<pack>` (`lang-cpp` serves c and cpp; `lang-javascript` javascript, typescript, web, p5 and p5-global). Rules 3 and 4 become "never another `lang-*`". | `list.mjs` takes each direct child of `modules/` with a `package.json` as a package named after its directory, so every derived list (ALLOWED, PUBLISHED, typecheck, the Vite aliases, the tripwires) takes a new one unchanged. Nested `modules/languages/<pack>` breaks that; `packs/<pack>/` are toolchain build trees with their own CI and caches. |
| D2 | **Monaco stays eager in Light.** Only Haskell's and Zig's grammars go lazy, in step 6, behind their packages' `/monaco`. | Making Monaco lazy would move when the first editor appears, a behaviour change. |
| D3 | **Debugging tests is a second token**: `debug` and `debugTest`, both `DebugInput` → `DebugSession`. `debugTest` requires `[test, debug]`; only C++ provides it. | Availability reads the project, not the input (N1), so one token with a mode could not offer Debug for Swift while refusing Debug tests (its runner ignores `debug` when testing). |
| D4 | **Debug checks availability and builds its input at the click**, and performs at the debugger's `ready` with a frozen snapshot. | The run must be the project as it was when Debug was pressed. |
| D5 | **Snapshot-dependent availability (N1) lands in step 4**, as its own commit: Debug refused on Linux targets, Catch2 and doctest refused on Linux. | Sections 9 and 10 deferred it; Debug cannot be described without it. |
| D6 | **Preview's busy/again is one `Slot` whose job renders**; the provider owns only the page-building worker and its watchdog. The iframe and the CSS swap stay the app's. | The swap needs the app's iframe, so `update(changed)` was dropped. |
| D7 | **No blankets in steps 4 to 9.** Every provider is per language, made by a factory. | No in-repo user (section 6). |
| D8 | **Explore keeps the explorer worker**, one per pack, page-scoped in the host, leased by std's `explorerProvider`; a view's request settles as soon as its signal is aborted. | Every pack's explorer.js drops a superseded request's answer, so a job waiting for it would hang. |
| D9 | **`lsp/client.ts` splits into `runtime/language-session.ts` and `monaco/bind.ts`.** The session is fed edits by the binding's model listeners, as ranges by version; `Project.onChange` only says which files exist. Client capabilities come from the binding. Two commits: the halves behind a facade, then the call sites. | A project's change events do not say what changed inside a file, so feeding a session from them would resend whole files on every keystroke. |
| D10 | **Step 8's second host is a minimal two-up**; `ServerLeases` is deferred. | No consumer needs page-shared servers yet. |
| D11 | **`examples/hylo` moves to `std/run`** through a run provider over a host-built source (`PoolHost`, `runProviderFrom`); its page is unchanged. | Hylo's runner has no pack or locator. |
| D12 | **Export is `exportBuild` (`many`, keyed by build system) plus `exportTooling` (`one`)**, with per-key availability on the instance. | Build systems are alternatives a project picks one of; the tooling is one per language. |
| D13 | **Debug and the call hierarchy load on use (step 9)**: breakpoints split into a small eager store, the DAP session lazy. | The glyph margin reads breakpoints with the page. |
| D14 | **Timing of what sections 8 to 10 deferred**: the self-reference check and the graph-classified offline shell at the start of step 6; paths.ts into core and publishing core and std with step 6; Build settings rendered from the model outside steps 4 to 9. | Step 6 is the first step with lazy bodies; section 14 records what of this it did not do. |

## 2. The concept set (`@yukibana/core`)

The core has seven nouns: Token, Subject, Provider, Instance, Project/Snapshot, Property, Slot. Plus `EditorPort` (a type only) and `LanguageMeta`. Everything else lives in `std`, a language package or a host.

```ts
// brand.ts — the one cast lives here
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };
export type LanguageKey = Brand<string, 'LanguageKey'>;
export type Path = Brand<string, 'Path'>;          // made by pathOf (paths.ts moved from runtime, re-exported there)
export type Disposable = { dispose(): void };
```

**Token.** A typed, nominal capability. Its identity is the object. `id` (`'@yukibana/std#run'`) is used for messages and for the duplicate-id refusal only. The phantom type is invariant in I.
```ts
declare const phantom: unique symbol;
export type Cardinality = 'one' | 'many';
export interface Token<I, R, C extends Cardinality = Cardinality> {
  readonly id: `${string}#${string}`;
  readonly cardinality: C;
  readonly [phantom]: (input: I) => [I, R];
}
export function defineToken<I, R>(): <const Id extends `${string}#${string}`, const C extends Cardinality = 'one'>(id: Id, cardinality?: C) => Token<I, R, C>;
```
In code, `AnyToken` is `{ readonly id: string; readonly cardinality: Cardinality }`, so heterogeneous lists need no `any`. `/* @__PURE__ */` goes at every call site.

**Subject.** What a provider serves.
```ts
export type Subject =
  | { readonly kind: 'language'; readonly id: LanguageKey }
  | { readonly kind: 'editor'; readonly id: EditorKind };     // EditorKind = keyof EditorKinds
```

**Availability.** It replaces `runs: boolean` and `cannotRun?: string`.
```ts
export type Availability = { readonly kind: 'available' } | { readonly kind: 'unavailable'; readonly reason: string };
```

**Provider.** One implementation of a token for one subject. `requires` expresses conditional conformance: the provider exists only when every required token is available for the same subject. `available` is pure and cheap, and lives in the eager tier. Precondition: `available` reads only the snapshot.
```ts
export type Perform<I, R, H> = (input: I, cx: Context<H>) => R;
export type Body<I, R, H> =
  | { readonly kind: 'eager'; readonly perform: Perform<I, R, H> }
  | { readonly kind: 'lazy'; readonly load: () => Promise<Perform<I, R, H>> };   // the rejection is not cached: the next call retries
export type Entry =
  | { readonly kind: 'one' }
  | { readonly kind: 'many'; readonly key: string; readonly label: string };
export interface Provider<I, R, H> {
  readonly token: Token<I, R>;
  readonly subject: Subject;
  readonly entry: Entry;                                   // must match token.cardinality, checked at createInstance
  readonly requires: readonly AnyToken[];
  readonly available: (p: ProjectSnapshot) => Availability;
  readonly body: Body<I, R, H>;
}
export function provide<I, R, H>(p: Provider<I, R, H>): Provider<I, R, H>;   // identity, for inference
export interface Context<H> { readonly host: H; readonly snapshot: ProjectSnapshot; readonly signal: AbortSignal }
```

**LanguageMeta.** The eager tier of a language: plain data (budget ≤ 250 B gzip) plus a thunk for the body. Grammars are not fields: they are editor-subject providers.
```ts
export interface LanguageMeta {
  readonly key: LanguageKey; readonly label: string; readonly short: string | null;
  readonly pack: string; readonly uses: readonly string[];    // packs.ts packsOf reads these
  readonly entry: Path; readonly extension: string;
  readonly body: () => Promise<LanguageBody>;                // sample, server settings, property model
}
export interface LanguageBody {
  readonly sample: Files; readonly serverSettings: Readonly<Record<string, JsonValue>>;
  readonly properties: PropertyModel;
}
```
`serverSettings` uses `JsonValue`, not `unknown`.

**Instance.** Holds no global state and creates no workers. `createInstance` refuses at once (throws `Incoherent`, naming both sides) when it sees two token objects with one id, two providers for one `(subject, token)` where the cardinality is `one`, two providers with one key where it is `many`, or an `entry` that does not match the token's cardinality.
```ts
export type Outcome<R> = { readonly kind: 'done'; readonly value: R } | { readonly kind: 'unavailable'; readonly reason: string };
export interface Instance<H> {
  languageOf(id: string): LanguageMeta | null;                             // the one parse of a runtime string
  readonly languages: readonly LanguageMeta[];
  has(s: Subject, t: AnyToken): boolean;                                   // static; loads nothing; follows requires
  availability(s: Subject, t: AnyToken, p: ProjectSnapshot): Availability; // has + available() of it and its requires
  perform<I, R>(s: Subject, t: Token<I, R, 'one'>, input: I, p: ProjectSnapshot, signal: AbortSignal): Promise<Outcome<R>>;
  entries(s: Subject, t: Token<never, unknown, 'many'>): readonly Extract<Entry, { kind: 'many' }>[];
  performKey<I, R>(s: Subject, t: Token<I, R, 'many'>, key: string, input: I, p: ProjectSnapshot, signal: AbortSignal): Promise<Outcome<R>>;
}
export function createInstance<H>(config: { readonly languages: readonly LanguageMeta[]; readonly providers: readonly Provider<never, unknown, H>[]; readonly host: H }): Instance<H>;
```
Two instances on one page are two `createInstance` calls with different language and provider lists sharing one `H` (the page's pool).

**Project / ProjectSnapshot.** The document set. Light's `Workspace` implements it over its Monaco models. A docs snippet is a one-file project plus hidden files. Snapshots are lazy: `file()` reads through to the model. `revision` changes on any file or meta change. `meta` values are typed by the property that owns them.
```ts
export type ProjectChange =
  | { readonly kind: 'edited'; readonly path: Path; readonly version: number }
  | { readonly kind: 'created' | 'deleted'; readonly path: Path }
  | { readonly kind: 'renamed'; readonly from: Path; readonly to: Path }
  | { readonly kind: 'meta'; readonly key: MetaKey };
export interface ProjectSnapshot {
  readonly revision: number;
  paths(): readonly Path[];
  file(path: Path): string | null;
  files(): Files;                                           // O(project); called by a provider at dispatch, never per keystroke
  meta<V>(binding: MetaBinding<V>): V | null;               // null = unset (distinct from default)
}
export interface Project { snapshot(): ProjectSnapshot; onChange(l: (c: ProjectChange) => void): Disposable }
```
Monaco's per-model `versionId` changes are batched into one `edited` event per version.

**Property / PropertyModel.** A typed lens with constraints. The UI for it is never in core.
```ts
export type Read<V> = { readonly kind: 'value'; readonly value: V } | { readonly kind: 'default' } | { readonly kind: 'unrecognised'; readonly raw: string };
export type Storage<V> =
  | { readonly kind: 'file'; readonly path: Path; read(text: string | null): Read<V>; write(text: string | null, v: V): string }   // keeps every other byte
  | { readonly kind: 'meta'; readonly binding: MetaBinding<V> };   // MetaBinding<V> = { key: MetaKey; parse(u: unknown): V | null }: the named boundary
export interface Property<V> {
  readonly id: `${string}#${string}`; readonly label: string;
  readonly storage: Storage<V>;
  readonly choices: (p: ProjectSnapshot) => readonly V[] | null;       // null = free value
  readonly relevant: (p: ProjectSnapshot) => Availability;            // e.g. cpus only when emulation = 'system' on a Linux target
  readonly default: V;
}
export interface PropertyModel { readonly properties: readonly Property<never>[]; summary(p: ProjectSnapshot): string }   // buildSummary, derived
export function readProperty<V>(p: ProjectSnapshot, prop: Property<V>): Read<V>;
export function writeProperty<V>(p: ProjectSnapshot, prop: Property<V>, v: V): ProjectEdit;    // the host applies it (Undo-able in Light)
export type ProjectEdit = { readonly kind: 'file'; readonly path: Path; readonly text: string } | { readonly kind: 'meta'; readonly key: MetaKey; readonly value: JsonValue };
```

**Slot.** Supersession and cancellation. This encodes preview.ts's busy/again and explorer.ts's "newest answer wins". At most one job is in flight. A newer `submit` replaces a pending one that has not been dispatched. `abort` before dispatch drops the job. After dispatch, the job finishes and its result is discarded, unless the job's own signal handling cancels it. An already-aborted signal is refused on entry. Listeners use `{ once: true }` and are removed when the job settles.
```ts
export type SlotResult<R> = { readonly kind: 'done'; readonly value: R } | { readonly kind: 'superseded' } | { readonly kind: 'failed'; readonly error: Error };
export interface Slot<I, R> { submit(input: I): Promise<SlotResult<R>>; dispose(): void }
export function slot<I, R>(run: (input: I, signal: AbortSignal) => Promise<R>): Slot<I, R>;
```

**EditorPort.** A type only in core. A view of one document of a `Project`. Capabilities are optional fields on a closed per-kind map, so a check on `kind` narrows `native`.
```ts
export interface EditorKinds {}       // the ONE merged vocabulary: editors/textarea adds textarea, monaco adds monaco
export type EditorKind = keyof EditorKinds & string;
export interface EditorPort<K extends EditorKind> {
  readonly kind: K; readonly native: EditorKinds[K] extends { native: infer N } ? N : never;
  readonly path: Path;
  reveal(line: number, column: number): void;
  readonly capabilities: EditorCapabilities;   // { decorations?; breakpoints?; caret? } — each a typed object, absent when unsupported
}
```
There is no `languageFeatures` pull API. Language features come from binding the host's `LanguageSession` in the adapter.

## 3. Package layout under `light/modules`

All packages are lockstep and `sideEffects: false`. Each has its own tsconfig.

| Module | Holds | May import (values) | tsconfig lib |
|---|---|---|---|
| `protocol/` | unchanged | itself | es2024 + platform.d.ts |
| `core/` **new** | brand, paths (moved from runtime), token, provider, instance, project, property, slot, editor-port types | protocol (types only), itself | es2024 + platform.d.ts, **no DOM** |
| `runtime/` | today's code (browser host), plus `language-session.ts` (Connection, document sync over a `Project`, typed requests: pull diagnostics, selectionRanges, custom notifications), plus `host.ts` (`BrowserHost = { pool: RunnerPool; packs: PackLocator; servers: ServerLeases }`) | core, protocol | es2024 + DOM + WebWorker |
| `std/` **new** | tokens and input types: `std/run` (`run`, `test`, `mutate`: `Token<RunInput, RunHandle>`), `std/debug`, `std/preview`, `std/explore` (`Token<EmitInput, EmitResult>`, `ViewKind` brand), `std/export` (`many`). Also helpers `runProvider(meta, build)` and `packsOf(meta)`. No language ids. | core, runtime, protocol | same as runtime |
| `monaco/` | today's code, plus `bind.ts` (Monaco models ↔ `Project`, `LanguageSession` ↔ Monaco features, from `lsp/client.ts`), plus `EditorKinds['monaco']` | core, runtime, protocol, `import type` monaco-editor | DOM |
| `editors/` **new, step 8** | `editors/textarea` (`EditorKinds['textarea']`); CodeMirror later as a subpath | core | DOM |
| `lang-<pack>/` **new, step 6** (`@yukibana/lang-cpp` serves `c` and `cpp`; `lang-javascript` serves javascript, typescript, web, p5, p5-global; one each for python, swift, scala, rust, php, java, kotlin, haskell, go, zig) | `index.ts` holds each language's `PackLanguageSpec` and its providers, whose bodies are std's or loaded on a first request. Subpaths: `/body` (sample, server settings, properties), `/monaco` (`MONACO_LANGUAGES`, and Haskell's and Zig's grammars, lazy), and the property modules the app's pickers read (section 14) | core, std, runtime, protocol. `/monaco` may also `import type` monaco-editor, where the package's `peerDependencies` name it. Never another `lang-*` | DOM |

Packs and `CONTRACT.md` are unchanged.

### Boundary rules to add to `boundaries.test.mjs`

1. `ALLOWED` is derived from each `package.json`'s `dependencies` and `peerDependencies`. `build.mjs PUBLISHED`, the app's `check` tsc list and `light-modules.yml` read the same directory list.
2. `core/`: forbid the identifiers `document`, `window`, `HTMLElement`, `customElements`, `Worker`, `location`, `crossOriginIsolated`, `fetch` and `MessagePort`. A tsconfig compile test (as already done for protocol) proves the core compiles without DOM.
3. `core/`, `std/`, `runtime/`, `monaco/` and `editors/`: forbid every `LanguageId` literal, read from the `spec: { key: … }` of each `lang-*/index.ts`, in string literals. A `lang-*` never imports another `lang-*`.
4. `lang-<pack>/index.ts` may value-import only `core` and token modules of `std` (`std/run`, not `std/run/*` bodies). Anything that sends a message lives in a subpath reached by `import()` or, for Light's eager set, a static import in the host config.
5. A module that is the target of any `import()` has no static importer inside its own package.
6. No top-level call other than `/* @__PURE__ */ defineToken(...)` and `provide(...)` in an entry module. `tests/imports.test.mjs` tripwires cover every new entry.
7. Any `as` cast outside `core/brand.ts` and the named parse boundaries (`MetaBinding.parse`, `languageOf`) needs an allow-list entry with a reason.
8. `@ts-expect-error` negatives in `modules/tests/types/`, compiled in `check`:
   - a token with the same id and a different type does not substitute;
   - a `ProjectId`-style brand mismatch;
   - `Language<string>` is not a `LanguageKey`;
   - `perform` on a `many` token is refused;
   - `EditorPort<'textarea'>.native` is not a Monaco editor.

## 4. Light's app mapped onto it

Where this table says `languages/<pack>`, step 6 made it `lang-<pack>` (decision D1); what it built, and where it departs from this table, is section 14.

| `light/app/src/lib` file | Goes to |
|---|---|
| `languages.ts` | Split up. `Language` metadata (id, label, short, pack, uses, entry, extension) goes to `languages/<pack>/index.ts` as `LanguageMeta`. `sample`, `settings` and `CPP_TIDY` go to `/body`. `runs`, `tests`, `mutates`, `debugs` and `preview` become providers; `cannotRun` becomes the run provider's `unavailable` reason; `warmRunner` becomes `RunProvider.warm`; `monacoLanguages` goes to `/monaco`; `configFiles` is derived from the `file` storages of the property model. `isCFamily` disappears: c and cpp share a provider factory in lang-cpp. `LanguageId`, `isLanguageId` and `pickerLanguages` stay in the app as `instance.languageOf` plus the app's picker order. |
| `packs.ts` | `appPacks` stays (host locator). `packOf`, `packsOf` and `runnerSourceOf` go to `std` as `packsOf(meta)` and `sourceOf(meta, locator, requires)`. `APP_RUNNER_NEEDS` stays app config passed into the host. |
| `run.svelte.ts` | Stays (terminal view state). `start()` takes a `RunHandle` from `instance.perform(lang, run, …)` instead of calling `pool.start`. `keepWarm` is driven by `RunProvider.warm`. |
| `workspace.svelte.ts` | Stays the host. It implements `Project` over `models`, `folders` and the meta fields. It replaces lines 382-425's branches with `availability` plus `perform` for run/test/mutate/debug/preview. The `choose*`/`set*` methods become `writeProperty` plus its existing Undo path. The 22 `isCFamily`/`=== 'rust'` branches go. `projectErrors()` uses `LanguageSession`. |
| `explorer.svelte.ts` | View state stays app. The worker start and the `emit` post move to `languages/<pack>/explore` (provider: `EmitInput` → `EmitResult`). Each view's request goes through a `Slot` (newest wins, as today). The 500 ms edit delay stays app. |
| `explore-views.ts` | `KINDS` and `ExploreKind` become a `ViewKind` brand plus per-pack view metadata in `languages/<pack>/index.ts` (toggles, defaults, `x86Only` as `relevant`). `LANGUAGE_VIEWS` is gone. Its unit test moves with it. |
| `compiler-view.ts`, `asm-languages.ts`, `linking.ts`, `explorer-map.ts`, `link-colours.ts` | Stay in the app: Monaco-kind UI using `port.native`. `asmLanguageOf` comes from lang-cpp's `/monaco`. |
| `preview.ts` | The iframe and the busy/again loop stay app, rebuilt on `Slot`. The runner `type: 'preview'` session moves to `languages/javascript/preview`, which provides `std/preview` with a handle `{ page(files), update(changedPaths), stop }`. |
| `debug.svelte.ts`, `Debug.svelte` | Debugger UI stays app. Building the debug run (options, channel) goes to `languages/cpp/debug` and `languages/rust/debug` providers. The "not on Linux targets" reason comes from `available`. |
| `cpp-targets.ts`, `cpp-standards.ts`, `cpp-sanitizers.ts`, `cpp-tests.ts`, `tidy-config.ts`, the cpp part of `optimization.ts` | `languages/cpp/properties/*` as `Property` lenses (`file` storage on `compile_flags.txt` and `.clang-tidy`). `RunOptions` and `runOptionsOf` become a `meta` property bound to `Project.runOptions`. The test framework detector feeds `available` for test on Linux. |
| `rust-targets.ts` | `languages/rust/properties` (`.cargo/config.toml` lens, `miri` meta lens). Run options are imported from lang-cpp's run-options property: lang-rust declares `@yukibana/lang-cpp` as a dependency for that one property module, or the property moves to `std/linux-run-options`. **Chosen: `std/linux`** (a shared property, no language id), which keeps rule 3's "never another `languages/*`" without exception. |
| `optimization.ts` (Swift/Scala levels) | `languages/swift` and `languages/scala` `meta` properties (`Project.optimization`). |
| `build-settings.ts` | `buildSummary` becomes `PropertyModel.summary`. `BUILD_SETTINGS_EVENT` stays app. `BuildSettings.svelte` renders `properties` generically by property kind. `RunOptions.svelte` and `TidyRules.svelte` stay lazy, as today. |
| `haskell-language.ts`, `zig-language.ts` | `languages/haskell/monaco` and `languages/zig/monaco` (made lazy like Monaco's own; checked by the bundle test). |
| `lsp/client.ts` | Connection, document sync and requests go to `runtime/language-session.ts`. The Monaco feature mapping, quick picks and `applyWorkspaceEdit` go to `monaco/bind.ts` (`workspace-edits.ts` goes with it). |
| `lsp/call-hierarchy.ts`, `lsp/workspace-symbols.ts`, `call-hierarchy.svelte.ts` | Pure parts to `monaco/`; views stay app. |
| `export.ts`, `export-tooling.ts` | Step 9: `std/export` (`many`, keyed by build system) with per-language lazy providers. The CI and tidy job composition stays an app-level aggregator over `entries()`. |
| `project.ts`, `project-link.ts` | Stay app. The schema is unchanged; meta properties bind to existing fields. Namespaced extension storage is deferred. |
| `monaco.ts`, `monaco-workers.ts`, `monaco-internals.ts` | Stay app (Light's contribution set). Monaco stays eager in Light. |
| `dock.ts`, `layout-mode.ts`, `offline*.ts`, `pwa.ts`, `verified-cache.ts`, `ansi.ts`, `terminal-links.ts`, the rest | Stay app. `offline-manifest.mjs` gets graph-based classification (step 1). |

## 5. Incremental rewrite plan

Each step must pass `npm run check`, `npm run test:unit` and `npm run build`. Behaviour must be unchanged: `tests/e2e*.mjs` and `ui.mjs` are the oracle. The riskiest abstractions come first: run providers with snapshot-dependent availability, then file-backed properties, then rich handles.

1. **Guards and an empty core.**
   - Add `modules/core` (brand, paths moved and re-exported from runtime, token, provider, instance, slot), with no consumers yet.
   - Generate `ALLOWED`, `PUBLISHED` and the tsc list from directories.
   - Commit `app/bundle-baseline.json`. Extend `tests/unit/bundle.test.mjs` with: baseline + 1%, no self-referencing `dynamicImports`, and offline shell = static closure (rewrite `scripts/offline-manifest.mjs` to classify by graph).
   - Tests:
     - `modules/tests/core-instance.test.mjs`, negatives: duplicate token id refused; two `one` providers refused; `has` loads nothing (lazy load spy); `requires` (mutate without test → false); a rejected lazy load retries.
     - `core-slot.test.mjs`: the three abort cases from effprobe, supersession, one in flight.
     - The DOM-free compile test for core.
     - `bundle.test.mjs` passes against the baseline.

2. **Run, Test and Mutate as providers, all languages.**
   - Add `std/run` with `RunInput = { files: Files; entry: Path; options: RunnerOptions | null }` → `RunHandle`.
   - Write providers in a temporary app-side `src/lib/providers/*.ts`, moved into packages in step 6, so this step changes no package layout.
   - Wire `workspace.svelte.ts` start/test/mutate to `instance.availability` and `perform`, and `+page.svelte` buttons to `availability`. Keep the `Language` booleans for now.
   - Tests:
     - A new `tests/unit/capabilities.test.mjs`: for every language and a matrix of snapshots (wasi vs each Linux target, Catch2/doctest/GoogleTest/mixed tests, miri on and off), the result of `availability` must equal today's behaviour, as encoded from the `Language` booleans and runner refusals.
     - `e2e.mjs`, `e2e-targets.mjs`.
   - After green, delete `runs`, `tests`, `mutates` and `cannotRun`.

3. **Property model on C/C++, then Rust, Swift and Scala.**
   - Move the lenses (target, standard, -O, sanitizers, tidy, run options as meta) into `core` `Property` form, still app-side.
   - `choose*` becomes `writeProperty` through the existing Undo. `buildSummary` becomes `summary`.
   - Tests:
     - The existing `cpp-targets`, `cpp-standards`, `cpp-sanitizers`, `optimization`, `rust-targets` and `tidy-config` unit tests unchanged.
     - A new byte-for-byte round-trip table over `packs/cpp/tests/fixtures/target-cases.json` and hand-edited files (unrecognised lines kept).
     - `project-link.test.mjs` loads old links unchanged.
     - `e2e-targets.mjs`.
   - Exit criterion: no `isCFamily` or `=== 'rust'` left in `workspace.svelte.ts` except the language picker.

4. **Debug and Preview tokens (rich handles).**
   - `std/debug` returns `{ run: RunHandle; program: Promise<DebugProgram> }`.
   - `std/preview` returns `{ page; update(changed: readonly Path[]): Promise<'swapped' | 'reloaded'>; stop }`. `preview.ts` busy/again is rebuilt on `Slot`.
   - Delete `debugs` and `preview` from `Language`.
   - Tests: `e2e-debug.mjs`; `e2e.mjs` preview cases (CSS swap keeps state, a burst of edits gives one build); a new unit test on preview's coalescing with a fake runner (`modules/tests/run-fakes.mjs`).

5. **Explore as a provider.**
   - Add `std/explore`; `ViewKind` replaces `ExploreKind`; per-language explore providers own the `explorer.js` worker; each view gets one `Slot`.
   - `dock.ts`'s switch reads registered view kinds.
   - Tests: `explore-views.test.mjs` (moved), `explorer-map.test.mjs`, `e2e-links.mjs`; a unit test that a stale answer never overwrites a newer one.

6. **Extract `std/` and `languages/<pack>/`, and split meta from body.**
   - Move step 2–5 providers and the step 3 properties into packages, and grammars into `/monaco`.
   - Light's host config statically imports the run, test, mutate, preview and current-language bodies (eager set). Other bodies stay lazy but are precached.
   - Tests:
     - `languages.test.mjs` (rewritten over meta);
     - `modules/tests/package.test.mjs` installs every tarball;
     - boundaries rules 3–7;
     - `bundle.test.mjs`: meta ≤ 250 B gzip per language, eager set in the initial set, initial size ≤ baseline + 1% (it should drop: templates of non-current languages leave chunk `CwprWxgq`);
     - `offline-parts.test.mjs`.

7. **Project port and `LanguageSession`.**
   - `Workspace` implements `Project`.
   - Split `lsp/client.ts` into `runtime/language-session.ts` and `monaco/bind.ts`. `projectErrors`, call hierarchy, workspace symbols and the Linker's selectionRanges use the session.
   - Tests:
     - A new `modules/tests/language-session.test.mjs` with a fake `Connection` (document sync incremental by version; a rename moves documents; pull diagnostics keyed by revision);
     - `call-hierarchy.test.mjs`, `workspace-symbols.test.mjs`;
     - `e2e.mjs` LSP features;
     - `ui.mjs`.

8. **Second host proof.**
   - Add `editors/textarea` and `examples/two-up`: two instances, C++ in Monaco and Python in a textarea, one page `RunnerPool` and one server per pack.
   - Migrate `examples/hylo` to `std/run` with no change to its page behaviour.
   - Tests:
     - An e2e for two-up: neither instance sees the other's languages or providers; one runner per pack.
     - Hylo's tests and fakes.
     - Bundle fixtures `embed-min` (≤ 15 KB gzip initial; no monaco, dockview, arktype or bodies) and `two-instance` (one Monaco chunk).

9. **Export, debug and call hierarchy on-use.**
   - `std/export` (`many`, keyed by build system) with lazy providers; `Export.svelte` loads on open.
   - `debug.svelte.ts` and the call hierarchy are imported on first use.
   - Tests: `export.mjs`, `export-ci.mjs`, `export-options.test.mjs`, `haskell-export.test.mjs` unchanged; `bundle.test.mjs` asserts `export*` and `debug*` are not initial, and records the new, lower baseline.

## 6. Rejected ideas and why

- **Global `Conformances`/`Blankets` merges and `Register`.** They are hand-written facts that do not match the values, apply to the whole program (breaking two instances), and fail silently with two copies of a package (Type-safety, Generalizability, Maintainability).
- **Per-instance type-level conformance closure (shape.ts) and the depth-6 blanket fixpoint.** Correct, but availability depends on the snapshot (N1), so a static "conforms" type would still lie. `has` and `availability` are the truth. Revisit if a site config generates types.
- **Blankets (derive over any subject) in v1.** There is no in-repo user: Rust assembly comes from rustc (`packs/rust/src/explorer.js`), and llc over IR would change output. `requires` covers conditional conformance for one subject. A blanket can be added later as a `{ kind: 'any-language' }` subject with install-time overlap refusal.
- **Compile → Artifact → Execute, `Environment`, `Placement`, `Execution`.** They model a Light that does not exist and would copy multi-MB artifacts across threads (E1).
- **"Run and Explore share one compile" and a memoised Query table.** False today (different flags and workers), and unbounded. A by-key bounded memo is added only when a real shared key exists.
- **Query/Action split.** One token kind; supersession is `Slot`'s job.
- **Features, toggles, `CommandSpec`, `region(): HTMLElement` and `featureElement` in core.** That is UI-kit business. The Svelte app computes its buttons from `availability`.
- **One package per (language × interface), presets, and per-package semver.** No in-repo customer and a version matrix one maintainer cannot keep. The third-party separate-package path stays possible through the same `provide`.
- **`Sources.settings: Record<string, unknown>` and a settings hash.** Settings are files or typed meta (N8).
- **A `packCache` Map on the instance.** Duplicates the HTTP and Cache Storage and the locator, and holds bytes on the main thread.
- **Per-instance scoped Monaco language ids (`yk-<id>-cpp`).** They break Monarch and `monacoLanguages` mapping. Scope by model URI (workspace root) instead.
- **`languageFeatures` pull API and `highlighting.use(unknown)`.** LSP binding through the session, plus per-kind grammar providers.
- **A `MessagePort` per editor for language traffic.** One session per server (N7).
- **Making Monaco lazy in Light.** It moves the time the first editor appears, a behaviour change. Embeds get it lazily.
- **Views written once per UI kit.** There is one kit (Svelte) during the rewrite. When `elements` arrives, views are framework-free `mount(el, handle)` functions shared by both.
- **A Node host now.** Not needed by the rewrite. Core is kept DOM-free so it stays a pure addition.
- **A worker-side extension slot contract** (e.g. `cpp.test-frameworks` fed by other packages). Catch2/doctest/GoogleTest stay first-party pack work, and cpp-layout is first-party clangd work. Reopen when a third party asks.

## 7. Review checkpoints

| Concern | After step | Re-check |
|---|---|---|
| Simplicity | 2, 6, 9 | Core exports exactly the seven nouns plus `EditorPort` and `LanguageMeta`. No second availability path (grep for `.runs`/`.tests` and boolean flags). `std` holds tokens and helpers only. |
| Extensibility | 2, 5, 8, 9 | The capability matrix is expressible without app edits. A test-only third-party provider (an `std/run` for a fake language) installs from outside the repo in `package.test.mjs`. `many` works for export. Hylo needs no core change. |
| Type-safety | 1, 3, 6 | The `@ts-expect-error` negatives compile-fail as intended. Zero `any`. Casts only in the allow-list. `MetaBinding.parse` and `languageOf` are the only boundaries for untyped values. `exactOptionalPropertyTypes` holds with no optional flags on providers. |
| Bundle | 1, 6, 8, 9 | Initial gzip ≤ baseline + 1% (steps 1–5); the drop is recorded at 6 and 9. The eager set is initial. No self-referencing dynamic imports. The offline shell equals initial + eager. Embed and two-instance budgets hold (step 8). |
| Efficiency | 2, 4, 5, 7 | Keystroke path: profile one edit, which should reset timers only and make no `files()` call. First Run opens the worker with no extra chunk fetch. A burst of edits gives one preview build and one explore request per view. One clangd per page in two-up. `keepWarm` timing is unchanged (Haskell e2e). |
| Flexibility | 3, 4, 7 | Hand-edited `compile_flags.txt` lines survive. `unrecognised` states are shown as today. stdin (SharedArrayBuffer), Ctrl-D, debug channel and CSS swap work. Rename and delete move breakpoints. Workspace edits reach unopened files. |
| Maintainability | 1, 6 | Adding a language is adding a directory: lists are derived, with no hand edits in `build.mjs`, `check` or `ALLOWED`. One version and one tag. Every export has a `/** */` contract, including retry-after-failed-load. The prototypes are deleted once step 6 lands. |
| Generalizability | 1, 7, 8 | Core compiles with no DOM. `LanguageSession` takes any `Connection`. `Project` and `EditorPort` fit two-up and Hylo without casts. No core type mentions iframe, Worker or Linux options. |

## 8. Step 1 as built

Step 1 added `core/` with no consumer, so the app's behaviour and its build
are unchanged (every built script and stylesheet is byte for byte that of the commit
before). Where it departs from the sketches above:

* **`paths.ts` stays in the runtime.** Moving it would make the published
  runtime import an unpublished core. The core has its own `Path` brand and
  `pathOf`, and `tests/core-instance.test.mjs` holds `pathOf` to the
  runtime's `pathProblem` until the move, which comes with publishing the
  core (`build.mjs` `PUBLISHED`, `light-modules.yml`, the runtime's
  `dependencies`).
* **The lists are not derived yet.** `ALLOWED` in `boundaries.test.mjs`,
  `PUBLISHED` in `build.mjs`, the app's `check` script and its `kit.alias`
  list each name `core` by hand. `ALLOWED` gains `TYPES_ONLY` (core imports
  only protocol's types) and `FORBIDDEN_NAMES` (rule 2 of section 3, on
  identifiers of the code, so a comment may still name a `Worker`).
* **`AbortController` joins `protocol/platform.d.ts`**, which core's
  tsconfig includes as protocol's does: every host has it, and a slot gives
  each job one.
* **`AnyToken<C>` is an interface** (`id`, `cardinality`), and `AnyProvider<H>`
  is what `createInstance` takes, since `Token` is invariant in its input
  and a list of `Provider<never, unknown, H>` would refuse every real
  provider. `entries` takes `AnyToken<'many'>` for the same reason.
* **`defineToken<I, R>()(id)` defaults to `'one'`**; a second argument gives
  `'many'`. A malformed id throws.
* **More `Incoherent` refusals**: two languages with one key, a provider for
  a language the instance does not have, and a cycle of `requires` (which
  would otherwise make `has` recurse for ever).
* **`perform` and `performKey` check the cardinality at run time too**, and
  throw for the wrong one; `perform` on a `many` token is also a type error.
* **`SlotResult` has `aborted`** besides `done`, `superseded` and `failed`,
  and `submit(input, signal?)` takes the caller's signal: a caller's abort
  and `dispose` are not supersession. A newer submit supersedes the job in
  flight too (its signal is aborted, its result discarded), so an older
  answer never overwrites a newer one; the slot still waits for it before
  the next job starts.
* **`MetaBinding<V>` has `write(v): JsonValue`** beside `parse`, so that
  `writeProperty` can make a `meta` edit; `MetaKey` is a brand made by
  `metaKey`.
* **`PropertyModel.properties` is `readonly Property<unknown>[]`**: a
  property's storage methods are methods, so any `Property<V>` is one.
  `writeProperty` refuses a value outside `choices`.
* **`languageKey(text)`** makes a `LanguageKey` for a language package
  naming its own language; a string from outside still becomes one only
  through `instance.languageOf`, which answers only for the instance's own.
* **The bundle gate** (`light/app/tests/unit/bundle.test.mjs`) measures the
  initial set as the scripts the prerendered `index.html` preloads and the
  stylesheets it links, gzipped at level 9: 1,242,711 B, recorded in
  `light/app/bundle-baseline.json` (the 1,240,796 B above was measured
  another way). The checks for self-referencing `dynamicImports` and a
  graph-classified offline shell are left for the step that first moves
  code into a lazy chunk.

## 9. Step 2 as built, and the review of steps 1 and 2

Step 2 moved Run, Test and Mutate into providers. Where it departs from
the sketches above, including the changes a review of steps 1 and 2 made:

* **`RunInput` is `{ files, entry, options, snippet, onEvent }`**, not
  `{ files, entry, options }`. `snippet` names the page's snippet, since
  the pool replaces a snippet's previous run. `onEvent` gets every event
  from the first state on, because the pool reports events before
  `perform`'s handle is known.
* **`runProvider(mode, language, { requires, available })`**, not
  `runProvider(meta, build)`. One factory serves all three modes, and the
  caller says when it is available. The entry and the `RunnerOptions` are
  still computed by the app's workspace (its `cFamily`, Rust/Miri and
  Swift-level branches). They move into the provider with the property
  model in step 3, whose exit criterion is that those branches are gone.
* **`RunHost`, not `BrowserHost`**: `{ pool, packs, requires }`, the part
  of the host that runs need. The app's `PageHost` (src/lib/yukibana.ts)
  implements it and owns the page's pool, which the terminal's `Runner`
  borrows too.
* **The terminal's start has two phases**: `begin()` clears the terminal
  and returns the listener, and `start(handle)` shows the run. Events that
  arrive between the two are kept.
* **Availability does not read the project yet.** Every provider of the app
  answers the same for every snapshot, as the buttons did. The first
  snapshot rule (C++ Test refused on a Linux target with Catch2 or
  doctest, N1) would change what the top bar offers, so it waits for the
  step that is allowed to change it. The plumbing is ready for it: the
  workspace's `revision` is Svelte state, read by `snapshot()`, so the top
  bar's availability re-derives after every edit. `capabilities.test.mjs`
  asks each language about its sample project and does not claim that the
  answers ignore the project.
* **A snapshot refuses stale reads.** The workspace's snapshot reads its
  models lazily. A read after the revision has moved on throws, rather than
  answering for a newer project under the old revision.
* **`warm` is a token** (`Token<null, SessionSource>`), not a field of the
  run provider: the instance exposes tokens, not provider fields. Its
  provider requires `run` and gives the source that the run providers start
  from. The app warms through the instance, gated on availability, once
  the language server is up. `warmRunner` has left `Language`.
* **Packs are std's.** `LanguageMeta` has no `pack` or `uses`, and
  `LanguageBody` has no `serverSettings`. std's `PackLanguage` adds them,
  with the pack ids branded. The app's `metaOf` checks them when the
  instance is made, not when Run is first pressed.
* **`Files` is keyed by `string`.** A record cannot check its keys, so a
  `Path` key guarded nothing and made every reader cast. The one-file APIs
  keep `Path`. The workspace's `files()` passes each key through `pathOf`.
* **`Provider<I, R, H, C>` ties `entry` to the token's cardinality**
  (`EntryOf<C>`), and `AnyProvider<H>` is a union over `'one'` and
  `'many'`. A provider filed the wrong way is now a compile error, and
  `Incoherent` stays as the guard at run time.
* **`PropertyModel.properties` is `readonly SomeProperty[]`**, an
  existential: `open(use)` hands the property to a function generic in its
  value type. Storage and binding `write`s are function properties, not
  methods, so `Property<V>` is invariant and a value of another type cannot
  be written to it.
* **The lists are derived** (`list.mjs`). A module is a directory with a
  `package.json`. Its arrows are that manifest's `dependencies` and
  `peerDependencies`. `PUBLISHED` is the modules not marked `private`, in
  dependency order (core and std are `private` until a published module
  imports them). The app's `check` runs `typecheck.mjs`, and the Vite
  aliases, the import tripwires, `capabilities.test.mjs`'s resolve hook
  and the release workflow all read the same list. Since the manifests
  are the truth, the runtime and monaco may not import core until they
  declare it (neither does today), and core and monaco now declare the
  protocol they import.
* **Not done: providers from outside the app.** The app's instance is
  still made from its own `LANGUAGES` and `RUNNERS`. Third-party language
  packages are step 6. Until then, a host outside the app builds its own
  instance from std's `runProvider` and `warmProvider`. `subjectOf` now
  takes any string that `languageOf` knows, not only the app's
  `LanguageId`.

## 10. Step 3 as built

Step 3 made the build settings of C, C++, Rust, Swift and Scala properties,
still app-side, in `light/app/src/lib/properties/` (`cpp.ts`, `rust.ts`,
`levels.ts`, `linux.ts`, with `index.ts` for the table and `read.ts` for
what they share). Each file lens's `read` and `write` are the functions the
Build settings already used (`targetOf`/`withTarget`, `standardOf`/
`withStandard`, `cppLevelOf`/`withCppLevel`, `sanitizersOf`/
`withSanitizers`, `checksOf`/`withChecks`, `rustTargetOf`/
`withRustTarget`), so what a project holds and how a picker rewrites it
are unchanged. Each language's `LanguageBody.properties` is its model.
Where it departs from the sketches above:

* **`LanguageSettings`: the properties by role, as well as the model.**
  A model's list is existential (`SomeProperty`, section 9), so a host
  cannot take a `Property<CppTargetId>` back out of it without a cast. The
  app's table holds each property under its role (`target`, `standard`,
  `level`, `sanitizers`, `tidyChecks`, `clangTidy`, `runOptions`,
  `rustTarget`, `miri`), null where a language has none, and the workspace
  asks that null where it asked the language's name. The roles are the
  host's: when the models move into packages (step 6) a package exports
  its properties, and the host's table names them.
* **A meta binding may write null, which unsets the field.** The value a
  project that never chose has (the default level, Miri off, clang-tidy
  on) is saved as no field, as it always was, so that choosing it again
  saves what never choosing does. `MetaBinding.write` and `ProjectEdit`
  say so. Run options are the exception, as they were: once chosen they
  are saved whole, defaults included.
* **The value types are what the pickers write.** A standard is its
  `-std=` value of the list (`c++20`, `gnu++20`; an alias reads as the
  standard it names) or `'default'` for no line, since a project with no
  `-std=` is not the project that says `-std=gnu++17`. Miri is a Miri
  target or `'off'`. The clang-tidy rules are the globs of `Checks` or null
  for no key (clangd's own checks); `withChecks(text, null)` now takes the
  key out, so that the lens is total, though nothing in the app writes null
  yet.
* **Two lenses never read `default`.** `rustTargetOf` does not tell a file
  without `[build] target` from one naming the default, so both read as
  the default's id, a value; `sanitizersOf` always answers, so the
  sanitizers read as a value, none on when there is no line.
* **The sanitizers lens is not byte for byte on a CRLF file.** Its write is
  the menu's `withSanitizers`, which has always rewritten the file with
  `\n` line ends. Every other line is kept, in its place; the round-trip
  test (`tests/unit/properties.test.mjs`) holds the other lenses to CRLF
  and this one to `\n`, and says so. Changing it would change what the
  menu writes.
* **Run options are one property made per language**
  (`runOptionsProperty(relevant)`, id `@yukibana/std#linux-run-options`):
  C and C++ on a Linux target, Rust on one and not under Miri. `relevant`
  is what the summary reads to decide whether to show them. A stored value
  is read field by field (`runOptionsOf`), so a hand-made link whose run
  options carry a field the runner does not know no longer sends it.
* **The workspace's choice fields stay.** `target`, `standard`,
  `optimization`, `sanitizers`, `rustTarget` and `tidyChecks` are still
  Svelte state, refreshed from the same parse functions, but only where
  the language has the property. The Build settings panel reads them: it
  needs what a `Read<V>` does not carry (whether a standard is GNU, a
  level's label, clang's default named). Rendering the panel generically
  from the model is left for when the models move into packages.
* **`choose(property, value)`** is the one write path of the workspace's
  `choose*` and `set*` methods: `writeProperty` over a snapshot, then
  `apply`, which gives a file edit to `replaceFile` (one Undo step, as
  before) and sets the workspace's field for a meta edit (no Undo, as
  before). A value outside the property's choices, or a language without
  the property, is ignored, as the methods ignored them. `setRunOptions`
  is now ignored for a language without run options; it used to save them
  for any language, though only the C, C++ and Rust panels offer them.
* **`buildSummary` is the model's `summary`** over the workspace's
  snapshot. The snapshot reads the workspace's revision, so the chip and
  the status bar follow every edit as they did. **The runner's options**
  come from the properties (`runnerOptionsOf`): a level saved with the
  project, the run options, Miri when on; the same keys in the same order
  as before. The compiler output views and Download send the level only
  where it is a meta property, as before. They are read from the snapshot
  before the terminal is shown: showing it can move the tabs, which is a
  change of the project, and a first version that read them after it threw
  the stale-snapshot error of section 9 on Run (e2e-layout's `cpp-run`).
* **Branches left in `workspace.svelte.ts`**, each with a comment or for
  the reason here. `debug()` still asks `isCFamily`: a Rust debug run has
  never been sent the run options its Run is sent, so no property says it;
  step 4's debug providers decide. `refreshTestFramework` asks for C++ by
  name: the test framework is a detector, not a setting, and feeds Test's
  availability later. The language picker. Outside the workspace,
  `+page.svelte`'s `hasBuild`, `BuildSettings.svelte` and `levelsOf` still
  name languages; they go with the generic panel.
* **Test's availability on a Linux target is unchanged.** C++ Test is still
  offered and enabled on a Linux target with Catch2 or doctest, which the
  runner refuses (section 9); the property is now there to read, but the
  rule changes what the top bar offers.


## 11. Step 4 as built: Debug, Debug tests and Preview

Step 4 made Debug, a new Debug tests, and a web project's Preview
providers of std's tokens, still app-side (`light/app/src/lib/providers/`
`debug.ts` and `preview.ts`), and deleted `debugs` and `preview` from
`Language`. Where it departs from the sketches above:

* **Two debug tokens, `debug` and `debugTest`** (`std/debug.ts`), of one
  shape: `DebugInput` is a `RunInput` with the debugger's `channel`, and
  the result is `DebugSession = { run: RunHandle; program: Promise<DebugProgram | null> }`.
  `program` resolves with the runner's `debug` event, or null once the run
  ends without one (it did not compile). One token with a mode in its
  input could not be offered per mode, since an availability is asked of
  a token, never of an input. `debugTest` requires `[test, debug]`, and
  only C++ provides it: its runner debugs a `type: 'test'` run as it does
  a run (`packs/cpp/src/runner.js` `build()`). Swift's runner runs its
  tests uninstrumented, once per testing library, so Swift has Debug only;
  C has no tests. Rust has never debugged, so section 4's
  `languages/rust/debug` does not exist: the debug languages are C, C++
  and Swift.
* **`debugProvider(mode, language, { requires, available, options })`**,
  whose `options` (`'as-run' | 'none'`) says whether the input's runner
  options go along: C and C++ send their run options, as before; Swift
  sends none, as before (its runner compiles a debugged program at
  -Onone). The workspace computes the options as for a Run
  (`runnerOptionsOf`), so `debug()`'s `isCFamily` branch is gone.
* **The input and availability are fixed at the click, and `perform` runs
  when the debugger's worker is ready**, on a frozen snapshot: the
  workspace's `frozen(files)`, an eager copy of the files and the saved
  settings that never goes stale. Run and Test perform on one too, since
  showing the terminal moves the tabs, a change of the project (section
  10), and an availability that reads the project would then read a stale
  snapshot. The terminal's `startDebug` and `debugProgram` are gone: a
  debugged run is `begin()`, `perform`, `start(run.handle)`, and the
  program goes to the debugger only while the terminal still shows that
  run (`Runner.shows`).
* **UI.** Debug, its ⋯ menu item, the Debug panel's start and F5 are
  unchanged, read from `has(debug)` and its availability. Debug tests is a
  ⋯ menu item (no `data-fold`: it has no top-bar button), a button beside
  the Debug panel's Debug, and the editors' `yukibana.debugTests` action,
  with no key (Shift+F5 is the debugger's Stop). Each is disabled with its
  availability's reason as its title. The breakpoints' margin is offered
  where the language has `debug`.
* **Preview's token is a session, not a page handle**
  (`std/preview.ts`): `PreviewInput = { report }` (what the person is told
  about the runner), and `PreviewSession = { entry; build(files); stop() }`
  whose `build` gives a `BuiltPage` (`page`, `errors` or `unanswered`).
  The provider owns the `type: 'preview'` worker, the request ids and the
  15 s watchdog that `preview.ts` had; the iframe, the stale set, the CSS
  swap, the 300 ms delay and the error check stay in `preview.ts`. Section
  5's `update(changed): 'swapped' | 'reloaded'` is dropped: the swap needs
  the app's frame. `build` takes no signal: no build is ever given up (the
  page it brings is shown, as every finished build was), and a build asked
  for while another is waited for settles the older one as `unanswered`.
  The session's entry (`index.html`) is the provider's, so the workspace
  names no page. It finds its runner through `host.packs.file` at each
  build, not at `perform`, so opening a session reads nothing.
* **One session per Run of a language**: Run again with the preview
  showing keeps its session (`Preview.sessionOf`), so TypeScript stays
  loaded, as it did when the panel kept its worker per pack.
* **busy/again is a `Slot`** whose job checks, builds and renders: what a
  build brings is shown inside the job, guarded by the preview's
  generation (bumped by start and stop), not by the slot's result, so the
  page an edit overtook is still shown. A newer update aborts the job's
  signal, which gives up the error check only. An edit aborts the check as
  before through the job's own controller, not through the caller's
  signal of `submit`: aborting that would drop a Reload waiting in the
  slot.
* **The web languages keep their run providers** for the Run button's
  availability; Run prefers `preview` where the language has it.
* **Debug tests and `tests/` files.** The debugger maps a project path to
  `/workspace/<path>` in the program's DWARF; a test build compiles
  `tests/*.cpp` there too, so breakpoints in tests need no change
  (`e2e-debug.mjs`'s C++ test case).
* **Availability reads the project (N1), in a commit of its own**
  (`providers/refusals.ts`). Each rule restates a runner's refusal and
  says it in the runner's own sentence, so a button the runner would
  refuse is shown, disabled, with what the terminal would have printed:
  C and C++ Debug (and so Debug tests) on a Linux target of
  compile_flags.txt; Swift Debug on a Linux TARGET of swift.env, read as
  the runner reads it; C++ Test on a Linux target with Catch2 or doctest,
  and with tests that mix frameworks (the runner refuses those on every
  target). Debug tests is also unavailable when tests/ includes no
  framework, or there are no tests: a new button need not offer what
  would only print that there is nothing to debug. Test stays enabled
  there, as it was, and the runner says so. Each rule reads tests/,
  compile_flags.txt or swift.env through `file`, never `files`. The
  workspace's `testFramework` (the header's framework choice) still has
  its own detector, `refreshTestFramework`: it is view state, not
  availability, and moves with the generic settings panel.

## 12. Step 5 as built: Explore

Step 5 made the compiler output views providers of std's `explore`, still
app-side (`light/app/src/lib/providers/explore.ts`), and deleted
`explore-views.ts`: its table moved, unchanged but for the fields below,
into that file, and its unit test (`tests/unit/explore-views.test.mjs`)
reads it there. Where it departs from the sketches above:

* **One worker per pack, lent by the host** (`ExplorerWorkers`,
  std/explore.ts): `ExploreHost = { packs, explorers }`, which the app's
  `PageHost` implements beside `RunHost` (`AppHost`). C's views and C++'s
  share the `cpp` worker, as they did, and so would two instances' views
  of one pack. Request ids are the page's and only increase. A worker is
  started from `host.packs.file(pack, 'explorer.js')` at the first request
  and let go by `release(pack)`, which the explorer calls where it
  terminated its worker (the last view closed, the language changed, the
  project was reset). How a worker is started and its URL probed after a
  failure is an `ExplorerPlatform` (`pagePlatform()`: a module `Worker`
  and a HEAD `fetch`), so the tests drive fake workers.
* **A request settles as soon as its signal is aborted** (D8).
  Every pack's explorer.js drops the answer to a request that a newer one
  of the same view replaced while it compiled, so a job that waited for
  its own id would hang. `ExplorerWorkers.emit` resolves `dropped` on
  abort; the explorer keeps one core `Slot` per view, whose newer submit
  aborts the job in flight, so the newer request is posted at once and
  the worker's own queue coalesces them, today's timing. Slot's "the next
  job waits for the one in flight" is thus kept only in name: the job in
  flight gives way at once. A late answer to a superseded request is
  ignored twice over, by its id and by the slot
  (`modules/tests/std-explore.test.mjs`).
* **`EmitResult` is `output | failed | broken | dropped`**: the compiler's
  output, the compiler's messages, the worker's failure (`broken`: it
  failed, said with the HEAD probe's "not installed" when its URL is not
  served, as `failAll` said), and no answer waited for. A worker's failure
  now reaches only the requests that worker had; a request made while the
  probe was out goes to a new worker and is not failed with them, as it
  was.
* **The token's result is `Promise<EmitResult>`**:
  `Token<EmitInput, Promise<EmitResult>>`. An instance's `perform` gives
  back what the body returned, at once, so an answer that comes later is
  a promise inside the outcome, as Debug's `program` is inside its
  session.
* **No `views` token; the views are the language's data.** A language's
  views (`LanguageViews`: compiler, sources, build settings, and each
  view's kind, title, short form, noun, Monaco language and toggles) are
  read synchronously by the top bar, the dock's panels and tabs, the
  editors' actions and the views themselves, as `has` is; an instance's
  answers are promises, so a `Token<null, LanguageViews>` would have made
  each of them wait a turn, or the dock wait before its first panel. They
  are data exported beside the provider, made from the same table
  (`viewsOf(id)`; step 6 puts them in `lang-<pack>/index.ts`, the eager
  tier section 3 gives provider metadata), and `has(subject, explore)` is
  the instance's answer to whether a language has views at all: the unit
  test holds the two to each other for every language.
* **`KINDS` is gone**; each view carries its kind's title, short form and
  noun (the table's `view(kind, …)` fills them from one list, so a kind is
  called the same in every language, which the test checks). The kind
  strings are unchanged.
* **Toggles: unions, not optional flags.** `x86Only?: true` is
  `offered: 'always' | 'x86'` and `shared?: true` is
  `sets: 'view' | 'language'`. `x86` stays the view's rule, not an
  availability: it follows the answer's target, not the project.
* **The dock has no table of views.** A view's panel is still
  `view:<kind>`, with component `assembly` for `asm`, and the id is
  parsed back (`viewOfPanel`); its title and short form come from the
  current language's views when the panel or its tab is made. The views'
  panels are ordered as the language lists its views where the old table
  ordered them (moving between layouts), which is the same order for
  every language. The dock never restores a saved layout (no `fromJSON`),
  so risk 2 of the decisions, a saved layout naming a component the dock
  no longer knows, does not arise; a component name that is none of the
  current language's views makes an editor, as an unknown name did.
* **The explorer's state is keyed by kind** (`ViewKind`, a brand made by
  `viewKind`): `view(kind)` and `optionsOf(kind)` read it, idle and empty
  for a kind that has asked nothing. It keeps the 500 ms edit delay, the
  open, visible and stale sets, each language's options, and the
  `latest` id that guards against an answer after `closed` or `reset`,
  which now also dispose the view's slot, so nothing waits for its
  answer.
  (Section 13 replaced the slots with one `AbortController` per view.)

## 13. The review of steps 4 and 5

What the review of steps 4 and 5 found, and what changed. Where this
section and sections 11 and 12 differ, this one holds.

* **Explore is typed by the core's language, not a string.** The
  explorer's host (`ExplorerHost`) takes and gives a `LanguageKey`, the
  key the instance knows (`subjectOf(id).id`), and so do `Explorer`'s
  saved options and `Preview`'s owner. The `isLanguageId` guard that let
  a release do nothing for a language the app's table did not name is
  gone.
* **The views are carried by the provider** (section 12's "no `views`
  token" stays: they are still read synchronously). `explorerProvider`
  returns an `ExplorerProvider`, a provider with two more fields: its
  `views`, and `release(host, holder)`, which lets its own pack's worker
  go. The app reads views through the providers it registered
  (yukibana.ts `viewsOf(subject)`, `viewOf`, `releaseExplorer`), never
  through its table, so a language's views reach the top bar, the dock,
  the editors' actions and the views from its provider alone, and its
  worker is released by its provider, whatever its id. The table
  (`LANGUAGE_VIEWS`) is the app's languages' data only, with C listed as
  C++'s object instead of an alias in a lookup; the unit test holds every
  language's provider's views to it. Which flags a view's details call
  chosen (clang's `userFlags`, or all as sent) is `LanguageViews.chosenFlags`
  (`'clang' | 'all'`), not a test of the language id in compiler-view.ts.
* **One guard against a stale answer, not three.** The explorer keeps no
  `Slot` per view: a newer request aborts the view's `AbortController`,
  whose request then settles `dropped` at once (D8, as before), and
  only the answer to the view's newest id (`latest`) is shown.
  `ExplorerWorkers` still matches answers to ids, which is what a shared
  worker must do. The slot's queue had never queued anything here.
* **A worker is held, not owned.** `EmitInput.holder` (an
  `ExploreHolder`, compared by identity: the explorer passes itself) holds
  the pack's worker from its first request; `release(pack, holder)` drops
  only that holder's requests and stops the worker once no holder is
  left, so one explorer letting go cannot hang another's views on
  "Updating…" (step 8's two instances). Two consequences of sharing a
  worker made explicit: explorer.js answers only the newest request of
  each view kind it has, so a holder's request that another holder's of
  the same kind replaced is posted again once that one is answered; and a
  worker restarted from another URL takes over the requests the old one
  had, instead of dropping them.
* **Answers are read entry by entry.** explorer-workers.ts `resultOf`
  checks every field and every entry of `lines`, `unoptimized` and
  `flags`; one that is not what packs/CONTRACT.md says makes the answer
  `broken`, naming it (`lines[0].file is not a string`). A field left out
  still reads as empty, as before, so no pack's answer that worked is
  refused.
* **The explorer workers are lazy.** `ExplorerWorkers`, `pagePlatform`,
  the readers and the provider's body moved to `std/explore-workers.ts`,
  which `explorerProvider`'s lazy body and `pageExplorers()` import on a
  first request; `std/index.ts` exports only its types. `ExploreHost`'s
  `explorers` is therefore `explorers(): Promise<ExplorerWorkers>`, and
  `madeExplorers` (null until made) is what a release reads, so letting
  go loads nothing. The web languages' preview session moved the same way
  to `providers/preview-session.ts`, under a lazy body. Debug's body did
  **not**: measured, making it lazy grew the initial set by 688 B gzip
  (the chunk split it causes costs more than its 15 lines), so it stays
  eager until step 9 splits the debugger's session from its breakpoints
  (D13). The initial set went from 1,252,149 B to 1,251,213 B (budget
  1,255,138 B).
* **Availability is read once per edit.** The workspace hands out one
  live snapshot per revision (`snapshot()`), and refusals.ts keeps what it
  found in tests/ and compile_flags.txt per snapshot (`once`, a
  `WeakMap`), so the five availability questions the top bar and the
  Debug panel ask after a keystroke read the test files and parse the
  flags once between them, where they read them some five and seven
  times. A keystroke still reads tests/ once: a snapshot has no per-file
  version to skip it by.
* **A refused Test says why.** `run(mode)` with the mode unavailable
  writes the availability's reason as a warning, as `debug` already did,
  where the language has the mode at all: Ctrl+Shift+Enter and the
  editors' Test Project reach it with the button disabled (C++ tests that
  mix frameworks, or Catch2 or doctest on a Linux target), where before
  they did nothing. `e2e-debug.mjs` adds doctest to the GoogleTest tests
  and checks the Log panel. A debugged run whose provider throws now also
  ends the debugger's session, which it left started.

## 14. Step 6 as built: std and the language packages

What step 6 built, and where it departs from sections 3 to 5 and from
decision D1. Where this section and those differ, this one holds.

* **One flat directory per pack** (D1): `lang-python`, `lang-javascript`
  (javascript, typescript, web, p5, p5-global), `lang-cpp` (c, cpp),
  `lang-swift`, `lang-scala`, `lang-rust`, `lang-php`, `lang-java`,
  `lang-kotlin`, `lang-haskell`, `lang-go` and `lang-zig`, each
  `@yukibana/lang-<pack>`. list.mjs finds them as it finds every module,
  and now also reads each package's `exports` (`entries`, under the
  `@yukibana/source` condition) and whether it is allowed Monaco's types
  (`monacoTypes`, a `monaco-editor` peer dependency). The app's Vite
  aliases (`moduleSources()`), the Node resolve hook the app's tests
  register (`tests/modules-hook.mjs`, over `sourceUrlOf`) and the import
  tripwires (52 entries) all read that list, so none of them is edited
  for a new language; section 16 lists what still is.
* **A package exports its languages as specs and providers, and the host
  gives the body.** `index.ts` exports `LANGUAGES`, by key, each a
  `PackageLanguage<H>` for the least host its providers need (section 16): its `spec` (`PackLanguageSpec`: key,
  label, short, pack, uses, entry, extension; at most 250 B gzip each,
  checked in languages.test.mjs) and `providers(language)`. `body.ts`
  exports `BODIES` (`PackLanguageBody`: sample, server settings,
  properties, `configFiles`), and `monaco.ts` `MONACO_LANGUAGES`. The
  host pairs them with std's `packLanguage(spec, body)`, which checks the
  key, entry and pack and takes the body's thunk. Section 3 had
  `index.ts` reach its body by `import('./body.ts')`: Light imports every
  body statically (the eager set, N9), so that `import()` would be a
  dynamic import of a module already in its importer's static closure,
  which rule 5 and the bundle test now refuse. Another host passes a
  thunk that imports the body when it wants.
* **No `/run`, `/debug` or `/explore` subpaths.** The bodies of Run,
  Test, Mutate, Debug, Debug tests and the explorer are std's
  (`runProvider`, `debugProvider`, `explorerProvider`, whose explorer
  workers std already loads on a first request), so a language's
  providers are their metadata and nothing to split. The one body of a
  package's own is lang-javascript's preview session
  (`preview-session.ts`), still loaded on a first Preview. `/export`
  waits for step 9.
* **Subpaths the app's pickers read.** lang-cpp exports `/levels`,
  `/properties`, `/sanitizers`, `/standards`, `/targets`, `/tests` and
  `/tidy`; lang-rust `/properties` and `/targets`; lang-swift and
  lang-scala `/properties` (their levels and property models). These are
  the lenses of step 3, moved with their unit tests' paths; the app's
  table (`properties/index.ts`, `optimization.ts`) reads the very models
  the bodies carry.
* **std gained what more than one language shares**, so that no `lang-*`
  imports another: `std/linux` (targets' short names, run options and
  their property, which C, C++ and Rust use; section 4's choice),
  `std/levels` (optimisation levels and `levelProperty`), `std/read`
  (`valueOf`, `always`, `NO_PROPERTIES`) and `std/explore-views` (the
  view kinds' titles and the toggles several languages offer). Each
  language's own views moved to its package. `isExplorerProvider` lets
  the app find the explorers among the providers it registered.
* **The app keeps `LanguageId` and the picker.** languages.ts imports
  every package's `LANGUAGES`, `BODIES` and `MONACO_LANGUAGES`, and
  `LanguageId` is `keyof typeof INSTALLED`, the union of the installed
  keys; the picker's order, `isCFamily`, `languageOf` and
  `isLanguageId` stay. `Language` gained a required `pack`, `uses`,
  `configFiles`, `properties` and `providers`, so packs.ts reads the
  pack from the language instead of a table.
* **Haskell's and Zig's grammars are lazy** (D2). `registerHaskell` and
  `registerZig` (`/monaco`) register the language and set its language
  configuration at once, and load the Monarch tokenizer
  (`grammar.ts`) by `import()` when Monaco first meets the language.
  Haskell's configuration used to be set in `onLanguage` too; it is now
  eager, as Zig's is, because Zig's comment and bracket rules once arrived
  after the first model and were missed. The bundle test checks both
  grammars are lazy chunks outside the initial set.
* **The guards.** boundaries.test.mjs: core, std, runtime and monaco name
  no language id (read from each `lang-*/index.ts` spec); no `lang-*`
  imports another; an `index.ts` value-imports only core, std and its own
  package's metadata modules; a module some `import()` reaches has no
  static importer in its package (rule 5), each with a negative.
  bundle.test.mjs: no dynamic import already in its importer's static
  closure; no language's index or body is a lazy chunk; the offline shell
  holds the initial set and every shared module's lazy body, and not the
  app's own lazy views (explorer.svelte.ts, compiler-view.ts).
* **The offline shell is classified by owner, then by graph.**
  offline-manifest.mjs takes a dynamic entry of Monaco's or of the app's
  `src/` as a lazy root and one of a shared module's or of Kit's as
  startup (precached), then closes over the import graph. The shell came
  out as before except that the preview session and the two grammars,
  now shared modules' lazy bodies, are precached (equal or better), and
  one fix: build/index.html links RunOptions.css, which was classified
  lazy before this step too; every file the page links is now in the
  shell. Shell 46 entries before, 48 after.
* **Not done, and why.** `paths.ts` stays in runtime (re-exported by
  core, as step 1 left it): moving it changes runtime's published API for
  no consumer. core, std and every `lang-*` stay private: publishing core
  and std means publishing their source-only `.ts` entries and Monaco's
  types as a peer, which is not trivial; build.mjs still publishes
  protocol and runtime, and package.test.mjs installs those. No initial
  drop from moving samples, which section 5 expected: Light imports
  every body with the page.
* **Packs' tests read the packages.** The pack tests that ran the app's
  sample (go, swift, rust, cpp, zig, java, scala) imported it by parsing
  languages.ts's source; they now `import()` the package's `body.ts` (and
  java and scala its `index.ts`, for the entry), which Node loads as it
  is. packs/cpp's test imports the test-framework chooser from
  lang-cpp's `tests.ts`. Their `test.sh --inputs` print the package's,
  std's, core's, runtime's and protocol's files, and light-packs.yml and
  light-ci.yml's exports job list those directories.
* **The initial set** went from 1,251,213 B (27 files) to 1,249,399 B (24
  files) gzip, recorded in `app/bundle-baseline.json` (budget +1%).

## 15. Step 7 as built: the language session and its Monaco binding

Step 7 split `lsp/client.ts` in two (decision D9), in two commits: first
the halves, with `LanguageClient` left as a facade over them so that the
workspace was unchanged; then the call sites. Where it departs from
sections 2 to 5, and from D9:

* **`runtime/language-session.ts`: `LanguageSession`**, over a
  `ServerEndpoint` (the worker), which it wraps in its own `Connection`
  so that it owns the connection's close. It holds `initialize` and
  `initialized`, the settings `configure` was given before the server was
  ready, the sync kind, the open documents by URI with their last version
  (`open`, `change`, `close`, `rename`), `stop` (`shutdown` raced against
  `SHUTDOWN_MS`, then `exit`), `ask`/`askOrThrow`, `executeCommand`,
  `onShownError`, and the typed requests: `workspaceErrors`,
  `selectionRanges(uri, positions, signal)` and `calls(direction, item,
  signal)`. The server's notifications go to the host's `SessionEvents`
  (`state`, `loading`, `log`, `status`) or to its client (`diagnostics`,
  `showDocument`, `applyEdit`, `refreshed`, `closed`). `?trace` is the
  host's option (`trace`), and so is the locale: the session reads no
  `location` and no `navigator`.
* **The editor's binding is the session's `SessionClient`**, and gives the
  client capabilities `initialize` announces (`monacoClientCapabilities`:
  Monaco folds whole lines, takes relative semantic tokens, snippets).
  `start(client)` hands it the ready server (`started(capabilities)`),
  where it opens its documents and registers its features. Edits reach
  the session from the binding's model listeners, as ranges by version
  (`DocumentChange`: the version after the edit, its ranges, and a thunk
  for the whole text a full-sync server wants), never from the project's
  change events (D9). `change` refuses a version that is not after the
  last one sent (a `RangeError`, the `Requires` of its contract).
* **Pulled diagnostics are keyed by the session's revision**, which every
  `open`, `change` and `close` moves: `workspaceErrors` answers
  `PulledErrors = { revision, errors }`, the revision at which the pull
  was sent, so a caller can tell that an edit went to the server while it
  answered. Preview's error check still gives up on an edit through its
  signal, as before, and reads only `errors`.
* **`monaco/bind.ts`: `MonacoBinding`**, with the host's Monaco and
  internals injected (H1). Every feature the client registered is
  registered here as it was, word for word, with LSP's types from
  `protocol/lsp.ts` (which gained the server's capabilities, the call
  hierarchy's and workspace symbols' types, pulled reports and the rest
  of what the session reads) instead of `vscode-languageserver-protocol`.
  The quick pick and the inline message come from the internals.
* **`applyWorkspaceEdit` is the internals', not `workspace-edits.ts`'s.**
  Section 4 had `workspace-edits.ts` go with the binding. Its bulk edit
  service and dialog service are the app's replacements of Monaco's
  services (one undo step across files; a dialog in the app's style),
  installed by `startEditor` before any editor exists, so they stay the
  app's; the binding applies a server's edit through Monaco's bulk edit
  service (`internals.applyWorkspaceEdit`), which is that replacement,
  under `WORKSPACE_EDIT_CODE`. The app's own `applyWorkspaceEdit` had no
  other caller and is gone.
* **`call-hierarchy.ts` and `workspace-symbols.ts` moved to `monaco/`**
  (section 4's "pure parts"), with their unit tests (`modules/tests/`),
  since the binding's Show Call Hierarchy and Go to Symbol use them;
  `CallDirection` and a level's `Calls` are the session's. The panel's
  state (`call-hierarchy.svelte.ts`) stays the app's.
* **monaco depends on runtime**, as its README already allowed, for the
  session's types.
* **The workspace implements core's `Project`** (the second commit).
  `onChange` announces `created` for a file made and for every file of a
  project loaded, `deleted` for a file deleted (before its model is
  disposed, so a listener still finds it) and for every file of a project
  closed, `renamed` for each file a rename moved (once its new model
  exists and its old one is gone), `edited` for each version of a model,
  and `meta` for a saved setting written through a property. Folders are
  not files, so making one announces nothing.
* **The binding follows the project, as D9 has it**: its first documents
  are the snapshot's paths once the server is ready (where the client
  took the workspace's models), and from then on a `created` file is
  opened, a `deleted` one closed and a `renamed` one moved
  (`LanguageSession.rename`); `edited` and `meta` are not its business,
  since its model listeners already send the edits as ranges. What the
  server is sent is what the client sent: a rename is still a file closed
  and deleted, then one opened and created. The binding's own `add` and
  `remove` are gone, so there is one way in.
* **The call sites ask the session.** `LanguageClient` and `lsp/` are
  gone: the workspace makes the session and its binding where it made the
  client. The preview's error check (`projectErrors`) reads
  `workspaceErrors`, the call hierarchy's levels are `session.calls`, the
  Linker's selection ranges are `session.selectionRanges`, and Go to
  Symbol in Workspace was already the binding's. The app's
  `vscode-languageserver-protocol` imports are gone with them: what the
  app reads of a server is typed by `@yukibana/protocol`.

## 16. The review of steps 6 and 7

* **A run-only language asks only for a run host.** Every package typed
  its languages `PackageLanguage<PackHost>`, so a host that only runs
  code (the Hylo example, a playground) could not take Go's providers
  without faking `explorers()`. A language is now typed by the least host
  its providers need: Go, PHP, Kotlin, Zig and lang-javascript's five are
  `PackageLanguage<RunHost>`; Python, Java, Haskell, Rust, Scala, Swift,
  C and C++ have compiler output views and stay `PackHost`. The app's
  `Language.providers` is still `PackHost`'s, which takes both, since a
  provider's host is an input. Checked with a probe: `createInstance<RunHost>`
  takes Go's providers and refuses Python's.
* **The decisions are written down.** Sections 4 and 12 to 15 cited D1,
  D2, D8 and D9, and code comments "decision 8" and "decision 7", ids that
  were never in this file; section 1 now lists D1 to D14, and the comments
  cite D8 and D9. language-session.ts named a `bindMonaco` that never
  existed: it is `MonacoBinding`.
* **What adding a language still edits.** Section 14 said adding a
  language is adding a directory. It is not quite: besides the directory,
  the app's languages.ts imports the package's `LANGUAGES`, `BODIES` and
  `MONACO_LANGUAGES` and spreads each into its table, and monaco.ts imports
  Monaco's own grammar for it, if Monaco has one. Each is checked: a
  language in `INSTALLED` without its body or Monaco languages is a
  compile error (`Record<LanguageId, …>`). That stays, because
  `LanguageId` is the union of the installed keys, which only static
  imports give the compiler; a manifest per package would need its
  `index.ts` to import its body, which a host that loads bodies lazily
  does not want. What no longer needs editing is the boundaries test's
  count of language ids (17), which now compares the ids it reads from the
  sources with every package's exported `LANGUAGES`.
* **Rule 7 is enforced.** Step 6 said rules 3 to 7 were; 7 was not.
  boundaries.test.mjs now finds every `as` cast with TypeScript's parser
  (`as const` and comments aside; core/brand.ts exempt) and fails on one
  that `CASTS` does not list, by file and by the type cast to, with why;
  and on an entry no cast uses any more. There is no `MetaBinding.parse`
  or `languageOf` cast to exempt: both narrow without one. The language
  session's casts of a server's params are gone instead of listed: each
  handler reads its params through a guard (`isMessageParams`,
  `isProgress` and the rest), and a notification it cannot read is named
  in the log and ignored, where `$/progress` without a `value` threw inside
  the worker's message handler; a request it cannot read is answered
  `INVALID_PARAMS` (new in protocol/connection.ts). `retriggers` reads the
  error's data by `in`, without a cast.
* **The bundle baseline is main's again.** Step 6 recorded its own
  initial set (1,249,399 B) as the baseline, which made the 1% that steps
  2 to 5 used the floor for the next steps. `bundle-baseline.json` holds
  main's 1,242,711 B again, until a commit brings the set below it. After
  this review the set is 1,250,316 B (24 files), +0.61%, under the
  1,255,138 B budget; the guards above cost 379 B of it.
* **Not done: lazy bodies of the other languages.** Section 5 has Light
  import only the current language's body eagerly, and section 14 recorded
  that it imports them all. The bodies' chunk is 18,259 B gzip of the
  initial set (57,584 B raw). Making the others lazy is not a bundling
  change only: `Language.sample`, `configFiles`, `properties` and
  `settings` are read synchronously, by a new project and a language
  switch (project.ts `newProject`), the explorer's hidden files, the tidy
  rules' defaults and the build settings, so each would wait for a chunk
  where today it does not, a behaviour change N9 rules out for a review
  fix. It belongs with step 9's other on-use loads, and bundle.test.mjs's
  "bodies load with the page" is to be turned around in that commit.

## 17. Step 8 as built: a second host

Step 8 (decisions D10 and D11) built a host that is not Light's app,
`light/examples/two-up`, and moved `light/examples/hylo` onto core and std.
Where it departs from sections 2 to 5, D10 and D11:

* **`examples/two-up`**: two `createInstance` calls on one page, C++ alone
  and Python alone, each with the providers its package makes
  (`LANGUAGES.cpp.providers`, `LANGUAGES.python.providers`) and the
  language its spec describes (std's `packLanguage`, the body an
  `import()` of the package's `/body` that nothing on the page asks for).
  Both borrow one host (`src/host.ts`, a `PackHost`: one pool, one set of
  explorer workers, the packs' locator), so the page has one pool. C++ is
  edited in Monaco, Python in a textarea; one snippet module
  (`src/snippet.ts`) serves both, seeing an editor only as a core
  `Project` and `EditorPort` (the run's entry is the port's `path`), and
  enabling Run exactly where the instance says `run` is available. It
  imports no file of Light's app (a new boundaries rule holds every
  example to the shared modules by name, the npm packages it declares and
  its own files). D10's host was a `RunHost`: the packages' providers need
  a `PackHost` (section 16), and a host that takes them as they are is the
  better proof, so the explorer workers are there too, made only if a view
  asked (none does).
* **`@yukibana/editors`, entry `./textarea`** (`editors/textarea.ts`; the
  package has no root entry): `textareaEditor(element, path, hidden)`
  gives an `EditorPort<'textarea'>`, whose `native` is the element and
  whose one capability is the caret, and the one-document `Project` it
  edits, the hidden files beside it, a new revision and an `edited` change
  at every input. No language session, decorations or breakpoints (D10).
  It adds `EditorKinds['textarea']`, and names no language (rule 3).
* **`monaco/port.ts`: `monacoPort(editor, path)`**, `EditorKinds['monaco']`,
  the caret its one capability. With a kind in `EditorKinds` a `Subject` can
  be an editor's at last, so `subject.id` is no longer a `LanguageKey`
  alone: core names the two members, `LanguageSubject` and
  `EditorSubject`, and the app's `subjectOf` returns a `LanguageSubject`,
  which is what it always made. Two negatives in boundaries.test.mjs: a
  textarea port's `native` has no `getModel`, a Monaco port's no `value`.
* **core's `snapshotOf(files, revision = 0)`** (project.ts, the helper
  D11 asked for, a Project helper rather than a noun): a snapshot of a few
  files, copied when made, with no saved settings (every `meta` read is
  null). The textarea's project, two-up's Monaco project and Hylo's
  clicks perform on one. `tests/core-fakes.mjs` keeps its own, which takes
  metadata.
* **std's run host is split** (D11): `PoolHost = { pool }`, and
  `RunHost extends PoolHost` with `packs` and `requires`.
  `runProviderFrom<H extends PoolHost>(mode, key, source, when)` makes the
  run provider for a runner `source(host)` names, and `runProvider` is it
  with the pack's source (`sourceOf` over the host's locator), so the
  message, the pool and the handle are unchanged. D11 had it take a
  `LanguageMeta` and a source: the key is all the provider reads of the
  language, and a pack's source depends on the host, so `source` is a
  function of it.
* **Hylo's page performs through an instance** (`src/page.ts`): one
  `LanguageMeta` (`hylo`, no pack, `NO_PROPERTIES`), one provider
  (`runProviderFrom` over `{ pool }`, the page's host-built source, the
  same object for every run, so one runner as before), and each Run is
  `perform(run, { files, entry, options: null, snippet, onEvent },
  snapshotOf(files))`. What the page shows is unchanged; one timing is
  not: `perform` reaches the pool a microtask after the click (the
  instance awaits the body, even an eager one), in the order the clicks
  came, and the handle a microtask after the first states, as before. Its
  `package.json` (and lock) adds `file:` links to core and std. hylo-wasm
  could not be installed where this step was built, so Hylo's own build
  and e2e were not run here: its type-check passed but for hylo-wasm's
  own declarations, its unit tests passed, and its docs page, built with
  a stand-in runner worker over the real `HyloRunner`, ran two snippets
  together and one again in Chromium with one runner. CI runs the real
  one.
* **Monaco is lazy in two-up**, as section 6 has it for embeds: the page
  imports `src/cpp-editor.ts` by `import()`, so the Python snippet runs
  before Monaco arrives. A first load runs 19,369 B gzip of script,
  recorded in two-up's `bundle-budget.json` (+1%, as Light's gate). That
  is over section 5's 15 KB for `embed-min`: lang-cpp's `index.ts` brings
  its availability rules (refusals.ts, and through it the targets, the
  test frameworks' detector and the tidy rules), which a page of C++ needs
  for Run and Test to say what the runner would; no separate `embed-min`
  fixture was made, since two-up's initial set is the embed's, with no
  Monaco, no body and no Monaco integration in it.
* **The bundle fixtures read the build's own chunk list.** Two-up's
  `vite.config.ts` writes `dist/.vite/chunks.json` (every chunk's modules,
  static and dynamic imports), and `tests/bundle.test.mjs` checks the
  budget, that the initial set holds no Monaco and no body, that no module
  is in two chunks (so the second instance shares the first's core, std
  and runtime), and that Monaco is in one chunk, the C++ editor's, imported
  lazily. Monaco's chunk also carries all of @yukibana/monaco
  (bind, convert, internals), since its `package.json` does not say
  `sideEffects: false`; it is lazy, and changing it would move Light's
  chunks, so it stays for now.
* **No language server in two-up, so no "one clangd per page" check.**
  Binding clangd to Monaco needs `MonacoBinding` with the host's Monaco
  internals and services (section 15), which an embed would have to
  assemble as Light's `startEditor` does: a step of its own, with
  `ServerLeases` (deferred, D10). The check of "one runner per pack" is
  "never two runners of a pack at once": the C++ and Python runners end
  after every run (they never say `reusable`), so each run starts one, as
  in Light.
* **two-up's e2e is not in CI.** It needs the C++ and Python packs, which
  CI does not build; `test.mjs` runs where they are installed
  (`light/app/static/packs`, or `$PACKS`). CI's `two-up-example` job runs
  the type-check, the build and the bundle fixtures.
* **Light is unchanged**: its initial set is 1,250,360 B gzip (24 files),
  44 B more than after section 16 (monaco's port), under the 1,255,138 B
  budget.

## 18. Step 9 as built: the download, and what loads on use

Step 9 moved the download into std and the language packages (section 4's
row for `export.ts` and `export-tooling.ts`), made the debugger and the call
hierarchy load on use (D13), and left the languages' bodies as they were.
Where it departs from sections 2 to 5 and D13:

* **std's `export.ts`: two tokens and the CI model.** `exportBuild`
  (`Token<null, BuildSystem, 'many'>`, one entry per build system, keyed
  by its id, labelled as the dialog shows it, the usual one first) and
  `exportTooling` (`'one'`, a `LanguageTooling`: the image, the editors'
  extensions and indent, the format and lint jobs, the binaries and files
  the .gitignore leaves out, the README's instructions). The CI model the
  app had (`Environment`, `Extra`, `Step`, `JobSpec`, `LocalCheck`,
  `BuildCi`) moved with them; the app keeps `Job`, its composed form. A
  `BuildSystem` has no `id`, `label` or `fits`: the first two are its
  provider's entry, and whether it can build a project is its provider's
  `available`, read from the snapshot without loading the body (Kotlin's
  Maven only for Maven's layout, `lang-kotlin/layout.ts`).
* **core's `Instance.availabilityOf(subject, token, key, snapshot)`**, the
  twin of `performKey`: `availability` of a `'many'` token answers for the
  token, and the dialog lists only the build systems that can build the
  project, each asked alone. A `'one'` token is a `RangeError`, as for
  `performKey`.
* **Each package's `export.ts` is the body** (`EXPORTS`, by language key:
  `{ builds, tooling }`), moved from the app's `export.ts` and
  `export-tooling.ts` as they were, with `language.id` read as
  `language.key`, `Language` as `LanguageMeta` and `Project` as std's
  `ExportProject`. What more than one body uses (environments, steps,
  `testJob`, Spotless and its pins) is `@yukibana/std/export-kit`, an entry
  of its own that std's index does not import, so that a host importing
  std loads none of it.
* **The providers are an entry of their own, `/download`, not part of
  `providers`.** `exportProviders(language, builds, load)` makes them, and
  each package's `download.ts` gives one `LanguageDownloads` per language
  (`DOWNLOADS`); the app's `languages.ts` appends them to the package's
  providers. In `providers` they put two-up at 20,010 B, over its
  19,562 B budget: the factory, the tokens and the specs, and a chunk of
  core and std that rolldown split off once lang-cpp's export body
  shared it. A host that downloads nothing (an embed) now carries none of
  it: two-up is at 19,416 B, 47 B over step 8 for `availabilityOf`.
* **The app's `export.ts` is the aggregator**: `downloadOf` performs the
  tooling and each available build system, and `exportProject(download,
  files, …)` composes the README, the .gitignore, the CI services' files,
  the dev container and the editors' settings over them, as before. A
  language with no build system offered downloads with `NO_BUILD` (D7).
  The dialog (`Export.svelte`), `export.ts` and `zip.ts` load on the first
  Download, and the dialog opens once its code and the download's bodies
  have loaded: a first open waits for them, where the preview used to be
  computed at once.
* **The downloads are byte-identical to main's.** Every language, every
  sample and its variants (targets, sanitizers, own build files, levels),
  every build system, every CI service and option: 1,761 cases, their
  files and their zips (with a fixed date) hashed against main 236a5de,
  all equal. `tests/export-loaded.mjs` gives the Node tests
  (`export.mjs`, `export-ci.mjs`, the unit tests) the synchronous API they
  had, over the downloads the instance loads.
* **Stale comments left on purpose**: `packs/cpp/toolchains/libs/pins.sh`
  and the packs' READMEs still name `app/src/lib/export.ts` as where the
  libraries' pins are read. Editing them would re-key the packs' and
  toolchains' build caches for a comment; `export-pins.test.mjs` reads
  the new files (`lang-*/export.ts`, `std/export-kit.ts`).
* **D13: breakpoints are a small eager store.** `breakpoints.svelte.ts`
  holds `Breakpoints` (the lines by path, `toggle`, `move`) and `decorate`,
  which reads the stopped line through `BreakpointSession`, null until a
  session exists. `debug.svelte.ts` (the DAP client) loads on the first
  Debug (`Workspace.loadDebugger`) and makes itself the store's session;
  `workspace.debugger` is null until then, and `workspace.debugging`
  keeps Debug disabled while its code downloads. F9 before a first Debug
  sets a breakpoint, as before; the step keys do nothing until there is a
  session, as they did nothing without one. The Debug and Call Hierarchy
  panels are `LazyRenderer`s in `dock.ts`, and `call-hierarchy.svelte.ts`
  loads on the first Show Call Hierarchy. The `?trace` global
  `yukibanaDebugger` is a getter. SvelteKit still links the lazy
  components' CSS with the page (Debug 990 B, Call Hierarchy 715 B,
  Export 705 B), as it did RunOptions'.
* **Light's initial set is 1,218,325 B gzip in 39 files**, from 1,250,360 B
  in 24: below main's 1,242,711 B for the first time. More files, since
  rolldown puts what the page shares with the new lazy chunks into small
  chunks of their own. `bundle-baseline.json` keeps main's number (the
  reference) and records this one in its note. `bundle.test.mjs` checks
  that the download, the debugger and the call hierarchy are lazy chunks
  not in the first load.
* **Not done: lazy bodies of the languages.** Section 16's reason holds:
  a new project and a language switch read `sample`, `configFiles`,
  `properties` and `settings` synchronously, so a lazy body would make
  either wait where today it does not. They stay with the page, and
  bundle.test.mjs's "bodies load with the page" stays as it is.
* **Checked**: `npm run check`, the unit tests, the build and its bundle
  fixtures, two-up's type-check, build and fixtures, and the e2e suites
  (`e2e.mjs` over the installed packs, `e2e-debug`, `e2e-layout`,
  `e2e-links`, `e2e-targets`, `export.mjs`), which fail only where main
  fails.
