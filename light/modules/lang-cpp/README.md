# @yukibana/lang-cpp

C and C++ in Yukibana Light: a language package of `../DESIGN.md`
(section 3, step 6). It describes its languages and says what each can
do, as providers of `@yukibana/std`'s tokens; the pack
(`light/packs/cpp`) is what runs them.

* **Cheap to import.** `index.ts` holds plain data and provider factories:
  importing it loads no body and sends nothing (`../tests/imports.test.mjs`
  imports every entry point with the page's objects as tripwires). A host
  makes each language with std's `packLanguage(spec, body)`, giving the
  body as it loads it: Light imports `./body` with the page; an embed
  imports it when the language is first used.
* **One package per pack, never another's.** It imports core, std, never
  another language package (`../boundaries.test.mjs`).

| File | Entry point | What |
|---|---|---|
| `index.ts` | `@yukibana/lang-cpp` | `LANGUAGES`: each language's spec (std's `PackLanguageSpec`) and the providers it has (`providers(language)`) |
| `body.ts` | `@yukibana/lang-cpp/body` | `BODIES`: each language's sample project, server settings, build settings (`PropertyModel`) and configuration files |
| `monaco.ts` | `@yukibana/lang-cpp/monaco` | `MONACO_LANGUAGES`: the Monaco languages its server answers for |
| `download.ts` | `@yukibana/lang-cpp/download` | `DOWNLOADS`: each language's providers of std's `exportBuild` and `exportTooling` (`LanguageDownloads`), apart from `providers` so that a host that downloads nothing loads none of them |
| `export.ts` | none: `download.ts`'s providers import it on a first download | `EXPORTS`: each language's build systems (the files each writes, its CI) and tools (its image, format checks, editors' settings, README sections), what a downloaded project is made of |
| `levels.ts` | `@yukibana/lang-cpp/levels` | read by name by the app's Build settings and pickers |
| `properties.ts` | `@yukibana/lang-cpp/properties` | read by name by the app's Build settings and pickers |
| `sanitizers.ts` | `@yukibana/lang-cpp/sanitizers` | read by name by the app's Build settings and pickers |
| `standards.ts` | `@yukibana/lang-cpp/standards` | read by name by the app's Build settings and pickers |
| `targets.ts` | `@yukibana/lang-cpp/targets` | read by name by the app's Build settings and pickers |
| `tests.ts` | `@yukibana/lang-cpp/tests` | read by name by the app's Build settings and pickers |
| `tidy.ts` | `@yukibana/lang-cpp/tidy` | read by name by the app's Build settings and pickers |
| `refusals.ts`, `views.ts` | through `index.ts` | when Test, Debug and Debug tests are unavailable, in the runner's words; the compiler output views |
