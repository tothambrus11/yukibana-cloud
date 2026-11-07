# @yukibana/lang-zig

Zig in Yukibana Light: a language package of `../DESIGN.md`
(section 3, step 6). It describes its languages and says what each can
do, as providers of `@yukibana/std`'s tokens; the pack
(`light/packs/zig`) is what runs them.

* **Cheap to import.** `index.ts` holds plain data and provider factories:
  importing it loads no body and sends nothing (`../tests/imports.test.mjs`
  imports every entry point with the page's objects as tripwires). A host
  makes each language with std's `packLanguage(spec, body)`, giving the
  body as it loads it: Light imports `./body` with the page; an embed
  imports it when the language is first used.
* **One package per pack, never another's.** It imports core, std, and Monaco's types alone, never
  another language package (`../boundaries.test.mjs`).

| File | Entry point | What |
|---|---|---|
| `index.ts` | `@yukibana/lang-zig` | `LANGUAGES`: each language's spec (std's `PackLanguageSpec`) and the providers it has (`providers(language)`) |
| `body.ts` | `@yukibana/lang-zig/body` | `BODIES`: each language's sample project, server settings, build settings (`PropertyModel`) and configuration files |
| `monaco.ts` | `@yukibana/lang-zig/monaco` | `MONACO_LANGUAGES`: the Monaco languages its server answers for, and the grammar Monaco lacks (`register…`; its tokenizer, `grammar.ts`, loads with the first model of the language) |
