// A download builds and tests with the same versions the browser does: each
// pin the download generators write (each language package's export.ts,
// std's export-kit.ts, and the app's src/lib/export.ts and
// src/lib/export-tooling.ts) that names something a pack also pins is
// checked against that pack's pin, read from the pack's own files, so
// upgrading a pack without its downloads (or the other way round) fails
// here rather than in a student's CI. Each pin is also defined once: a
// second copy is how ZIG_VERSION drifted into two files.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const app = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const light = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const SOURCES = [
	'src/lib/export.ts',
	'src/lib/export-tooling.ts',
	'../modules/std/export-kit.ts',
	...readdirSync(new URL('../../../modules/', import.meta.url))
		.filter((name) => name.startsWith('lang-') && existsSync(new URL(`../../../modules/${name}/export.ts`, import.meta.url)))
		.map((name) => `../modules/${name}/export.ts`),
];

/** Every `const NAME = '…'` (exported or not) of the generators, as [file, name, value]. */
function generatorPins() {
	const pins = [];
	for (const file of SOURCES) {
		for (const [, name, value] of app(file).matchAll(/^(?:export )?const ([A-Z][A-Z0-9_]*) = '([^']*)';/gm)) pins.push([file, name, value]);
	}
	return pins;
}

/** The value of `NAME=value` in a shell file (a pins.sh or a build.sh), or undefined. */
function shellPin(file, name) {
	const m = light(file).match(new RegExp(`^${name}=["']?([^"'\\s#]+)`, 'm'));
	return m?.[1];
}

/** The version a pack's package.json declares for `dep`. */
function packageVersion(file, dep) {
	const json = JSON.parse(light(file));
	return { ...json.dependencies, ...json.devDependencies }[dep];
}

const pin = (name) => {
	const found = generatorPins().filter(([, n]) => n === name);
	assert.equal(found.length, 1, `${name} is defined ${found.length} times in ${SOURCES.join(', ')}`);
	return found[0][2];
};

/** [generator pin, what the pack pins, where]. */
const SAME = [
	['GTEST_VERSION', () => shellPin('packs/cpp/toolchains/libs/pins.sh', 'GTEST_VERSION'), 'packs/cpp/toolchains/libs/pins.sh'],
	['GTEST_SHA256', () => shellPin('packs/cpp/toolchains/libs/pins.sh', 'GTEST_SHA256'), 'packs/cpp/toolchains/libs/pins.sh'],
	['CATCH2_VERSION', () => shellPin('packs/cpp/toolchains/libs/pins.sh', 'CATCH2_VERSION'), 'packs/cpp/toolchains/libs/pins.sh'],
	['CATCH2_COMMIT', () => shellPin('packs/cpp/toolchains/libs/pins.sh', 'CATCH2_COMMIT'), 'packs/cpp/toolchains/libs/pins.sh'],
	['DOCTEST_VERSION', () => shellPin('packs/cpp/toolchains/libs/pins.sh', 'DOCTEST_VERSION'), 'packs/cpp/toolchains/libs/pins.sh'],
	['DOCTEST_COMMIT', () => shellPin('packs/cpp/toolchains/libs/pins.sh', 'DOCTEST_COMMIT'), 'packs/cpp/toolchains/libs/pins.sh'],
	['ZIG_VERSION', () => shellPin('packs/zig/build.sh', 'ZIG_VERSION'), 'packs/zig/build.sh'],
	['SCALA_VERSION', () => shellPin('packs/scala/build.sh', 'SCALA_VERSION'), 'packs/scala/build.sh'],
	['SBT_VERSION', () => shellPin('packs/scala/build.sh', 'SBT_VERSION'), 'packs/scala/build.sh'],
	['SCALACHECK_VERSION', () => shellPin('packs/scala/build.sh', 'SCALACHECK_VERSION'), 'packs/scala/build.sh'],
	['JUNIT_VERSION', () => shellPin('packs/java/build.sh', 'JUNIT_VERSION'), 'packs/java/build.sh'],
	['PHPUNIT_VERSION', () => shellPin('packs/php/build.sh', 'PHPUNIT_VERSION'), 'packs/php/build.sh'],
	['ERIS_VERSION', () => shellPin('packs/php/build.sh', 'ERIS_VERSION'), 'packs/php/build.sh'],
	['STRYKER_VERSION', () => packageVersion('packs/javascript/package.json', '@stryker-mutator/core'), 'packs/javascript/package.json'],
	['FAST_CHECK_VERSION', () => packageVersion('packs/javascript/package.json', 'fast-check'), 'packs/javascript/package.json'],
	['TYPESCRIPT_VERSION', () => packageVersion('packs/javascript/package.json', 'typescript'), 'packs/javascript/package.json'],
	['P5_VERSION', () => packageVersion('packs/javascript/package.json', 'p5'), 'packs/javascript/package.json'],
	['VITE_VERSION', () => packageVersion('app/package.json', 'vite'), 'app/package.json'],
];

test('a download pins each tool the browser also runs at the version its pack pins', () => {
	for (const [name, theirs, where] of SAME) {
		const ours = pin(name);
		const value = theirs();
		assert.ok(value, `${where} pins no ${name}`);
		assert.equal(ours, value, `${name} is ${ours} in the download generators but ${value} in ${where}`);
	}
});

test("a download's go directive is the Go release the browser compiles with, without its patch number", () => {
	const browser = shellPin('packs/go/build.sh', 'GO_VERSION');
	assert.ok(browser, 'packs/go/build.sh pins no GO_VERSION');
	assert.equal(pin('GO_VERSION'), browser.split('.').slice(0, 2).join('.'));
});

test('no pin of the download generators is defined twice', () => {
	const seen = new Map();
	for (const [file, name] of generatorPins().filter(([, n]) => /_(?:VERSION|SHA256|COMMIT|SHA)$/.test(n))) {
		assert.ok(!seen.has(name), `${name} is defined in ${seen.get(name)} and again in ${file}`);
		seen.set(name, file);
	}
});
