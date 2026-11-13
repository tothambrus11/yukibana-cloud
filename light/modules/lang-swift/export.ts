/**
 * A Swift project as it leaves the browser: Package.swift, and swift
 * format in CI.
 *
 * The body of the language's providers of @yukibana/std's `exportBuild` and
 * `exportTooling` (download.ts, `exportProviders`), loaded on a first download:
 * pure, the same project always giving the same files. Moved from the app's
 * export.ts and export-tooling.ts in step 9 of ../DESIGN.md, where the
 * download a host composes from these is described.
 */
import type { Files, LanguageMeta } from '../core/index.ts';
import type { LanguageExport, LanguageTooling } from '../std/export.ts';
import { env, sources, steps, testJob } from '../std/export-kit.ts';
import { SWIFT_LEVELS } from './properties.ts';

// ---- Swift: SwiftPM

/** Modules a test may import that are not the project (packs/swift/src/xctest.js). */
const NOT_THE_PROJECT = new Set(['XCTest', 'Testing', 'Foundation', 'FoundationEssentials', 'Dispatch', 'Glibc', 'Musl', 'Darwin', 'WASILibc', 'Swift', '_Concurrency', 'Synchronization', 'RegexBuilder']);

/** Where SwiftPM's tests are, and the browser's. */
const SWIFT_TESTS = 'Tests/';

/** The names a Swift file `@testable import`s, its comments and strings aside only roughly (a heuristic, as in the pack). */
function testableImports(text: string): string[] {
	const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
	return [...code.matchAll(/@testable\s+import\s+([A-Za-z_]\w*)/g)].map((m) => m[1]!).filter((name) => !NOT_THE_PROJECT.has(name));
}

/**
 * The module the project is, by the Swift pack's rule (projectModuleName):
 * the one name the project's files `@testable import`, else `App`. The pack
 * compiles project and tests as one module, `main` unless a test names it;
 * SwiftPM needs a real name, and `App` is the one SwiftPM's own templates
 * and the course layout use.
 */
export function swiftModuleName(files: Files): string {
	const names = new Set(Object.entries(files).filter(([p]) => p.endsWith('.swift')).flatMap(([, text]) => testableImports(text)));
	return names.size === 1 ? [...names][0]! : 'App';
}

/**
 * Package.swift for the project where it is. One executable target, named
 * after the module (swiftModuleName), from every .swift file outside Tests/,
 * main.swift included: the browser compiles them as one module, and SwiftPM
 * lets tests `@testable import` an executable target, so nothing has to be
 * split into a library and nothing moves. Its path is the package root, so
 * every other file there (README.md, compile settings, Tests/) is excluded by
 * name, or SwiftPM warns about each as "unhandled".
 *
 * A test target, `<Module>Tests`, from Tests/ when it has .swift files. In
 * the browser, tests see the project's declarations without an import, since
 * they are compiled into the same module. Here they are another module, so a
 * test file without `@testable import <Module>` would not compile: when any
 * test file lacks it, the target imports the module into every file with the
 * compiler's `-testable-import-module`. That is an unsafe flag, which SwiftPM
 * allows in a package that is built on its own (as this one is) but not in a
 * dependency; adding the import to the tests and deleting the setting is the
 * conventional form.
 *
 * Swift 5 language mode, as the browser's compiler uses (no -swift-version),
 * so code that compiles there does not meet Swift 6's strict concurrency
 * here. libm linked on Linux: `squareRoot()` and friends inline to `sqrt`,
 * which the Swift 6.4 toolchain's link line does not otherwise satisfy there.
 */
export function packageSwift(files: Files, paths: readonly string[], optimization: string | null = null): string {
	const module = swiftModuleName(files);
	const swift = Object.keys(files).filter((p) => p.endsWith('.swift')).sort();
	const sources = swift.filter((p) => !p.startsWith(SWIFT_TESTS));
	const tests = swift.filter((p) => p.startsWith(SWIFT_TESTS));
	const hidden = (p: string) => p.split('/').some((s) => s.startsWith('.'));
	const exclude = new Set<string>();
	for (const path of paths) {
		if (hidden(path) || path === 'Package.swift' || sources.includes(path)) continue;
		const top = path.split('/')[0]!;
		// A folder with no source in it goes as a whole; otherwise file by file.
		exclude.add(path.includes('/') && !sources.some((s) => s.startsWith(top + '/')) ? top : path);
	}
	const testExclude = paths.filter((p) => p.startsWith(SWIFT_TESTS) && !p.endsWith('.swift') && !hidden(p)).map((p) => p.slice(SWIFT_TESTS.length));
	const needsImport = tests.some((p) => !testableImports(files[p] ?? '').includes(module));
	const strings = (list: readonly string[], indent: string) => `[${list.map((s) => `\n${indent}    ${JSON.stringify(s)},`).join('')}\n${indent}]`;
	// A level other than the default goes to every configuration, as in the
	// browser; SwiftPM's own -Onone (debug) or -O (release) comes first.
	const level = SWIFT_LEVELS.find((l) => l.flag === optimization && !l.default)?.flag ?? null;
	const levelSetting = level ? [`            // The optimisation level chosen in the browser (${level}), in debug builds too.`, `            swiftSettings: [.unsafeFlags([${JSON.stringify(level)}])],`] : [];

	const targets = [
		[
			'        // The program: every .swift file outside Tests/, where it is.',
			'        .executableTarget(',
			`            name: ${JSON.stringify(module)},`,
			'            path: ".",',
			...(exclude.size ? [`            exclude: ${strings([...exclude].sort(), '            ')},`] : []),
			`            sources: ${strings(sources, '            ')},`,
			...levelSetting,
			'            linkerSettings: [.linkedLibrary("m", .when(platforms: [.linux]))]',
			'        ),',
		].join('\n'),
	];
	if (tests.length) {
		const testFlags = [...(level ? [level] : []), ...(needsImport ? ['-Xfrontend', '-testable-import-module', '-Xfrontend', module] : [])];
		targets.push(
			[
				'        // The tests in Tests/, with XCTest.',
				'        .testTarget(',
				`            name: ${JSON.stringify(module + 'Tests')},`,
				`            dependencies: [${JSON.stringify(module)}],`,
				`            path: ${JSON.stringify(SWIFT_TESTS.slice(0, -1))}${testExclude.length || testFlags.length ? ',' : ''}`,
				...(testExclude.length ? [`            exclude: ${strings(testExclude, '            ')}${testFlags.length ? ',' : ''}`] : []),
				...(needsImport
					? [
							`            // The tests use the program's declarations without \`@testable import ${module}\`,`,
							'            // as they can in the browser, where they are compiled into the same module.',
							'            // This adds that import to every test file; with the import written in the',
							'            // tests, this setting can go.',
						]
					: []),
				...(level ? [`            // The optimisation level chosen in the browser (${level}), as for the program.`] : []),
				...(testFlags.length ? [`            swiftSettings: [.unsafeFlags([${testFlags.map((f) => JSON.stringify(f)).join(', ')}])]`] : []),
				'        ),',
			].join('\n'),
		);
	}
	return [
		'// swift-tools-version:6.0',
		'// Builds the project where it is, with the layout it had in Yukibana Light:',
		`//   swift build && swift run${tests.length ? ' && swift test' : ''}`,
		'import PackageDescription',
		'',
		'let package = Package(',
		`    name: ${JSON.stringify(module)},`,
		'    targets: [',
		...targets,
		'    ],',
		'    // The language mode the browser compiles with.',
		'    swiftLanguageModes: [.v5]',
		')',
		'',
	].join('\n');
}

/**
 * The README's section for a Swift project whose swift.env names a Linux
 * target (packs/swift: the runner reads it, SwiftPM does not); none for the
 * default, WebAssembly, or a target the pack refuses. Read as the pack reads
 * it: KEY=value, # comments.
 */
function swiftTargetSection(env: string): string[] {
	let target: string | undefined;
	for (const line of env.split('\n').map((l) => l.trim())) {
		const [key, value] = line.split('=', 2);
		if (line && !line.startsWith('#') && key?.trim() === 'TARGET' && value !== undefined) target = value.trim();
	}
	const arch = target === 'x86_64-linux' ? 'x86_64' : target === 'aarch64-linux' ? 'aarch64' : undefined;
	if (arch === undefined) return [];
	return [
		`## Target\n\nIn Yukibana Light this project is built for Linux on ${arch} (\`swift.env\`): a static executable, linked against Swift's Static Linux SDK, run under QEMU. SwiftPM does not read \`swift.env\`; install the same SDK (swift.org, "Static Linux SDK") and name it:\n\n\`\`\`sh\nswift build --swift-sdk ${arch}-swift-linux-musl\n\`\`\`\n\nThe program in \`.build/${arch}-swift-linux-musl/debug/\` then runs on any ${arch} Linux machine, or elsewhere under \`qemu-${arch}\`.`,
	];
}

/** Whether a Swift project has tests: .swift files in Tests/. */
function swiftTests(files: Files): boolean {
	return Object.keys(files).some((p) => p.startsWith(SWIFT_TESTS) && p.endsWith('.swift'));
}

// ---- The toolchain

// ---- The download

/** How to build, run and test a Swift project with its usual build system, as README sections. */
function instructions(language: LanguageMeta, files: Files): string[] {
	const tests = swiftTests(files);
	return [
		'## Build and run\n\nWith Swift 6 (Xcode 16, or the toolchain from swift.org):\n\n```sh\nswift build\nswift run\n```',
		...(tests ? ['## Test\n\nThe tests in `Tests/` use XCTest:\n\n```sh\nswift test\n```'] : []),
		...swiftTargetSection(files['swift.env'] ?? ''),
		'## Editors\n\nXcode opens `Package.swift`; VS Code needs the Swift extension, which runs SourceKit-LSP.',
	];
}

/** The build systems of Swift projects, by key, the usual one first. */
const BUILDS = {
	swiftpm: {
		paths: ['Package.swift'],
		generate: (p) => ({ 'Package.swift': packageSwift(p.files, p.paths, p.optimization) }),
		ci: (p) => ({ ecosystems: ['swift'], prepare: 'swift package resolve', jobs: [testJob('Build and test', steps(['Build', 'swift build'], ...(swiftTests(p.files) ? [['Test', 'swift test'] as const] : [])))] }),
	},
} satisfies LanguageExport['builds'];

/** The tools of Swift projects. */
const TOOLING: LanguageTooling = {
	// The browser's Swift is 6.4.1 (packs/swift/build.sh). Not on Arch
	// Linux, so SourceHut runs Ubuntu with swift.org's release.
	environment: env('swift:6.4', {
		image: 'ubuntu/24.04',
		packages: ['binutils', 'git', 'libcurl4-openssl-dev', 'libedit2', 'libpython3-dev', 'libsqlite3-0', 'libxml2-dev', 'libz3-dev', 'pkg-config', 'tzdata', 'unzip', 'zlib1g-dev', 'gcc', 'libstdc++-13-dev'],
		setup: [
			'curl -fsSL https://download.swift.org/swift-6.4.1-release/ubuntu2404/swift-6.4.1-RELEASE/swift-6.4.1-RELEASE-ubuntu24.04.tar.gz | tar -xz -C /opt',
			'ln -s /opt/swift-6.4.1-RELEASE-ubuntu24.04/usr/bin/* /usr/local/bin/',
		],
	}),
	extensions: ['swiftlang.swift-vscode'],
	jobs: (files) =>
		sources(files, /\.swift$/).length
			? [
					{
						id: 'format',
						name: 'Format',
						steps: [{ name: 'swift format', run: 'swift format lint --strict --recursive .' }],
						local: { check: 'swift format lint --strict --recursive .', fix: 'swift format --in-place --recursive .' },
						files: { '.swift-format': `${JSON.stringify({ version: 1, indentation: { spaces: 4 }, lineLength: 100 }, null, 2)}\n` },
					},
				]
			: [],
	indent: 4,
	editorconfig: [],
	binary: [],
	ignored: () => ['.build/', '.swiftpm/', 'xcuserdata/', 'DerivedData/'],
	instructions,
};

/** The package's language's export, by key. */
export const EXPORTS = { swift: { builds: BUILDS, tooling: TOOLING } } satisfies Record<string, LanguageExport>;
