/**
 * A Go project as it leaves the browser: go.mod, and gofmt and go vet in
 * CI.
 *
 * The body of the language's providers of @yukibana/std's `exportBuild` and
 * `exportTooling` (download.ts, `exportProviders`), loaded on a first download:
 * pure, the same project always giving the same files. Moved from the app's
 * export.ts and export-tooling.ts in step 9 of ../DESIGN.md, where the
 * download a host composes from these is described.
 */
import type { Files, LanguageMeta } from '../core/index.ts';
import type { LanguageExport, LanguageTooling, Step } from '../std/export.ts';
import { env, steps, testJob } from '../std/export-kit.ts';

// ---- Go

/** The Go release the browser builds with (packs/go/build.sh, GO_VERSION), as go.mod's `go` line names it. */
const GO_VERSION = '1.27';

/**
 * The README's section for a Go project whose go.env names a Linux target
 * (packs/go: the runner reads it, the go command does not); none for the
 * default, WebAssembly. The lines are read as the pack reads them: KEY=value,
 * # comments.
 */
function goTargetSection(env: string): string[] {
	const values = new Map<string, string>();
	for (const line of env.split('\n').map((l) => l.trim())) {
		const [key, value] = line.split('=', 2);
		if (line && !line.startsWith('#') && key !== undefined && value !== undefined) values.set(key.trim(), value.trim());
	}
	const goarch = values.get('GOARCH');
	if (values.get('GOOS') !== 'linux' || goarch === undefined) return [];
	return [
		`## Target\n\nIn Yukibana Light this project is built for Linux on ${goarch} (\`go.env\`) and runs under QEMU. The go command does not read \`go.env\`; to build the same program, set the variables yourself:\n\n\`\`\`sh\nGOOS=linux GOARCH=${goarch} go build .\n\`\`\`\n\nThe program then runs on a ${goarch} Linux machine, or elsewhere under \`qemu-${goarch === 'amd64' ? 'x86_64' : goarch === 'arm64' ? 'aarch64' : goarch}\`.`,
	];
}

/** What `go build` in the module's root writes: the program, named after the module path's last element. */
function goBinaries(files: Files): string[] {
	const name = /^module\s+(\S+)/m.exec(files['go.mod'] ?? '')?.[1]?.split('/').at(-1) ?? 'example';
	return [`/${name}`];
}

// ---- The toolchain

/**
 * Go stamps a binary with the commit it was built from, which needs git to
 * read the checkout; a container's root does not own it, and git refuses to.
 */
const GO_SAFE_DIRECTORY: Step = { name: 'Trust the checkout', run: 'git config --global --add safe.directory "$PWD"' };

// ---- The download

/** How to build, run and test a Go project with its usual build system, as README sections. */
function instructions(language: LanguageMeta, files: Files): string[] {
	const paths = Object.keys(files);
	const tests = paths.some((p) => p.endsWith('_test.go'));
	return [
		`## Build and run\n\nWith Go ${GO_VERSION} or later (go.dev/dl):\n\n\`\`\`sh\ngo run .\n\`\`\``,
		...(tests ? ['## Test\n\n```sh\ngo test ./...\n```'] : []),
		...goTargetSection(files['go.env'] ?? ''),
		'## Editors\n\nVS Code (with the Go extension), GoLand and Zed open the folder; the first two run gopls, which reads `go.mod`.',
	];
}

/** The build systems of Go projects, by key, the usual one first. */
const BUILDS = {
	go: {
		paths: ['go.mod'],
		generate: () => ({ 'go.mod': `module example\n\ngo ${GO_VERSION}\n` }),
		ci: () => ({ ecosystems: ['gomod'], prepare: 'go mod download', jobs: [testJob('Build and test', [GO_SAFE_DIRECTORY, ...steps(['Build', 'go build ./...'], ['Test', 'go test ./...'])])] }),
	},
} satisfies LanguageExport['builds'];

/** The tools of Go projects. */
const TOOLING: LanguageTooling = {
	environment: env('golang:1.27', { image: 'archlinux', packages: ['go'], setup: [] }),
	extensions: ['golang.go'],
	jobs: () => [
		{ id: 'format', name: 'Format', steps: [{ name: 'gofmt', run: 'unformatted="$(gofmt -l .)"\nif [ -n "$unformatted" ]; then echo "Not formatted with gofmt:"; echo "$unformatted"; exit 1; fi' }], local: { check: 'gofmt -l .', fix: 'gofmt -w .' } },
		{
			id: 'lint',
			name: 'Vet',
			// go mod tidy -diff: go.mod and go.sum say what the code imports, no more and no less.
			steps: [GO_SAFE_DIRECTORY, { name: 'go vet', run: 'go vet ./...' }, { name: 'go mod tidy', run: 'go mod tidy -diff' }],
			local: { check: 'go vet ./... && go mod tidy -diff', fix: 'go mod tidy' },
		},
	],
	indent: 'tab',
	editorconfig: [],
	binary: [],
	ignored: (files) => ['*.exe', '*.test', '*.out', ...goBinaries(files)],
	instructions,
};

/** The package's language's export, by key. */
export const EXPORTS = { go: { builds: BUILDS, tooling: TOOLING } } satisfies Record<string, LanguageExport>;
