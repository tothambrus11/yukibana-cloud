// Importing a shared module changes nothing on the page (H2 of the
// architecture plan, the first rule of ../README.md): no listener, timer,
// global, `MonacoEnvironment`, style or service exists until a host calls
// for it. The modules load in Node as they are, so this runs them: the
// page's objects are tripwires that record any reach for them, the ways to
// listen or wait are recorded, and every module's entry point is imported.
//
// It runs in a process of its own (node --test gives each file one), so the
// tripwires never meet another test, and every module loads here first.
//
//   node --test light/modules/tests/imports.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** The entry points a host imports. */
const ENTRIES = ['../protocol/index.ts', '../runtime/index.ts', '../monaco/index.ts'];

/** What a module could reach for on a page, each a tripwire while the modules load. */
const PAGE = ['window', 'document', 'self', 'location', 'localStorage', 'sessionStorage', 'MonacoEnvironment', 'matchMedia', 'monaco'];

test('importing a shared module touches nothing of the page: no listener, timer, global or page object', async () => {
	const reached = [];
	const before = new Set(Reflect.ownKeys(globalThis));
	const restore = [];
	const wrap = (owner, name, label) => {
		const original = owner[name];
		owner[name] = function (...args) {
			reached.push(`${label} (${String(args[0]).slice(0, 40)})`);
			return original.apply(this, args);
		};
		restore.push(() => (owner[name] = original));
	};
	wrap(EventTarget.prototype, 'addEventListener', 'addEventListener');
	wrap(globalThis, 'setTimeout', 'setTimeout');
	wrap(globalThis, 'setInterval', 'setInterval');
	wrap(globalThis, 'queueMicrotask', 'queueMicrotask');
	for (const name of PAGE) {
		const own = Object.getOwnPropertyDescriptor(globalThis, name);
		Object.defineProperty(globalThis, name, {
			configurable: true,
			get() {
				reached.push(`reads ${name}`);
				return undefined;
			},
			set() {
				reached.push(`sets ${name}`);
			},
		});
		restore.push(() => (own ? Object.defineProperty(globalThis, name, own) : delete globalThis[name]));
	}
	try {
		for (const entry of ENTRIES) {
			const exports = await import(entry);
			assert.ok(Object.keys(exports).length > 0, `${entry} exports nothing: the test imported the wrong file`);
		}
	} finally {
		for (const undo of restore.reverse()) undo();
	}
	assert.deepEqual(reached, []);
	const added = Reflect.ownKeys(globalThis).filter((key) => !before.has(key));
	assert.deepEqual(added, [], 'globals the modules added on import');
});
