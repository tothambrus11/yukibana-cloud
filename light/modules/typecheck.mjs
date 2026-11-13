// Type-checks every shared module as its own TypeScript project (README.md:
// each with only the globals it may use), in dependency order, with the
// app's TypeScript: `tsc -p <module>` for each directory list.mjs finds, so a
// new module is checked without anyone adding it here.
//
//   node light/modules/typecheck.mjs        (light/app: part of npm run check)
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { MODULES_DIR, modules } from './list.mjs';

const tsc = createRequire(join(MODULES_DIR, '../app/package.json')).resolve('typescript/bin/tsc');
const failed = [];
for (const module of modules()) {
	try {
		execFileSync(process.execPath, [tsc, '-p', join(MODULES_DIR, module.name)], { stdio: 'inherit' });
	} catch {
		failed.push(module.name);
	}
}
if (failed.length > 0) {
	console.error(`The type-check failed for ${failed.join(', ')}.`);
	process.exit(1);
}
