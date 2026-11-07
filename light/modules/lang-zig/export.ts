/**
 * A Zig project as it leaves the browser: build.zig, and zig fmt in CI.
 *
 * The body of the language's providers of @yukibana/std's `exportBuild` and
 * `exportTooling` (download.ts, `exportProviders`), loaded on a first download:
 * pure, the same project always giving the same files. Moved from the app's
 * export.ts and export-tooling.ts in step 9 of ../DESIGN.md, where the
 * download a host composes from these is described.
 */
import type { Files, LanguageMeta } from '../core/index.ts';
import type { LanguageExport, LanguageTooling } from '../std/export.ts';
import { env, steps, testJob } from '../std/export-kit.ts';

// ---- Zig

/**
 * build.zig for a project whose root is `entry`, as `zig init` writes one
 * without the library module: `zig build run` builds and runs it, `zig
 * build test` runs the tests `zig test <entry>` runs in the browser. The
 * target and optimize mode are zig build's options (-Dtarget, -Doptimize),
 * native and Debug unless given.
 */
export function buildZig(entry: string): string {
	return `const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const root_module = b.createModule(.{
        .root_source_file = b.path("${entry}"),
        .target = target,
        .optimize = optimize,
    });
    const exe = b.addExecutable(.{ .name = "main", .root_module = root_module });
    b.installArtifact(exe);

    const run = b.addRunArtifact(exe);
    run.step.dependOn(b.getInstallStep());
    run.addPassthruArgs();
    b.step("run", "Run the program").dependOn(&run.step);

    const tests = b.addTest(.{ .root_module = root_module });
    b.step("test", "Run the tests").dependOn(&b.addRunArtifact(tests).step);
}
`;
}

/**
 * The README's section for a Zig project whose zig.env names a target or an
 * optimize mode (packs/zig: the runner reads it, zig build does not); none
 * when it names neither. Read as the pack reads it: KEY=value, # comments.
 */
function zigTargetSection(env: string): string[] {
	const values = new Map<string, string>();
	for (const line of env.split('\n').map((l) => l.trim())) {
		const [key, value] = line.split('=', 2);
		if (line && !line.startsWith('#') && key !== undefined && value !== undefined) values.set(key.trim(), value.trim());
	}
	const target = values.get('TARGET');
	const optimize = values.get('OPTIMIZE');
	if (target === undefined && optimize === undefined) return [];
	const flags = [...(target ? [`-Dtarget=${target}`] : []), ...(optimize ? [`-Doptimize=${optimize}`] : [])].join(' ');
	const where = target === 'x86_64-linux' ? ' The program then runs on an x86-64 Linux machine, or elsewhere under `qemu-x86_64`.' : target === 'wasm32-wasi' ? ' The program then runs under a WASI runtime: `wasmtime zig-out/bin/main.wasm`.' : '';
	return [`## Target\n\nIn Yukibana Light this project is built with \`zig.env\`'s settings. zig build does not read \`zig.env\`; give them as options:\n\n\`\`\`sh\nzig build ${flags}\n\`\`\`\n${where}`];
}

/** Whether a Zig project has tests: a `test` block in some .zig file. */
function zigTests(files: Files): boolean {
	return Object.entries(files).some(([p, t]) => p.endsWith('.zig') && /^\s*test\b/m.test(t));
}

// ---- The toolchain

/**
 * The Zig release the browser builds with (packs/zig/build.sh, ZIG_VERSION;
 * tests/unit/export-pins.test.mjs keeps the two equal), which a download's
 * build.zig is written for, and its Linux releases' checksums, by `uname -m`.
 */
export const ZIG_VERSION = '0.17.0';
const ZIG_SHA256 = { x86_64: '1cbe9df9f27e6b78d14ccbca43b6703a404ef79ef1c463de901d7f088d4e2026', aarch64: '9e8d11661d4ae3bd57702a3832781e23ad151dde5798e16a5ccd503f65234ff8' };
/**
 * Zig's release for the machine's architecture (x86-64, or ARM64 for a dev
 * container on Apple silicon), checked, in /opt, on the PATH. One line, so
 * the architecture it reads is in scope for the rest.
 */
const ZIG_SETUP = [
	[
		'arch=$(uname -m)',
		`case "$arch" in ${Object.entries(ZIG_SHA256).map(([a, sha]) => `${a}) sha=${sha} ;;`).join(' ')} *) echo "no Zig for $arch" >&2; exit 1 ;; esac`,
		`curl -fsSL -o /tmp/zig.tar.xz https://ziglang.org/download/${ZIG_VERSION}/zig-$arch-linux-${ZIG_VERSION}.tar.xz`,
		'echo "$sha  /tmp/zig.tar.xz" | sha256sum -c -',
		'tar -xJf /tmp/zig.tar.xz -C /opt',
		'rm /tmp/zig.tar.xz',
		`ln -s /opt/zig-$arch-linux-${ZIG_VERSION}/zig /usr/local/bin/zig`,
	].join(' && '),
];

// ---- The download

/** How to build, run and test a Zig project with its usual build system, as README sections. */
function instructions(language: LanguageMeta, files: Files): string[] {
	const tests = zigTests(files);
	return [
		`## Build and run\n\nWith Zig ${ZIG_VERSION} (ziglang.org/download):\n\n\`\`\`sh\nzig build run\n\`\`\``,
		...(tests ? ['## Test\n\n```sh\nzig build test --summary all\n```'] : []),
		...zigTargetSection(files['zig.env'] ?? ''),
		'## Editors\n\nVS Code (with the Zig Language extension), Zed and Neovim run ZLS, which reads `build.zig`.',
	];
}

/** The build systems of Zig projects, by key, the usual one first. */
const BUILDS: LanguageExport['builds'] = {
	zig: {
		paths: ['build.zig'],
		generate: (p) => ({ 'build.zig': buildZig(p.language.entry) }),
		ci: (p) => ({ jobs: [testJob('Build and test', steps(['Build', 'zig build'], ...(zigTests(p.files) ? [['Test', 'zig build test --summary all'] as const] : [])))] }),
	},
};

/** The tools of Zig projects. */
const TOOLING: LanguageTooling = {
	// No Docker image of Zig's own: its release, checked, on Debian.
	environment: env(
		'debian:trixie',
		{ image: 'archlinux', packages: ['curl', 'xz'], setup: [] },
		{
			apt: ['ca-certificates', 'curl', 'xz-utils', 'git'],
			setup: ZIG_SETUP,
			sourcehut: { setup: ZIG_SETUP },
		},
	),
	extensions: ['ziglang.vscode-zig'],
	jobs: () => [{ id: 'format', name: 'Format', steps: [{ name: 'zig fmt', run: 'zig fmt --check .' }], local: { check: 'zig fmt --check .', fix: 'zig fmt .' } }],
	indent: 4,
	editorconfig: [],
	binary: [],
	ignored: () => ['zig-out/', '.zig-cache/'],
	instructions,
};

/** The package's language's export, by key. */
export const EXPORTS = { zig: { builds: BUILDS, tooling: TOOLING } } satisfies Record<string, LanguageExport>;
