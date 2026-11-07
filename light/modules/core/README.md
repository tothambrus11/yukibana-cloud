# @yukibana/core

The embeddable core of Yukibana Light: typed tokens for what can be done
with a program (run it, test it, explore it), the providers that implement
them for a language or an editor kind, the instance that answers for them
over a project, and a project's settings as typed lenses. It has no
consumer yet: step 1 of `../DESIGN.md`, whose later steps move the app's
decisions onto it.

## Contract

* **No platform.** No DOM, worker, Node or network: `tsconfig.json` checks
  it with the language and `../protocol/platform.d.ts` alone, and
  `../boundaries.test.mjs` refuses `document`, `window`, `Worker`, `fetch`,
  `MessagePort` and the like in its code. It may import itself and
  protocol's types, nothing else.
* **No state and no side effects.** Importing it does nothing
  (`../tests/imports.test.mjs`); an instance holds only what it was made
  from, and two instances on a page share nothing but the host value they
  were each given.
* **A token is its object.** `defineToken<I, R>()('pkg#name', cardinality?)`
  makes a nominal, frozen token, invariant in its input. `createInstance`
  throws `Incoherent`, naming both sides, when two different tokens share an
  id (a package loaded twice), two providers of a `'one'` token serve one
  subject, two providers of a `'many'` token share a key, a provider's
  `entry` does not match its token's cardinality, a provider serves a
  language the instance lacks, or `requires` form a cycle.
* **Availability is a function of the project.** `has` is static and loads
  nothing; `availability` asks the provider's required tokens in order,
  then the provider, over a `ProjectSnapshot`, and returns the first
  `unavailable` with its reason. `perform` returns `unavailable` without
  loading anything when that is the answer.
* **Bodies load once, failures do not stick.** A `lazy` body's load is
  shared by every call made while it is in flight and kept once it
  resolves; a rejection is passed to those callers and forgotten, so the
  next call loads again.
* **A slot keeps the newest.** `slot(run)` runs at most one job at a time; a
  newer submit replaces a waiting job and supersedes the one in flight
  (its signal is aborted, its result discarded). A caller's abort before
  dispatch drops the job, after dispatch discards its result; an
  already-aborted signal is refused at once; listeners are removed when the
  job settles. `submit` never rejects.
* **Properties keep the file.** A `file` property's `write` keeps every
  byte it does not own, and text it cannot read is `unrecognised`, not the
  default; a `meta` property tells unset from default. `writeProperty`
  returns a `ProjectEdit` and changes nothing: the host applies it.

| File | What |
|---|---|
| `brand.ts` | `Brand`, `LanguageKey`, `Path`, `MetaKey` and the functions that make them (`languageKey`, `pathOf`, `metaKey`), `Disposable`, `JsonValue` |
| `token.ts` | `defineToken`, `Token`, `AnyToken`, `Cardinality`, `TokenId` |
| `provider.ts` | `Subject`, `Availability`, `Body` (`eager` \| `lazy`), `Entry`, `Provider`, `AnyProvider`, `provide`, `Context` |
| `language.ts` | `LanguageMeta` (the eager tier of a language) and `LanguageBody` |
| `instance.ts` | `createInstance`, `Incoherent`, `Instance`, `Outcome` |
| `project.ts` | `Project`, `ProjectSnapshot`, `ProjectChange`, `Files`, `MetaBinding` |
| `property.ts` | `Property`, `Storage` (`file` \| `meta`), `Read`, `readProperty`, `writeProperty`, `ProjectEdit`, `PropertyModel` |
| `slot.ts` | `slot`, `Slot`, `SlotResult` |
| `editor-port.ts` | `EditorPort`, `EditorKinds` (merged by editor packages), `EditorCapabilities`; types only |

`Path` follows the runtime's `pathProblem` (runtime/paths.ts), which stays
in the runtime until the core is published beside it;
`tests/core-instance.test.mjs` holds the two rules together.

Its tests are in `../tests/` (`core-instance`, `core-slot`,
`core-property`): `node --test "light/modules/**/*.test.mjs"`, or
`npm run test:unit` in `light/app`.
