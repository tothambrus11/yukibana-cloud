# @yukibana/monaco

A language session's results in the host's Monaco editor: converting between
LSP and Monaco, registering language features, keeping models for a chain of
files, the theme, and Monaco's editor services for a host that wants them.

## Contract

* The host's Monaco is injected (a `typeof monaco` argument). This module
  never bundles, configures or starts an editor, and never sets
  `MonacoEnvironment`.
* Importing it registers nothing. A feature or service exists from the call
  that registers it and is removed by disposing what that call returned.
* It never parses `yukibana.json`, and keeps nothing in `localStorage`.

## Allowed imports

Files of this module, `@yukibana/runtime` and `@yukibana/protocol`, by
relative paths ending in `.ts` or by the package name, and `import type`
from `monaco-editor`: a value import would bundle a second editor. Never
Svelte, dockview or `$app`.
