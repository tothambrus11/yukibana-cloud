// Monaco's internals, through the one adapter that reaches them
// (monaco/internals.ts), and the canary that reads them again on every
// Monaco upgrade.
//
// The canary reads the installed monaco-editor's ESM sources (the app's
// copy, the one it bundles) with the TypeScript compiler's parser: for each
// entry of INTERNALS, the module still exists and exports the name, a
// service still has its id and its standalone class the members the adapter
// calls, a class or object still declares its members. Nothing of Monaco is
// loaded, since its modules need a page. It also fails on any version but
// CHECKED_WITH, because an internal can keep its name and change what it
// does: that takes a person reading it.
//
// The adapter itself runs on a fake Monaco that behaves as the real one's
// internals do where it matters: services start once, and replacements are
// taken only then and only for ids Monaco knows.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CHECKED_WITH, INTERNALS, MonacoInternalsError, internalsProblems, monacoInternals } from '../monaco/internals.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ts = createRequire(join(here, '../../app/package.json'))('typescript');
const MONACO = join(here, '../../app/node_modules/monaco-editor');

// ---------------------------------------------------------------------------
// The canary: what a module of Monaco's ESM tree declares.

/** The name of a declaration or property, when it is a plain one. */
const nameOf = (node) => (node && (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isPrivateIdentifier(node)) ? node.text : null);
const isStatic = (node) => (ts.getModifiers?.(node) ?? []).some((m) => m.kind === ts.SyntaxKind.StaticKeyword);

/** `this.<name> = …` assignments anywhere under `node`. */
function thisAssignments(node, into) {
	const visit = (n) => {
		if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && n.left.expression.kind === ts.SyntaxKind.ThisKeyword) {
			into.add(n.left.name.text);
		}
		ts.forEachChild(n, visit);
	};
	visit(node);
}

/** A class's own members, statics, fields and superclass name. */
function classInfo(node) {
	const info = { members: new Set(), statics: new Set(), fields: new Set(), extends: null };
	for (const clause of node.heritageClauses ?? []) {
		if (clause.token === ts.SyntaxKind.ExtendsKeyword) info.extends = nameOf(clause.types[0]?.expression);
	}
	for (const member of node.members) {
		if (ts.isClassStaticBlockDeclaration(member)) thisAssignments(member, info.statics);
		else if (ts.isConstructorDeclaration(member)) thisAssignments(member, info.fields);
		else if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
			(isStatic(member) ? info.statics : info.members).add(nameOf(member.name));
		} else if (ts.isPropertyDeclaration(member)) {
			(isStatic(member) ? info.statics : info.fields).add(nameOf(member.name));
		}
	}
	return info;
}

/**
 * What one JavaScript module declares: its exported names, the service ids
 * its `createDecorator` calls give each constant, its classes, and the
 * properties of its objects (literals, and namespaces filled by `X.y = …`).
 */
function declarations(path, source) {
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	const found = { exports: new Set(), services: new Map(), classes: new Map(), objects: new Map() };
	const objectOf = (name) => found.objects.get(name) ?? found.objects.set(name, new Set()).get(name);
	const visit = (node) => {
		if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
			for (const element of node.exportClause.elements) found.exports.add(element.name.text);
		} else if ((ts.isClassDeclaration(node) || ts.isVariableStatement(node) || ts.isFunctionDeclaration(node)) && (ts.getModifiers?.(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
			if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) found.exports.add(nameOf(d.name));
			else found.exports.add(nameOf(node.name));
		}
		if (ts.isClassDeclaration(node) && node.name) found.classes.set(node.name.text, classInfo(node));
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			const init = node.initializer;
			if (ts.isClassExpression(init)) found.classes.set(node.name.text, classInfo(init));
			else if (ts.isObjectLiteralExpression(init)) for (const p of init.properties) objectOf(node.name.text).add(nameOf(p.name));
			else if (ts.isCallExpression(init) && nameOf(init.expression) === 'createDecorator' && init.arguments[0] && ts.isStringLiteralLike(init.arguments[0])) {
				found.services.set(node.name.text, init.arguments[0].text);
			}
		}
		if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && ts.isIdentifier(node.left.expression)) {
			objectOf(node.left.expression.text).add(node.left.name.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found;
}

/** A class's members, statics and fields, its superclasses' in the same module included; null if it declares no such class. */
function classIn(found, name) {
	const own = found.classes.get(name);
	if (!own) return null;
	const parent = own.extends ? classIn(found, own.extends) : null;
	const union = (key) => new Set([...own[key], ...(parent?.[key] ?? [])]);
	return { members: union('members'), statics: union('statics'), fields: union('fields') };
}

/**
 * Every way the modules `read` returns differ from `table` (INTERNALS'
 * shape), as sentences naming the entry; `read(path)` is the source of
 * `esm/vs/<path>.js`, or null when there is no such file.
 */
function canaryProblems(read, table) {
	const problems = [];
	const cache = new Map();
	const load = (path) => {
		if (!cache.has(path)) {
			const source = read(path);
			cache.set(path, source === null ? null : declarations(path, source));
		}
		return cache.get(path);
	};
	const missing = (where, kind, wanted, have) => {
		for (const name of wanted ?? []) if (!have.has(name)) problems.push(`${where} has no ${kind}${name}`);
	};
	for (const [key, module] of Object.entries(table)) {
		const found = load(module.path);
		if (!found) {
			problems.push(`${key}: monaco-editor/${module.path}.js is gone`);
			continue;
		}
		for (const [name, spec] of Object.entries(module.exports)) {
			const where = `${key}: ${module.path} ${name}`;
			if (!found.exports.has(name)) {
				problems.push(`${where} is no longer exported`);
				continue;
			}
			if (spec.kind === 'service') {
				const id = found.services.get(name);
				if (id !== spec.id) problems.push(`${where} is ${id === undefined ? 'no longer made by createDecorator' : `the service '${id}'`}, not '${spec.id}'`);
				if (spec.implementedBy) {
					const { path, name: className, members } = spec.implementedBy;
					const implementation = load(path);
					const info = implementation && classIn(implementation, className);
					if (!info) problems.push(`${where} is no longer implemented by ${className} in ${path}`);
					else missing(`${where}'s ${className}`, '', members, info.members);
				}
			} else if (spec.kind === 'class') {
				const info = classIn(found, name);
				if (!info) {
					problems.push(`${where} is no longer a class`);
					continue;
				}
				missing(where, 'static ', spec.statics, info.statics);
				missing(where, '', spec.members, info.members);
				missing(where, 'field ', spec.fields, new Set([...info.fields, ...info.members]));
			} else {
				missing(where, '', spec.members, found.objects.get(name) ?? new Set());
			}
		}
	}
	return problems;
}

/** The installed monaco-editor's ESM source of `path`, or null. */
const installed = (path) => {
	const file = join(MONACO, 'esm/vs', `${path}.js`);
	return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

test('every internal of Monaco the adapter uses is still where it was, with the members the adapter calls', () => {
	assert.ok(existsSync(MONACO), 'light/app is installed (npm ci), so its Monaco can be read');
	assert.deepEqual(canaryProblems(installed, INTERNALS), []);
});

test('a Monaco upgrade fails until a person has read every internal again against it', () => {
	const { version } = JSON.parse(readFileSync(join(MONACO, 'package.json'), 'utf8'));
	assert.equal(
		version,
		CHECKED_WITH,
		`monaco-editor ${version} is installed, and monaco/internals.ts was read against ${CHECKED_WITH}: ` +
			"read each entry of INTERNALS (its `why` says what is relied on) in the new version's source, then set CHECKED_WITH",
	);
});

test('the canary names an internal that moved, lost a member, stopped being exported or became another service', () => {
	const table = {
		a: {
			path: 'a',
			exports: {
				IThing: { kind: 'service', id: 'thingService', implementedBy: { path: 'b', name: 'Thing', members: ['run', 'stop'] }, why: '' },
				Widget: { kind: 'class', statics: ['get', 'ID'], members: ['show', 'size'], fields: ['owner'], why: '' },
				Child: { kind: 'class', statics: ['convert'], members: ['show'], fields: ['owner', 'extra'], why: '' },
				Spaces: { kind: 'object', members: ['get', 'initialize'], why: '' },
				rules: { kind: 'object', members: ['rules'], why: '' },
				Gone: { kind: 'class', why: '' },
			},
		},
		moved: { path: 'nowhere', exports: {} },
	};
	const sources = {
		a: `
			import { createDecorator } from 'x';
			const IThing = createDecorator('otherService');
			let Widget = class Widget {
				static { this.ID = 'w'; }
				static get(editor) { return editor; }
				constructor() { this.owner = 1; }
				show() {}
				get size() { return 1; }
			};
			class Child extends Widget { static convert() {} }
			var Spaces;
			(function (Spaces) { function get() {} Spaces.get = get; })(Spaces || (Spaces = {}));
			const rules = { rules: [] };
			class Gone {}
			export { IThing, Widget, Child, Spaces, rules };
		`,
		b: 'class Thing { run() {} }\nexport { Thing };',
	};
	assert.deepEqual(canaryProblems((path) => sources[path] ?? null, table), [
		"a: a IThing is the service 'otherService', not 'thingService'",
		"a: a IThing's Thing has no stop",
		'a: a Child has no field extra',
		'a: a Spaces has no initialize',
		'a: a Gone is no longer exported',
		'moved: monaco-editor/nowhere.js is gone',
	]);
});

// ---------------------------------------------------------------------------
// The adapter, on a fake Monaco.

/** A service identifier as Monaco's createDecorator makes one. */
function serviceId(id) {
	const decorator = () => {};
	decorator.toString = () => id;
	return decorator;
}

/**
 * A Monaco whose internals have the shape INTERNALS names and behave as
 * Monaco's where the adapter depends on it. `log` records what reached
 * Monaco's own services.
 */
function fakeMonaco() {
	const log = [];
	const ids = {};
	for (const module of Object.values(INTERNALS)) {
		for (const [name, spec] of Object.entries(module.exports)) if (spec.kind === 'service') ids[name] = serviceId(spec.id);
	}
	const services = new Map([
		['labelService', { getUriLabel: (uri) => uri.path }],
		['notificationService', { monacos: true }],
		['dialogService', { monacos: true }],
		['listService', { lastFocusedList: undefined }],
		['quickInputService', { createQuickPick: () => ({ items: [] }) }],
		['commandService', { executeCommand: async (id, ...args) => log.push(['command', id, ...args]) }],
		['undoRedoService', { pushElement: (element, group, source) => log.push(['push', element, group, source]), removeElements: (uri) => log.push(['forget', uri]) }],
		['IWorkspaceEditService', { hasPreviewHandler: () => false, apply: async (edit, options) => (log.push(['monaco apply', edit, options]), { ariaSummary: '', isApplied: true }) }],
	]);
	let started = false;
	const StandaloneServices = {
		get(id) {
			if (!started) StandaloneServices.initialize({});
			const service = services.get(String(id));
			if (!service) throw new Error(`Missing service ${String(id)}`);
			return service;
		},
		// As Monaco's: once only, and an id it does not know is skipped without a word.
		initialize(overrides) {
			log.push(['initialize', Object.keys(overrides)]);
			if (started) return;
			started = true;
			for (const [id, service] of Object.entries(overrides)) if (services.has(id)) services.set(id, service);
		},
	};
	class StandaloneNotificationService {
		notify(notification) {
			log.push(['console', notification.message]);
			return 'no-op';
		}
	}
	class MessageController {
		static get(editor) {
			return editor.messages ? new MessageController(editor) : null;
		}
		constructor(editor) {
			this.editor = editor;
		}
		showMessage(message, position) {
			this.editor.messages.push([message, position]);
		}
	}
	class OneReference {}
	class SingleModelEditStackElement {
		constructor(label, code, model, selections) {
			Object.assign(this, { label, code, model, selections, closed: false });
		}
		close() {
			this.closed = true;
		}
	}
	class MultiModelEditStackElement {
		constructor(label, code, steps) {
			Object.assign(this, { label, code, steps, closed: false });
		}
		close() {
			this.closed = true;
		}
	}
	class ResourceEdit {
		static convert(edit) {
			return edit.edits.map((e) => ('textEdit' in e ? new ResourceTextEdit(e.resource, e.textEdit, e.versionId) : new ResourceFileEdit(e.oldResource, e.newResource)));
		}
	}
	class ResourceTextEdit extends ResourceEdit {
		constructor(resource, textEdit, versionId) {
			super();
			Object.assign(this, { resource, textEdit, versionId });
		}
	}
	class ResourceFileEdit extends ResourceEdit {
		constructor(oldResource, newResource) {
			super();
			Object.assign(this, { oldResource, newResource });
		}
	}
	const modules = {
		standaloneServices: { StandaloneServices, StandaloneNotificationService },
		label: { ILabelService: ids.ILabelService },
		notification: { INotificationService: ids.INotificationService },
		dialogs: { IDialogService: ids.IDialogService },
		messageController: { MessageController },
		list: { IListService: ids.IListService },
		quickInput: { IQuickInputService: ids.IQuickInputService },
		commands: { ICommandService: ids.ICommandService },
		references: { OneReference },
		undoRedo: { IUndoRedoService: ids.IUndoRedoService },
		editStack: { SingleModelEditStackElement, MultiModelEditStackElement },
		bulkEdit: { IBulkEditService: ids.IBulkEditService, ResourceEdit, ResourceTextEdit },
		themes: { vs: { rules: [{ token: 'comment', foreground: '008000' }] }, vs_dark: { rules: [{ token: 'comment', foreground: '6a9955' }] } },
	};
	return { modules, ids, services, log, classes: { OneReference, ResourceTextEdit } };
}

test("making the adapter over a host's Monaco checks it and starts none of its services", () => {
	const fake = fakeMonaco();
	monacoInternals(fake.modules);
	assert.deepEqual(fake.log, []);
	assert.deepEqual(internalsProblems(fake.modules), []);
});

test('a Monaco missing an internal, or with one renamed or changed, is refused with every problem named at once', () => {
	const fake = fakeMonaco();
	delete fake.modules.themes;
	fake.modules.list.IListService = serviceId('focusService');
	delete fake.modules.messageController.MessageController.prototype.showMessage;
	fake.modules.bulkEdit.ResourceEdit = { convert: 'not a class' };
	assert.throws(
		() => monacoInternals(fake.modules),
		(error) => {
			assert.ok(error instanceof MonacoInternalsError);
			assert.deepEqual(error.problems, [
				'monaco-editor/editor/contrib/message/browser/messageController MessageController has no showMessage',
				"monaco-editor/platform/list/browser/listService IListService names the service 'focusService', not 'listService'",
				'monaco-editor/editor/browser/services/bulkEditService ResourceEdit is not a class',
				"no module 'themes' (monaco-editor/editor/standalone/common/themes) was passed",
			]);
			assert.match(error.message, /monaco-editor 0\.57\.0/);
			return true;
		},
	);
});

test("the host's services replace Monaco's, and every notification still reaches the console before the host hears of it", () => {
	const fake = fakeMonaco();
	const internals = monacoInternals(fake.modules);
	const heard = [];
	const label = { getUriLabel: () => 'main.py', getUriBasenameLabel: () => 'main.py' };
	const bulkEdit = { hasPreviewHandler: () => false, apply: async () => ({ ariaSummary: 'mine', isApplied: true }) };
	const dialog = { prompt: async () => ({}), confirm: async () => ({ confirmed: true, checkboxChecked: false }), info: async () => {}, warn: async () => {}, error: async () => {} };
	internals.startServices({ label, bulkEdit, dialog, onNotification: (n) => heard.push(['host', n.message]) });
	assert.deepEqual(fake.log, [['initialize', ['labelService', 'notificationService', 'IWorkspaceEditService', 'dialogService']]]);
	assert.equal(fake.services.get('labelService'), label);
	assert.equal(fake.services.get('IWorkspaceEditService'), bulkEdit);
	assert.equal(fake.services.get('dialogService'), dialog);
	const notifications = fake.services.get('notificationService');
	assert.ok(notifications instanceof fake.modules.standaloneServices.StandaloneNotificationService);
	assert.equal(notifications.notify({ severity: 3, message: 'Rename failed' }), 'no-op');
	assert.deepEqual([...fake.log.slice(1), ...heard], [['console', 'Rename failed'], ['host', 'Rename failed']]);
});

test('a replacement Monaco did not take, because its services had already started, is named rather than ignored', () => {
	const fake = fakeMonaco();
	const internals = monacoInternals(fake.modules);
	internals.focusedList();
	const dialog = { prompt: async () => ({}), confirm: async () => ({ confirmed: true, checkboxChecked: false }), info: async () => {}, warn: async () => {}, error: async () => {} };
	assert.throws(
		() => internals.startServices({ dialog }),
		(error) => error instanceof MonacoInternalsError && error.problems.length === 1 && /kept its own dialogService/.test(error.problems[0]),
	);
});

test('a service that lost a method the adapter calls is named the first time it is used', () => {
	const fake = fakeMonaco();
	fake.services.set('quickInputService', {});
	const internals = monacoInternals(fake.modules);
	assert.throws(() => internals.createQuickPick(), /Monaco's quickInputService has no createQuickPick/);
});

test('an edit across files is one undo step in every file, and an edit of one file an ordinary step', () => {
	const fake = fakeMonaco();
	const internals = monacoInternals(fake.modules);
	const a = { model: 'a.py', selections: ['caret'] };
	const b = { model: 'b.py', selections: null };
	const across = internals.pushUndoStep('Renaming x to y', 'undoredo.workspaceEdit', [a, b], 'group', 'source');
	assert.deepEqual(
		across.steps.map((s) => [s.label, s.model, s.selections]),
		[
			['Renaming x to y', 'a.py', ['caret']],
			['Renaming x to y', 'b.py', null],
		],
	);
	const one = internals.pushUndoStep('Fix', 'code', [b]);
	assert.equal(one.model, 'b.py');
	assert.deepEqual(
		fake.log.filter(([what]) => what === 'push').map(([, element, group, source]) => [element, group, source]),
		[
			[across, 'group', 'source'],
			[one, undefined, undefined],
		],
	);
	assert.throws(() => internals.pushUndoStep('Nothing', 'code', []), RangeError);
	internals.forgetUndo('a.py');
	assert.deepEqual(fake.log.at(-1), ['forget', 'a.py']);
});

test("a workspace edit's text edits are read from Monaco's classes, and one that also creates a file is refused before any is applied", () => {
	const fake = fakeMonaco();
	const internals = monacoInternals(fake.modules);
	const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 };
	const text = { resource: 'a.py', textEdit: { range, text: 'y' }, versionId: 4 };
	assert.deepEqual(internals.textEditsOf({ edits: [text] }), [{ resource: 'a.py', range, text: 'y', versionId: 4 }]);
	assert.deepEqual(internals.textEditsOf([new fake.classes.ResourceTextEdit('b.py', { range, text: '' }, undefined)]), [{ resource: 'b.py', range, text: '', versionId: undefined }]);
	assert.throws(() => internals.textEditsOf({ edits: [text, { oldResource: undefined, newResource: 'new.py' }] }), /only text edits are supported, and this workspace edit has a ResourceFileEdit/);
});

test('a workspace edit goes through whichever bulk edit service Monaco has, as its own features do', async () => {
	const fake = fakeMonaco();
	const internals = monacoInternals(fake.modules);
	const result = await internals.applyWorkspaceEdit({ edits: [] }, { label: 'Rename' });
	assert.deepEqual(result, { ariaSummary: '', isApplied: true });
	assert.deepEqual(fake.log.at(-1), ['monaco apply', { edits: [] }, { label: 'Rename' }]);
});

test("the inline message, the peek's focused tree, its references and Monaco's commands are reached through the adapter", async () => {
	const fake = fakeMonaco();
	const internals = monacoInternals(fake.modules);
	const editor = { messages: [] };
	assert.equal(internals.showMessage(editor, 'No function here.', { lineNumber: 2, column: 3 }), true);
	assert.deepEqual(editor.messages, [['No function here.', { lineNumber: 2, column: 3 }]]);
	assert.equal(internals.showMessage({}, 'unseen', { lineNumber: 1, column: 1 }), false);
	assert.equal(internals.focusedList(), null);
	const tree = { getFocus: () => [] };
	fake.services.get('listService').lastFocusedList = tree;
	assert.equal(internals.focusedList(), tree);
	assert.equal(internals.isReference(new fake.classes.OneReference()), true);
	assert.equal(internals.isReference({ groups: [] }), false);
	await internals.executeCommand('openReference');
	assert.deepEqual(fake.log.at(-1), ['command', 'openReference']);
});

test("Monaco's light theme is vs and its dark theme vs-dark", () => {
	const fake = fakeMonaco();
	const { themeRules } = monacoInternals(fake.modules);
	assert.equal(themeRules.light, fake.modules.themes.vs.rules);
	assert.equal(themeRules.dark, fake.modules.themes.vs_dark.rules);
});
