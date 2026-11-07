// Tells Node the shared modules' package names, as vite.config.ts's aliases
// tell Vite (both from ../../modules/list.mjs): `@yukibana/core`,
// `@yukibana/lang-cpp/body` and every other entry point a package.json
// exports resolve to their sources. Importing this file registers the hook
// and does nothing else.
//
// A static import is resolved before any module of its graph runs, so a
// script imports this file first and the app's files after it, with
// `await import(...)`:
//
//   import './modules-hook.mjs';
//   const { LANGUAGES } = await import('../src/lib/languages.ts');
import { registerHooks } from 'node:module';
import { sourceUrlOf } from '../../modules/list.mjs';

registerHooks({
	resolve(specifier, context, next) {
		const url = sourceUrlOf(specifier);
		return url === null ? next(specifier, context) : { url, shortCircuit: true };
	},
});
