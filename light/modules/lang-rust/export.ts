/**
 * A Rust project as it leaves the browser: Cargo.toml, and rustfmt and
 * Clippy in CI.
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

// ---- Rust: Cargo

/**
 * A Cargo.toml for a project without one (the sample has its own). The
 * package is `app`, the crate name the browser's server and runner use
 * without a manifest, and edition 2021, the newest the browser's rustc
 * (1.78) knows. Cargo finds src/main.rs, src/lib.rs, src/bin/ and tests/ by
 * itself; a main.rs at the root, which the browser also runs, is named as
 * the binary.
 */
export function cargoToml(files: Files): string {
	const lines = ['[package]', 'name = "app"', 'version = "0.1.0"', 'edition = "2021"', ''];
	if (!('src/main.rs' in files) && 'main.rs' in files) lines.push('[[bin]]', 'name = "app"', 'path = "main.rs"', '');
	return lines.join('\n');
}

// ---- The toolchain

// ---- The download

/** How to build, run and test a Rust project with its usual build system, as README sections. */
function instructions(language: LanguageMeta, files: Files): string[] {
	const paths = Object.keys(files);
	const tests = paths.some((p) => /^tests\/[^/]+\.rs$/.test(p)) || Object.entries(files).some(([p, t]) => p.endsWith('.rs') && /#\[test\]/.test(t));
	return [
		'## Build and run\n\nWith Rust (rustup from rustup.rs installs cargo):\n\n```sh\ncargo run\n```\n\nThe browser runs the program with Miri on Rust 1.78, so code written there builds with that release or any later one.',
		...(tests ? ['## Test\n\nThe unit tests (`#[cfg(test)]` modules) and the integration tests in `tests/`:\n\n```sh\ncargo test\n```'] : []),
		'## Editors\n\nVS Code (with the rust-analyzer extension), RustRover and Zed open the folder and read `Cargo.toml`.',
	];
}

/** The build systems of Rust projects, by key, the usual one first. */
const BUILDS: LanguageExport['builds'] = {
	cargo: {
		paths: ['Cargo.toml'],
		generate: (p) => ({ 'Cargo.toml': cargoToml(p.files) }),
		ci: () => ({ ecosystems: ['cargo'], prepare: 'cargo fetch', jobs: [testJob('Build and test', steps(['Build', 'cargo build --all-targets'], ['Test', 'cargo test']))] }),
	},
};

/** The tools of Rust projects. */
const TOOLING: LanguageTooling = {
	// The image has cargo and rustc but neither rustfmt nor Clippy.
	environment: env('rust:1', { image: 'archlinux', packages: ['rust'], setup: [] }, { setup: ['rustup component add rustfmt clippy'] }),
	extensions: ['rust-lang.rust-analyzer'],
	jobs: () => [
		{ id: 'format', name: 'Format', steps: [{ name: 'rustfmt', run: 'cargo fmt --check' }], local: { check: 'cargo fmt --check', fix: 'cargo fmt' } },
		{ id: 'lint', name: 'Clippy', steps: [{ name: 'cargo clippy', run: 'cargo clippy --all-targets -- -D warnings' }], local: { check: 'cargo clippy --all-targets -- -D warnings', fix: 'cargo clippy --fix --all-targets' } },
	],
	indent: 4,
	editorconfig: [],
	binary: [],
	ignored: () => ['target/'],
	instructions,
};

/** The package's language's export, by key. */
export const EXPORTS = { rust: { builds: BUILDS, tooling: TOOLING } } satisfies Record<string, LanguageExport>;
