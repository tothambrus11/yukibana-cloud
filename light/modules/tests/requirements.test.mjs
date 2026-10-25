// What a pack's workers need from the page, and the page's refusal when it
// lacks it (protocol/requirements.ts), decided from values before anything
// is downloaded.
//
//   node --test light/modules/          (Node 22.18 or later: loads the TypeScript source)
//
// The fixtures in fixtures/requires/ model what the packs are expected to
// declare (C++'s threaded language server and emulated Linux target,
// JavaScript's mutation testing) and what the Hylo site would ship in a
// pack.json of its own. They are test data, not the packs' declarations:
// those live in light/packs-meta/<pack>/requires.json, written and audited
// against every code path of each pack in their own step.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { needFor, parseRequires, PROTOCOL_MAJOR, protocolProblem, requirementLimitation, requirementProblem } from '../protocol/requirements.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(here, 'fixtures/requires', name), 'utf8'));

/** A fixture's needs, read as a session reads them; a fixture that does not parse fails the test that uses it. */
function requiresOf(value) {
	const parsed = parseRequires(value);
	assert.ok(parsed.ok, `the fixture parses: ${parsed.ok ? '' : parsed.problems.join('; ')}`);
	return parsed.requires;
}

const cpp = requiresOf(fixture('cpp.json'));
const javascript = requiresOf(fixture('javascript.json'));

/** Where a worker would start: an isolated page with its packs on its own origin, unless said otherwise. */
const context = (overrides = {}) => ({ crossOriginIsolated: true, packsSameOrigin: true, ...overrides });
const starting = (pack, worker, call) => ({ pack, worker, protocol: PROTOCOL_MAJOR, ...(call && { call }) });

test('a pack that ships its own pack.json is checked from it, with nothing in protocol naming it', () => {
	const pack = fixture('hylo-pack.json');
	const hylo = requiresOf(pack.requires);
	const need = needFor(hylo, 'runner', { request: 'run' });
	const what = { pack: pack.name, worker: 'runner', call: { request: 'run' }, protocol: pack.protocol };

	assert.equal(requirementProblem(need, what, context()), null);
	const refused = requirementProblem(need, what, context({ packsSameOrigin: false }));
	assert.equal(refused?.kind, 'unmet');
	assert.deepEqual(refused.missing, ['sameOriginPacks']);
	assert.match(refused.reason, /^Hylo's runner, to run a program, needs its pack served from the origin of the page/);

	// Nothing in the module's code (its identifiers and strings, not its
	// prose) names Hylo or any of Light's own packs: the needs came from the
	// pack, and a pack nobody here knows is checked the same way.
	const ts = createRequire(join(here, '../../app/package.json'))('typescript');
	const path = join(here, '../protocol/requirements.ts');
	const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
	const words = new Set();
	const visit = (node) => {
		if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
			for (const word of node.text.toLowerCase().split(/[^a-z+]+/)) words.add(word);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	const packs = readdirSync(join(here, '../../packs'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
	assert.ok(packs.includes('cpp'), 'the pack directories were found');
	for (const name of ['hylo', 'c++', ...packs]) assert.ok(!words.has(name), `requirements.ts names ${name} in its code`);
});

test('a pack that needs isolation is refused with a reason on a page that is not isolated, before anything is downloaded', () => {
	const fetched = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = (url) => {
		fetched.push(String(url));
		return Promise.reject(new Error('no download is expected'));
	};
	try {
		const problem = requirementProblem(needFor(cpp, 'lsp'), starting('C++', 'lsp'), context({ crossOriginIsolated: false }));
		assert.equal(problem?.kind, 'unmet');
		assert.deepEqual(problem.missing, ['crossOriginIsolated']);
		assert.match(problem.reason, /^C\+\+'s language server needs a cross-origin isolated page, and this one is not\./);
		assert.match(problem.reason, /Cross-Origin-Opener-Policy: same-origin/);
	} finally {
		globalThis.fetch = realFetch;
	}
	assert.deepEqual(fetched, []);
});

test('a C++ program for a Linux target is refused with a reason on a page that is not isolated, while a WebAssembly one runs', () => {
	const page = context({ crossOriginIsolated: false });
	const linux = { request: 'run', target: 'linux' };
	const refused = requirementProblem(needFor(cpp, 'runner', linux), starting('C++', 'runner', linux), page);
	assert.equal(refused?.kind, 'unmet');
	assert.deepEqual(refused.missing, ['crossOriginIsolated']);
	assert.match(refused.reason, /^C\+\+'s runner, to run a program for the linux target, needs a cross-origin isolated page/);

	const wasm = { request: 'run', target: 'wasm32-wasi' };
	assert.equal(requirementProblem(needFor(cpp, 'runner', wasm), starting('C++', 'runner', wasm), page), null);
	assert.equal(requirementProblem(needFor(cpp, 'runner', { request: 'run' }), starting('C++', 'runner'), page), null);
});

test('mutation testing is refused because the pack is on another origin, while tests run', () => {
	const elsewhere = context({ packsSameOrigin: false });
	const mutate = requirementProblem(needFor(javascript, 'runner', { request: 'mutate' }), starting('JavaScript', 'runner', { request: 'mutate' }), elsewhere);
	assert.equal(mutate?.kind, 'unmet');
	assert.deepEqual(mutate.missing, ['sameOriginPacks']);
	assert.match(mutate.reason, /^JavaScript's runner, to mutation-test, needs its pack served from the origin of the page that starts it/);
	for (const request of ['run', 'test']) {
		assert.equal(requirementProblem(needFor(javascript, 'runner', { request }), starting('JavaScript', 'runner', { request }), elsewhere), null, request);
	}
});

test('inside the runner frame a pack that starts its own workers runs, because the frame serves the packs from its own origin', () => {
	const frame = context({ crossOriginIsolated: true, packsSameOrigin: true });
	const linux = { request: 'run', target: 'linux' };
	assert.equal(requirementProblem(needFor(cpp, 'runner', linux), starting('C++', 'runner', linux), frame), null);
});

test('when a page lacks two things a worker needs, one reason names both, so fixing one does not uncover the other later', () => {
	const problem = requirementProblem(needFor(cpp, 'lsp'), starting('C++', 'lsp'), context({ crossOriginIsolated: false, packsSameOrigin: false }));
	assert.equal(problem?.kind, 'unmet');
	assert.deepEqual(problem.missing, ['crossOriginIsolated', 'sameOriginPacks']);
	assert.match(problem.reason, /isolated page, and this one is not\..* It also needs its pack served from the origin/);
});

test("a pack built for another protocol major is refused by name before its needs are read, whichever side is older", () => {
	const need = needFor(cpp, 'lsp');
	const newer = requirementProblem(need, { pack: 'C++', worker: 'lsp', protocol: PROTOCOL_MAJOR + 1 }, context());
	assert.deepEqual(
		{ kind: newer?.kind, pack: newer?.pack, page: newer?.page },
		{ kind: 'protocol', pack: PROTOCOL_MAJOR + 1, page: PROTOCOL_MAJOR },
	);
	assert.match(newer.reason, /this page's editor is older than its pack/);

	const older = requirementProblem(null, { pack: 'C++', worker: 'lsp', protocol: PROTOCOL_MAJOR - 1 }, context({ crossOriginIsolated: false }));
	assert.equal(older?.kind, 'protocol');
	assert.match(older.reason, /its pack is older than this page's editor/);
	assert.match(older.reason, new RegExp(`a build of it for protocol ${PROTOCOL_MAJOR}`));
});

test("a pack of a newer major whose needs this page cannot read is refused because the page is older, not because its needs are malformed", () => {
	// What a session does with a pack.json, in the order the module says.
	const pack = { name: 'C++', protocol: PROTOCOL_MAJOR + 1, requires: { runner: { default: { crossOriginIsolated: 'no', sameOriginPacks: false, webgpu: true } } } };
	assert.equal(parseRequires(pack.requires).ok, false, 'the fixture is a shape this page cannot read');

	const problem = protocolProblem({ pack: pack.name, protocol: pack.protocol });
	assert.equal(problem?.kind, 'protocol');
	assert.match(problem.reason, /^C\+\+ cannot start: this page's editor is older than its pack/);
	assert.match(problem.reason, /update the page's Yukibana modules/);
	assert.doesNotMatch(problem.reason, /webgpu|not a need/);

	assert.equal(protocolProblem({ pack: pack.name, protocol: PROTOCOL_MAJOR }), null, "a pack of the page's own major goes on to have its needs read");
	assert.deepEqual(protocolProblem(starting('C++', 'runner')), null, 'a Starting is asked as it is');
});

test('asking for a worker the pack does not have is refused by name, never taken as needing nothing', () => {
	const hylo = requiresOf(fixture('hylo-pack.json').requires);
	assert.equal(needFor(hylo, 'lsp'), null);
	assert.deepEqual(requirementProblem(needFor(hylo, 'lsp'), starting('Hylo', 'lsp'), context()), {
		kind: 'absent',
		reason: 'Hylo has no language server.',
	});
	assert.deepEqual(requirementProblem(needFor(javascript, 'explorer'), starting('JavaScript', 'explorer'), context()), {
		kind: 'absent',
		reason: 'JavaScript has no compiler explorer.',
	});
});

test('a request or target a pack does not list needs what its default needs, and a preview takes the default', () => {
	const fallback = { crossOriginIsolated: 'optional-stdin', sameOriginPacks: false };
	assert.deepEqual(needFor(cpp, 'runner', { request: 'test', target: 'riscv64-unknown-elf' }), fallback);
	assert.deepEqual(needFor(cpp, 'runner', {}), fallback);
	assert.deepEqual(needFor(javascript, 'runner', {}), fallback);
});

test('a request and a target together need the stricter of each, and neither can relax the default', () => {
	const requires = requiresOf({
		runner: {
			default: { crossOriginIsolated: 'optional-stdin', sameOriginPacks: false },
			requests: { test: { crossOriginIsolated: 'no' }, mutate: { sameOriginPacks: true } },
			targets: { linux: { crossOriginIsolated: 'required' }, wasm: { crossOriginIsolated: 'no', sameOriginPacks: false } },
		},
	});
	assert.deepEqual(needFor(requires, 'runner', { request: 'mutate', target: 'linux' }), { crossOriginIsolated: 'required', sameOriginPacks: true });
	assert.deepEqual(needFor(requires, 'runner', { request: 'test', target: 'wasm' }), { crossOriginIsolated: 'optional-stdin', sameOriginPacks: false });
	assert.deepEqual(needFor(requires, 'runner', { request: 'mutate', target: 'wasm' }), { crossOriginIsolated: 'optional-stdin', sameOriginPacks: true });
});

test("a target named like an object's built-in property is not mistaken for one the pack declared", () => {
	for (const target of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
		assert.deepEqual(needFor(cpp, 'runner', { request: 'run', target }), { crossOriginIsolated: 'optional-stdin', sameOriginPacks: false }, target);
	}
	// And one that is declared under such a name is read as data.
	const requires = requiresOf(JSON.parse('{"runner":{"default":{"crossOriginIsolated":"no","sameOriginPacks":false},"targets":{"__proto__":{"sameOriginPacks":true}}}}'));
	assert.deepEqual(needFor(requires, 'runner', { target: '__proto__' }), { crossOriginIsolated: 'no', sameOriginPacks: true });
	assert.deepEqual(needFor(requires, 'runner', { target: 'linux' }), { crossOriginIsolated: 'no', sameOriginPacks: false });
});

test('a program that cannot read input on this page is told so, and still runs', () => {
	const need = needFor(cpp, 'runner', { request: 'run' });
	const what = starting('C++', 'runner', { request: 'run' });
	const page = context({ crossOriginIsolated: false });
	assert.equal(requirementProblem(need, what, page), null);
	assert.match(requirementLimitation(need, what, page), /^C\+\+'s programs cannot read what is typed on this page.*end of file\.$/);
	assert.equal(requirementLimitation(need, what, context()), null);
	assert.equal(requirementLimitation(needFor(cpp, 'explorer'), starting('C++', 'explorer'), page), null);
});

test('a misspelt need is an error naming it, never read as a need for nothing', () => {
	const parsed = parseRequires({ lsp: { default: { crossOriginIsolation: 'required', sameOriginPacks: true } } });
	assert.equal(parsed.ok, false);
	assert.deepEqual(parsed.problems, [
		"lsp.default has 'crossOriginIsolation', which is not a need (crossOriginIsolated, sameOriginPacks)",
		'lsp.default does not say crossOriginIsolated; a default states both',
	]);
});

test("every problem in a pack's declaration is named at once, each by where it is", () => {
	const parsed = parseRequires({
		lsp: { default: { crossOriginIsolated: 'yes', sameOriginPacks: 'no' }, requests: {} },
		runner: {
			default: { crossOriginIsolated: 'no', sameOriginPacks: false },
			requests: { preview: { sameOriginPacks: true }, mutate: {} },
			targets: { linux: { crossOriginIsolated: 'always' }, '': { sameOriginPacks: true } },
			modes: {},
		},
		explorer: { crossOriginIsolated: 'no', sameOriginPacks: false },
		levels: {},
	});
	assert.equal(parsed.ok, false);
	assert.deepEqual(parsed.problems, [
		'lsp.default.crossOriginIsolated is "yes", not one of "no", "optional-stdin", "required"',
		'lsp.default.sameOriginPacks is "no", not true or false',
		"lsp has 'requests', but only a runner's needs vary by request or target",
		'runner.requests has "preview", which is not a request a runner is sent (run, test, mutate)',
		'runner.requests.mutate is empty; leave it out when it needs nothing beyond the default',
		'runner.targets.linux.crossOriginIsolated is "always", not one of "no", "optional-stdin", "required"',
		'runner.targets has "", an empty target name',
		"runner has 'modes', which is not default, requests or targets",
		'explorer has no default need',
		"explorer has 'crossOriginIsolated' itself; a need goes under explorer.default",
		"explorer has 'sameOriginPacks' itself; a need goes under explorer.default",
		"requires has 'levels', which is not a kind of worker (lsp, runner, explorer)",
	]);
});

test('reading a declaration never throws, whatever it is handed', () => {
	for (const value of [null, undefined, 1, 'requires', [], [{}], {}, { runner: null }, { runner: [] }, { runner: { default: [] } }, { runner: { default: null, targets: 3 } }]) {
		const parsed = parseRequires(value);
		assert.equal(parsed.ok, false, JSON.stringify(value));
		assert.ok(parsed.problems.length > 0);
	}
	assert.deepEqual(parseRequires({}).problems, ['requires names no worker; a pack has at least one of lsp, runner, explorer']);
});

test('a problem quotes a long value only in part', () => {
	const parsed = parseRequires({ runner: { default: { crossOriginIsolated: 'x'.repeat(500), sameOriginPacks: false } } });
	assert.equal(parsed.ok, false);
	assert.ok(parsed.problems[0].length < 150, parsed.problems[0]);
});

test('what a session is handed inline reads the same as what a pack.json carries', () => {
	const inline = { runner: { default: { crossOriginIsolated: 'optional-stdin', sameOriginPacks: true } } };
	assert.deepEqual(parseRequires(inline), { ok: true, requires: requiresOf(fixture('hylo-pack.json').requires) });
});
