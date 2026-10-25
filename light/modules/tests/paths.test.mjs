// Where a workspace's files are (runtime/paths.ts): a project path, and the
// URI of that path under a root the host chooses.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseName, parentOf, pathProblem, workspaceRoot } from '../runtime/paths.ts';

const app = workspaceRoot('file:///workspace/');
const snippet = (n) => workspaceRoot(`inmemory://snippet-${n}/`);

test("a file's URI under the app's workspace names its path, and the path comes back from it", () => {
	assert.equal(app.uriOf('src/main.py'), 'file:///workspace/src/main.py');
	assert.equal(app.pathOf('file:///workspace/src/main.py'), 'src/main.py');
	assert.equal(app.pathOf({ scheme: 'file', authority: '', path: '/workspace/src/main.py' }), 'src/main.py');
	assert.equal(app.uriOf(''), 'file:///workspace/');
	assert.equal(app.pathOf('file:///workspace'), '');
	assert.equal(app.pathOf('file:///workspace/'), '');
	assert.equal(app.path, '/workspace/');
});

test('a name with a space, a hash or a percent sign stays one file, both ways', () => {
	for (const path of ['My Lib.hs', 'notes #1.md', '100%/a.txt', 'naïve.py']) {
		const uri = app.uriOf(path);
		assert.ok(!/[ #?]/.test(uri), uri);
		assert.equal(app.pathOf(uri), path);
		assert.equal(app.pathOf({ scheme: 'file', authority: '', path: decodeURIComponent(new URL(uri).pathname) }), path);
	}
});

test("a URI outside the workspace is no project file: a library, another scheme, a sibling folder, a bad escape", () => {
	assert.equal(app.pathOf('file:///usr/lib/ghc/Base.hs'), null);
	assert.equal(app.pathOf('file:///workspaces/a.py'), null);
	assert.equal(app.pathOf('inmemory://model/1'), null);
	assert.equal(app.pathOf('file://host/workspace/a.py'), null);
	assert.equal(app.pathOf('file:///workspace/a%E0.py'), null);
	assert.equal(app.pathOf('file:///workspace/a.py?x'), null);
	assert.equal(app.pathOf('FILE:///workspace/a.py'), 'a.py');
});

test("two snippets that both hold main.hylo give it two URIs, and each root claims only its own", () => {
	const one = snippet(1);
	const two = snippet(2);
	assert.notEqual(one.uriOf('main.hylo'), two.uriOf('main.hylo'));
	assert.equal(one.pathOf(one.uriOf('main.hylo')), 'main.hylo');
	assert.equal(one.pathOf(two.uriOf('main.hylo')), null);
	assert.equal(two.pathOf({ scheme: 'inmemory', authority: 'snippet-2', path: '/main.hylo' }), 'main.hylo');
	assert.equal(two.pathOf({ scheme: 'inmemory', authority: 'snippet-1', path: '/main.hylo' }), null);
});

test('a host that writes a root without its trailing slash, or with a query, is told so at once', () => {
	for (const bad of ['file:///workspace', 'file:///workspace/?x', 'workspace/', 'inmemory:', '']) {
		assert.throws(() => workspaceRoot(bad), RangeError, bad);
	}
});

test('a typed name that cannot be a project path says why, and one that can is accepted', () => {
	assert.equal(pathProblem('src/main.py'), null);
	assert.match(pathProblem(''), /empty/);
	assert.match(pathProblem('/etc/passwd'), /start or end/);
	assert.match(pathProblem('src/'), /start or end/);
	assert.match(pathProblem('a//b'), /not a valid name/);
	assert.match(pathProblem('../secrets'), /"\.\." is not a valid name/);
	assert.match(pathProblem('a:b'), /cannot contain/);
});

test("a path's folder and its own name", () => {
	assert.equal(parentOf('src/lib/a.py'), 'src/lib');
	assert.equal(parentOf('a.py'), '');
	assert.equal(baseName('src/lib/a.py'), 'a.py');
	assert.equal(baseName('a.py'), 'a.py');
});
