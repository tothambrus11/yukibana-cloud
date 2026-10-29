/**
 * The languages the app offers. Each one names its pack (the directory under
 * `static/packs/` its server comes from), the Monaco languages that server
 * answers for, and the sample project a first visit starts with.
 */

/** Identifies a language, and with it a pack and a saved project. */
export type LanguageId = 'python' | 'javascript' | 'typescript' | 'web' | 'p5' | 'p5-global' | 'c' | 'cpp' | 'swift' | 'scala' | 'rust' | 'php' | 'java' | 'kotlin' | 'haskell' | 'go' | 'zig';

/** Project files by path relative to the workspace root, `/`-separated. */
export type Files = Record<string, string>;

export interface Language {
	id: LanguageId;
	/** Its full name, as the language picker's list, the Offline dialog and an exported project's README name it. */
	label: string;
	/**
	 * A short name for a narrow top bar, where the picker shows the chosen
	 * language in a word ("Web" for "Web (HTML, CSS, TypeScript)"); absent
	 * when `label` is already short. Read it through `shortLabel`.
	 */
	short?: string;
	/** Monaco language ids whose editor features the pack's server answers. */
	monacoLanguages: readonly string[];
	/** Answers to the server's `workspace/configuration` requests, by section. */
	settings: Record<string, unknown>;
	/** The file the editor opens first. */
	entry: string;
	/** What a fresh project contains. Files refer to each other on purpose. */
	sample: Files;
	/** Extension suggested for a new file. */
	extension: string;
	/**
	 * Whether the pack has a runner (`runner.js`) that can run the project
	 * from `entry`. When false, `cannotRun` says why, for the Run button.
	 */
	runs: boolean;
	cannotRun?: string;
	/**
	 * Whether the runner also takes `type: 'test'` (packs/CONTRACT.md,
	 * "Running a program"): it builds the project's tests instead of its
	 * program and runs them, with the same messages as a run.
	 */
	tests?: boolean;
	/**
	 * Whether the runner also takes `type: 'mutate'` (packs/CONTRACT.md,
	 * "Running a program"): mutation testing of the project against its
	 * tests, with a report and a mutation score, with the same messages as a
	 * run. Only with `tests`.
	 */
	mutates?: boolean;
	/**
	 * Whether the app keeps a runner started ahead of each Run (once the
	 * language server is up, and again after each run): for a runner whose
	 * own start-up is most of a run, as Haskell's (GHC loads in some 8 s,
	 * then compiles and runs a small program in under one).
	 */
	warmRunner?: boolean;
	/**
	 * The directory under `static/packs/` whose server and runner serve this
	 * language, when it is not `id`: TypeScript and web projects use the
	 * JavaScript pack's.
	 */
	pack?: string;
	/**
	 * For a web project, the page Run shows in the Preview panel (live
	 * reloaded as files change) instead of running `entry` in the terminal.
	 */
	preview?: string;
	/**
	 * The names of the project's configuration files, which the explorer
	 * hides until "Show configuration files" is on: a file of one of these
	 * names, in any folder, is one. They are the files the app's own
	 * controls edit (Build settings rewrites compile_flags.txt, the
	 * clang-tidy rules .clang-tidy), so a beginner never needs to open them;
	 * they stay in the project, the server reads them, Download includes
	 * them, and a tab open on one still shows.
	 */
	configFiles?: readonly string[];
}

/** A language's short name: `short` when it has one, else its label. */
export const shortLabel = (language: Language): string => language.short ?? language.label;

/**
 * The C++ sample's clang-tidy checks, which the editor runs as you type
 * (packs/cpp README, "clang-tidy"): the C++ Core Guidelines
 * (cppcoreguidelines-*), the checks that find bugs (bugprone-*), and the
 * modernize, performance and readability families, as Jason Turner's
 * cpp-best-practices starter project enables them, less the checks that are
 * noise in a small program or a lesson: swappable parameters, magic
 * numbers, do-while, recursion, public data members, [[nodiscard]] on every
 * getter, trailing return types, gsl::owner, printf's varargs (the samples
 * print with printf), indexing with a variable, short names, uppercase
 * literal suffixes, parentheses around arithmetic, and designated
 * initializers for every aggregate (`Point{.x = 1, .y = 2}` for a pair).
 * The sample is C++23, so modernize-use-std-print would move printf to
 * std::println; it is off because <print> costs a compile in the browser
 * about 3.5 s more at -O2 (1.2 s at -O0) and the object 170 KB, on every
 * Run (measured with the pack's clang 21). A check that needs a newer
 * standard than the project's is skipped by clang-tidy itself
 * (isLanguageVersionSupported), so these rules suit any -std=. Each line is a glob,
 * the last one that matches a check deciding, as clang-tidy reads them; the
 * rule editor (tidy-config.ts) rewrites the list and keeps the rest of the
 * file.
 */
export const CPP_TIDY = `# clang-tidy's checks: the editor runs them as you type. Change them with
# Build settings > clang-tidy rules, or here: each line is a glob, and the
# last one that matches a check decides (- turns it off).
Checks: >-
  -*,
  bugprone-*,
  -bugprone-easily-swappable-parameters,
  concurrency-*,
  -concurrency-mt-unsafe,
  cppcoreguidelines-*,
  -cppcoreguidelines-avoid-do-while,
  -cppcoreguidelines-avoid-magic-numbers,
  -cppcoreguidelines-non-private-member-variables-in-classes,
  -cppcoreguidelines-owning-memory,
  -cppcoreguidelines-pro-bounds-constant-array-index,
  -cppcoreguidelines-pro-type-vararg,
  misc-*,
  -misc-no-recursion,
  -misc-non-private-member-variables-in-classes,
  modernize-*,
  -modernize-use-designated-initializers,
  -modernize-use-nodiscard,
  -modernize-use-std-print,
  -modernize-use-trailing-return-type,
  performance-*,
  portability-*,
  readability-*,
  -readability-identifier-length,
  -readability-magic-numbers,
  -readability-math-missing-parentheses,
  -readability-uppercase-literal-suffix
`;

/**
 * The C sample's clang-tidy checks: as C++'s, with the SEI CERT C coding
 * standard (cert-*) in place of the C++ families, less unchecked printf
 * results (cert-err33-c) and implicit conversions to bool (`if (p)` is how
 * C says it).
 */
export const C_TIDY = `# clang-tidy's checks: the editor runs them as you type. Change them with
# Build settings > clang-tidy rules, or here: each line is a glob, and the
# last one that matches a check decides (- turns it off).
Checks: >-
  -*,
  bugprone-*,
  -bugprone-easily-swappable-parameters,
  cert-*,
  -cert-err33-c,
  concurrency-*,
  -concurrency-mt-unsafe,
  misc-*,
  -misc-no-recursion,
  performance-*,
  portability-*,
  readability-*,
  -readability-identifier-length,
  -readability-implicit-bool-conversion,
  -readability-magic-numbers,
  -readability-math-missing-parentheses,
  -readability-uppercase-literal-suffix
`;

/** How Format Document lays out C and C++ (clang-format, which clangd has built in): LLVM's style with the samples' four-space indent. */
export const CLANG_FORMAT = `# How Format Document lays out the code (clang-format's options:
# https://clang.llvm.org/docs/ClangFormatStyleOptions.html).
BasedOnStyle: LLVM
IndentWidth: 4
`;

/** C and C++ projects' configuration files: clangd's, clang-tidy's and clang-format's. */
const C_FAMILY_CONFIG = ['compile_flags.txt', 'compile_commands.json', '.clangd', '.clang-tidy', '.clang-format'] as const;

/** Whether a language is C or C++: both are the C++ pack's, and build with compile_flags.txt (cpp-targets.ts and its siblings). */
export function isCFamily(language: string): language is 'c' | 'cpp' {
	return language === 'c' || language === 'cpp';
}

export const LANGUAGES: readonly Language[] = [
	{
		id: 'python',
		label: 'Python',
		monacoLanguages: ['python'],
		settings: { python: { analysis: { typeCheckingMode: 'standard', diagnosticMode: 'workspace' } } },
		entry: 'main.py',
		extension: '.py',
		runs: true,
		tests: true,
		sample: {
			'main.py': `from geometry import Point, distance


def main() -> None:
    a = Point(0, 0)
    b = Point(3, 4)
    print(f"{a} to {b}: {distance(a, b)}")
    print(a.norm())


if __name__ == "__main__":
    main()
`,
			'geometry.py': `import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Point:
    """A point in the plane."""

    x: float
    y: float

    def norm(self) -> float:
        """Distance from the origin."""
        return math.hypot(self.x, self.y)


def distance(a: Point, b: Point) -> float:
    """Euclidean distance between two points."""
    return math.hypot(a.x - b.x, a.y - b.y)
`,
			'tests/test_geometry.py': `import dataclasses
import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from geometry import Point, distance

points = st.builds(Point, st.floats(-1e9, 1e9), st.floats(-1e9, 1e9))


def test_norm_of_3_4_is_5() -> None:
    assert Point(3, 4).norm() == 5


@given(points, points)
def test_distance_is_symmetric(a: Point, b: Point) -> None:
    assert distance(a, b) == distance(b, a)


@pytest.mark.parametrize(("x", "y", "expected"), [(0, 0, 0.0), (5, 12, 13.0), (1, 1, math.sqrt(2))])
def test_norm(x: float, y: float, expected: float) -> None:
    assert Point(x, y).norm() == pytest.approx(expected)


def test_points_are_immutable() -> None:
    p = Point(0, 0)
    with pytest.raises(dataclasses.FrozenInstanceError):
        setattr(p, "x", 1)
`,
		},
	},
	{
		id: 'javascript',
		label: 'JavaScript',
		monacoLanguages: ['javascript', 'typescript'],
		settings: {},
		entry: 'main.js',
		extension: '.js',
		runs: true,
		tests: true,
		mutates: true,
		sample: {
			'main.js': `// @ts-check
import { Point, distance } from './geometry.js';

const a = new Point(0, 0);
const b = new Point(3, 4);
console.log(\`\${a} to \${b}: \${distance(a, b)}\`);
console.log(a.norm().toFixed(2));
`,
			'geometry.js': `// @ts-check

/** A point in the plane. */
export class Point {
  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  /** Distance from the origin. */
  norm() {
    return Math.hypot(this.x, this.y);
  }

  toString() {
    return \`(\${this.x}, \${this.y})\`;
  }
}

/**
 * Euclidean distance between two points.
 * @param {Point} a
 * @param {Point} b
 */
export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
`,
			'tests/geometry.test.js': `// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { Point, distance } from '../geometry.js';

const coordinate = fc.double({ min: -1e9, max: 1e9, noNaN: true });
const point = fc.tuple(coordinate, coordinate).map(([x, y]) => new Point(x, y));

describe('Point', () => {
  it('has norm 5 at (3, 4)', () => {
    assert.equal(new Point(3, 4).norm(), 5);
  });

  it('prints as a pair', () => {
    assert.equal(String(new Point(1, 2)), '(1, 2)');
  });
});

describe('distance', () => {
  it('is symmetric', () => {
    fc.assert(fc.property(point, point, (a, b) => distance(a, b) === distance(b, a)));
  });

  it('is 0 from a point to itself', () => {
    const p = new Point(7, -3);
    assert.equal(distance(p, p), 0);
  });
});
`,
			'jsconfig.json': `{
  "compilerOptions": {
    "target": "es2023",
    "module": "es2022",
    "checkJs": true,
    "strict": true
  }
}
`,
		},
	},
	{
		// TypeScript as Node 22.18+ runs it: types stripped, imports with their
		// .ts extension, so the download runs with plain `node main.ts`.
		id: 'typescript',
		label: 'TypeScript',
		pack: 'javascript',
		monacoLanguages: ['typescript', 'javascript'],
		settings: {},
		entry: 'main.ts',
		extension: '.ts',
		runs: true,
		tests: true,
		mutates: true,
		sample: {
			'main.ts': `import { Point, distance, type Shape, area } from './geometry.ts';

const a = new Point(0, 0);
const b = new Point(3, 4);
console.log(\`\${a} to \${b}: \${distance(a, b)}\`);

const shapes: Shape[] = [
  { kind: 'circle', radius: 1 },
  { kind: 'square', side: 2 },
];
for (const shape of shapes) console.log(shape.kind, area(shape).toFixed(2));
`,
			'geometry.ts': `/** A point in the plane. */
export class Point {
  readonly x: number;
  readonly y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  /** Distance from the origin. */
  norm(): number {
    return Math.hypot(this.x, this.y);
  }

  toString(): string {
    return \`(\${this.x}, \${this.y})\`;
  }
}

/** Euclidean distance between two points. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A shape, told apart by its \`kind\`. */
export type Shape = { kind: 'circle'; radius: number } | { kind: 'square'; side: number };

/** The area of a shape; the switch covers every kind, which TypeScript checks. */
export function area(shape: Shape): number {
  switch (shape.kind) {
    case 'circle':
      return Math.PI * shape.radius ** 2;
    case 'square':
      return shape.side ** 2;
  }
}
`,
			'tests/geometry.test.ts': `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { Point, area, distance } from '../geometry.ts';

const coordinate = fc.double({ min: -1e9, max: 1e9, noNaN: true });
const point = fc.tuple(coordinate, coordinate).map(([x, y]) => new Point(x, y));

describe('Point', () => {
  it('has norm 5 at (3, 4)', () => {
    assert.equal(new Point(3, 4).norm(), 5);
  });

  it('prints as a pair', () => {
    assert.equal(String(new Point(1, 2)), '(1, 2)');
  });
});

describe('distance and area', () => {
  it('distance is symmetric', () => {
    fc.assert(fc.property(point, point, (a, b) => distance(a, b) === distance(b, a)));
  });

  it('a square of side 3 has area 9', () => {
    assert.equal(area({ kind: 'square', side: 3 }), 9);
  });
});
`,
			'tsconfig.json': `{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "noEmit": true
  }
}
`,
		},
	},
	{
		// A page: index.html, its stylesheet and its TypeScript, shown by Run
		// in the Preview panel and reloaded live; downloads as a Vite project.
		id: 'web',
		label: 'Web (HTML, CSS, TypeScript)',
		short: 'Web',
		pack: 'javascript',
		monacoLanguages: ['typescript', 'javascript'],
		settings: {},
		entry: 'main.ts',
		preview: 'index.html',
		extension: '.ts',
		runs: true,
		sample: {
			'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Counter</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <main>
      <h1>Hello from TypeScript</h1>
      <p>You clicked <output id="count">0</output> times.</p>
      <button id="increment" type="button">Click me</button>
    </main>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
`,
			'style.css': `:root {
  font-family: system-ui, sans-serif;
  color-scheme: light dark;
}

main {
  max-width: 32rem;
  margin: 3rem auto;
  padding: 0 1rem;
}

h1 {
  color: #2f7d5b;
}

button {
  font: inherit;
  padding: 0.4rem 1rem;
}
`,
			'main.ts': `import { Counter } from './counter.ts';

const output = document.querySelector<HTMLOutputElement>('#count')!;
const button = document.querySelector<HTMLButtonElement>('#increment')!;
const counter = new Counter();

button.addEventListener('click', () => {
  output.value = String(counter.increment());
  console.log(\`clicked \${counter.value} times\`);
});
console.log('page ready');
`,
			'counter.ts': `/** Counts clicks. */
export class Counter {
  #value = 0;

  /** How many times \`increment\` was called. */
  get value(): number {
    return this.#value;
  }

  /** Adds one and returns the new value. */
  increment(): number {
    return ++this.#value;
  }
}
`,
			'tsconfig.json': `{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2023", "dom", "dom.iterable"],
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "noEmit": true
  }
}
`,
		},
	},
	{
		// A web project whose page is a p5.js sketch: a canvas that fills the
		// window and a circle that follows the mouse. p5.js comes from the
		// JavaScript pack (packs/javascript/README.md, "Packages"): Preview
		// loads it, and the editor its types, only for a project that imports
		// it, so any web project may `import p5 from 'p5'`; this is the one
		// that starts with it. Instance mode, because there every p5 function
		// is a typed member of `p` and the sketch stays an ES module.
		id: 'p5',
		label: 'Web: p5.js sketch (TypeScript)',
		short: 'p5.js',
		pack: 'javascript',
		monacoLanguages: ['typescript', 'javascript'],
		settings: {},
		entry: 'main.ts',
		preview: 'index.html',
		extension: '.ts',
		runs: true,
		sample: {
			'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>p5.js sketch</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
`,
			'style.css': `/* The canvas fills the page: no margin, no scroll bars. */
html,
body {
  margin: 0;
  height: 100%;
  overflow: hidden;
}

/* A canvas is inline by default, which leaves a gap below it. */
canvas {
  display: block;
}
`,
			'main.ts': `import p5 from 'p5';

new p5((p: p5) => {
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.draw = () => {
    p.background('black');
    p.fill(0, 255, 255);
    p.circle(p.mouseX, p.mouseY, 100);
  };
});
`,
			'tsconfig.json': `{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2023", "dom", "dom.iterable"],
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
`,
		},
	},
	{
		// The same sketch in global mode, as p5.js's own editor and most of
		// its examples write it: setup() and draw() are plain functions and
		// every p5 function a global. The sketch is a classic script (a
		// module's functions are not globals), and p5.js, the same file
		// instance mode runs, is imported by an inline module that runs after
		// it; once the page has loaded, p5 finds setup() and draw() and starts.
		// The editor's types come from `p5/global`, a download of their own
		// that instance mode never makes (packs/javascript/README.md,
		// "Packages"), asked for by the project's tsconfig.json
		// (`"types": ["p5/global"]`), so the sketch needs no `/// <reference>`.
		id: 'p5-global',
		label: 'Web: p5.js sketch, global mode (TypeScript)',
		short: 'p5.js global',
		pack: 'javascript',
		monacoLanguages: ['typescript', 'javascript'],
		settings: {},
		entry: 'sketch.ts',
		preview: 'index.html',
		extension: '.ts',
		runs: true,
		sample: {
			'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>p5.js sketch</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <!-- A classic script, not a module, so that setup() and draw() are globals. -->
    <script src="./sketch.ts"></script>
    <!-- p5.js in global mode: once the page has loaded, it calls setup() and draw(). -->
    <script type="module">
      import p5 from 'p5';
      window.p5 = p5; // as p5.min.js would, for p5.Vector and the like
    </script>
  </body>
</html>
`,
			'style.css': `/* The canvas fills the page: no margin, no scroll bars. */
html,
body {
  margin: 0;
  height: 100%;
  overflow: hidden;
}

/* A canvas is inline by default, which leaves a gap below it. */
canvas {
  display: block;
}
`,
			'sketch.ts': `function setup() {
  createCanvas(windowWidth, windowHeight);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function draw() {
  background('black');
  fill(0, 255, 255);
  circle(mouseX, mouseY, 100);
}
`,
			'tsconfig.json': `{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2023", "dom", "dom.iterable"],
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["p5/global"]
  }
}
`,
		},
	},
	{
		// C on the C++ pack: the same clangd, compilers, sysroot and runner,
		// downloaded once for both (pack). What makes it C is its files
		// (.c), its -std=c23 in compile_flags.txt and its headers, which the
		// pack's server parses as C for a C project (packs/cpp/src/server.js,
		// rootConfig). Tests would be C++ (GoogleTest, Catch2 and doctest are
		// C++ frameworks) compiled with this project's C flags, so it has none.
		id: 'c',
		label: 'C',
		monacoLanguages: ['c', 'cpp'],
		pack: 'cpp',
		settings: {},
		entry: 'main.c',
		extension: '.c',
		configFiles: C_FAMILY_CONFIG,
		runs: true,
		sample: {
			'main.c': `#include <stdio.h>

#include "geometry.h"

int main(void) {
    const struct point a = {0.0, 0.0};
    const struct point b = {3.0, 4.0};
    printf("%f\\n", point_distance(a, b));
    printf("%f\\n", point_norm(b));
    return 0;
}
`,
			'geometry.h': `#ifndef GEOMETRY_H
#define GEOMETRY_H

/// A point in the plane.
struct point {
    double x;
    double y;
};

/// Distance from the origin.
double point_norm(struct point p);

/// Euclidean distance between two points.
double point_distance(struct point a, struct point b);

#endif
`,
			'geometry.c': `#include "geometry.h"

#include <math.h>

double point_norm(struct point p) { return hypot(p.x, p.y); }

double point_distance(struct point a, struct point b) {
    return hypot(a.x - b.x, a.y - b.y);
}
`,
			'compile_flags.txt': `-std=c23
-Wall
-Wextra
-I.
`,
			'.clang-tidy': C_TIDY,
			'.clang-format': CLANG_FORMAT,
		},
	},
	{
		id: 'cpp',
		label: 'C++',
		monacoLanguages: ['cpp', 'c'],
		pack: 'cpp',
		settings: {},
		entry: 'main.cpp',
		extension: '.cpp',
		configFiles: C_FAMILY_CONFIG,
		runs: true,
		tests: true,
		sample: {
			'main.cpp': `#include <cstdio>
#include <vector>

#include "geometry.h"

int main() {
    std::vector<Point> points{{0, 0}, {3, 4}};
    std::printf("%f\\n", distance(points[0], points[1]));
    std::printf("%f\\n", points[1].norm());
    return 0;
}
`,
			'geometry.h': `#pragma once

/// A point in the plane.
struct Point {
    double x;
    double y;

    /// Distance from the origin.
    double norm() const;
};

/// Euclidean distance between two points.
double distance(const Point &a, const Point &b);
`,
			'geometry.cpp': `#include "geometry.h"

#include <cmath>

double Point::norm() const { return std::hypot(x, y); }

double distance(const Point &a, const Point &b) {
    return std::hypot(a.x - b.x, a.y - b.y);
}
`,
			'tests/geometry_test.cpp': `#include <gtest/gtest.h>

#include "geometry.h"

TEST(Geometry, NormOfThreeFourIsFive) {
    const Point p{3, 4};
    EXPECT_DOUBLE_EQ(p.norm(), 5.0);
}

TEST(Geometry, DistanceIsSymmetric) {
    const Point a{1, 2};
    const Point b{-2, 6};
    EXPECT_DOUBLE_EQ(distance(a, b), distance(b, a));
    EXPECT_DOUBLE_EQ(distance(a, b), 5.0);
}

TEST(Geometry, DistanceToItselfIsZero) {
    const Point a{1.5, -2.5};
    EXPECT_EQ(distance(a, a), 0.0);
}
`,
			'compile_flags.txt': `-std=c++23
-Wall
-Wextra
-I.
`,
			'.clang-tidy': CPP_TIDY,
			'.clang-format': CLANG_FORMAT,
		},
	},
	{
		id: 'swift',
		label: 'Swift',
		monacoLanguages: ['swift'],
		settings: {},
		entry: 'main.swift',
		extension: '.swift',
		runs: true,
		tests: true,
		sample: {
			'main.swift': `let a = Point(x: 0, y: 0)
let b = Point(x: 3, y: 4)
print("\\(a) to \\(b): \\(distance(a, b))")
print(b.norm())
`,
			'Geometry.swift': `/// A point in the plane.
struct Point: CustomStringConvertible {
    var x: Double
    var y: Double

    /// Distance from the origin.
    func norm() -> Double {
        (x * x + y * y).squareRoot()
    }

    var description: String { "(\\(x), \\(y))" }
}

/// Euclidean distance between two points.
func distance(_ a: Point, _ b: Point) -> Double {
    Point(x: a.x - b.x, y: a.y - b.y).norm()
}
`,
			'Tests/GeometryTests.swift': `import XCTest
@testable import App

final class GeometryTests: XCTestCase {
    func testNorm() {
        XCTAssertEqual(Point(x: 3, y: 4).norm(), 5)
    }

    func testDistanceIsSymmetric() {
        let a = Point(x: 1, y: 2)
        let b = Point(x: -2, y: 6)
        XCTAssertEqual(distance(a, b), distance(b, a), accuracy: 1e-12)
    }
}
`,
		},
	},
	{
		id: 'scala',
		label: 'Scala',
		monacoLanguages: ['scala'],
		settings: {},
		entry: 'Main.scala',
		extension: '.scala',
		runs: true,
		sample: {
			'Main.scala': `@main def run(): Unit =
  val a = Point(0, 0)
  val b = Point(3, 4)
  println(s"$a to $b: \${distance(a, b)}")
  println(List(a, b).map(_.norm).sum)
`,
			'Geometry.scala': `/** A point in the plane. */
case class Point(x: Double, y: Double):
  /** Distance from the origin. */
  def norm: Double = math.hypot(x, y)

/** Euclidean distance between two points. */
def distance(a: Point, b: Point): Double =
  math.hypot(a.x - b.x, a.y - b.y)
`,
		},
	},
	{
		// Cargo's layout: a library (src/lib.rs) the binary (src/main.rs) and
		// the integration tests (tests/) use under the package's name, which
		// both the pack's server and its runner read from Cargo.toml. The
		// tests use quickcheck, a dev-dependency in Cargo.toml, which the pack
		// ships compiled for its Miri (packs/rust/README.md).
		id: 'rust',
		label: 'Rust',
		monacoLanguages: ['rust'],
		settings: {},
		entry: 'src/main.rs',
		extension: '.rs',
		runs: true,
		tests: true,
		sample: {
			'Cargo.toml': `[package]
name = "geometry"
version = "0.1.0"
edition = "2021"

[dev-dependencies]
quickcheck = "1"
`,
			'src/main.rs': `use geometry::{distance, Point};

fn main() {
    let a = Point::new(0.0, 0.0);
    let b = Point::new(3.0, 4.0);
    println!("{a} to {b}: {}", distance(a, b));
    println!("{}", b.norm());
}
`,
			'src/lib.rs': `//! Points in the plane.

mod point;

pub use point::{distance, Point};
`,
			'src/point.rs': `use std::fmt;

/// A point in the plane.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    /// The point at \`(x, y)\`.
    pub fn new(x: f64, y: f64) -> Self {
        Point { x, y }
    }

    /// Distance from the origin.
    pub fn norm(&self) -> f64 {
        self.x.hypot(self.y)
    }
}

impl fmt::Display for Point {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "({}, {})", self.x, self.y)
    }
}

/// Euclidean distance between two points.
pub fn distance(a: Point, b: Point) -> f64 {
    Point::new(a.x - b.x, a.y - b.y).norm()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn norm_of_3_4_is_5() {
        assert_eq!(Point::new(3.0, 4.0).norm(), 5.0);
    }
}
`,
			'tests/geometry.rs': `use geometry::{distance, Point};
use quickcheck::quickcheck;

quickcheck! {
    // A property: quickcheck tries it on 100 random points and, if one
    // fails, shrinks it to the simplest failing input it can find.
    fn distance_is_symmetric(ax: i32, ay: i32, bx: i32, by: i32) -> bool {
        let a = Point::new(ax as f64, ay as f64);
        let b = Point::new(bx as f64, by as f64);
        distance(a, b) == distance(b, a)
    }
}

#[test]
fn distance_to_itself_is_zero() {
    let p = Point::new(1.5, -2.5);
    assert_eq!(distance(p, p), 0.0);
}

#[test]
fn points_print_as_pairs() {
    assert_eq!(Point::new(1.0, 2.5).to_string(), "(1, 2.5)");
}
`,
		},
	},
	{
		// Plain PHP files with require_once, as `php main.php` runs them, and
		// PHPUnit tests in tests/. The runner's Test autoloads the project's
		// classes with a class map, as the downloaded composer.json does.
		id: 'php',
		label: 'PHP',
		monacoLanguages: ['php'],
		settings: {},
		entry: 'main.php',
		extension: '.php',
		runs: true,
		tests: true,
		sample: {
			'main.php': `<?php

declare(strict_types=1);

require_once __DIR__ . '/geometry.php';

use Geometry\\Point;

use function Geometry\\distance;

$a = new Point(0, 0);
$b = new Point(3, 4);
echo "{$a} to {$b}: " . distance($a, $b) . "\\n";
echo $b->norm() . "\\n";
`,
			'geometry.php': `<?php

declare(strict_types=1);

namespace Geometry;

/** A point in the plane. */
final class Point
{
    public function __construct(
        public readonly float $x,
        public readonly float $y,
    ) {
    }

    /** Distance from the origin. */
    public function norm(): float
    {
        return hypot($this->x, $this->y);
    }

    public function __toString(): string
    {
        return "({$this->x}, {$this->y})";
    }
}

/** Euclidean distance between two points. */
function distance(Point $a, Point $b): float
{
    return hypot($a->x - $b->x, $a->y - $b->y);
}
`,
			'tests/GeometryTest.php': `<?php

declare(strict_types=1);

namespace Geometry\\Tests;

use Geometry\\Point;
use PHPUnit\\Framework\\Attributes\\DataProvider;
use PHPUnit\\Framework\\TestCase;

use function Geometry\\distance;

require_once __DIR__ . '/../geometry.php';

final class GeometryTest extends TestCase
{
    public function testNormOfThreeFourIsFive(): void
    {
        $this->assertSame(5.0, (new Point(3, 4))->norm());
    }

    public function testDistanceIsSymmetric(): void
    {
        $a = new Point(1, 2);
        $b = new Point(-2, 6);
        $this->assertSame(distance($a, $b), distance($b, $a));
    }

    /** @return iterable<string, array{float, float, float}> */
    public static function norms(): iterable
    {
        yield 'origin' => [0, 0, 0.0];
        yield '5-12-13' => [5, 12, 13.0];
    }

    #[DataProvider('norms')]
    public function testNorm(float $x, float $y, float $expected): void
    {
        $this->assertEqualsWithDelta($expected, (new Point($x, $y))->norm(), 1e-12);
    }

    public function testPrintsAsAPair(): void
    {
        $this->assertSame('(1, 2)', (string) new Point(1, 2));
    }
}
`,
		},
	},
	{
		// Maven's layout (the downloaded pom.xml builds it as it is): the
		// program in src/main/java, JUnit 5 tests in src/test/java, one
		// package. The runner runs src/main/java only, and adds the tests
		// for Test.
		id: 'java',
		label: 'Java',
		monacoLanguages: ['java'],
		settings: {},
		entry: 'src/main/java/geometry/Main.java',
		extension: '.java',
		runs: true,
		tests: true,
		sample: {
			'src/main/java/geometry/Main.java': `package geometry;

public class Main {
    public static void main(String[] args) {
        var a = new Point(0, 0);
        var b = new Point(3, 4);
        System.out.println(a + " to " + b + ": " + Geometry.distance(a, b));
        System.out.println(b.norm());
    }
}
`,
			'src/main/java/geometry/Point.java': `package geometry;

/** A point in the plane. */
public record Point(double x, double y) {
    /** Distance from the origin. */
    public double norm() {
        return Math.hypot(x, y);
    }
}
`,
			'src/main/java/geometry/Geometry.java': `package geometry;

/** Functions of points. */
public final class Geometry {
    private Geometry() {}

    /** Euclidean distance between two points. */
    public static double distance(Point a, Point b) {
        return Math.hypot(a.x() - b.x(), a.y() - b.y());
    }
}
`,
			'src/test/java/geometry/GeometryTest.java': `package geometry;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class GeometryTest {
    @Test
    void normOfThreeFourIsFive() {
        assertEquals(5.0, new Point(3, 4).norm());
    }

    @Test
    void distanceIsSymmetric() {
        var a = new Point(1, 2);
        var b = new Point(-2, 6);
        assertEquals(Geometry.distance(a, b), Geometry.distance(b, a));
        assertEquals(5.0, Geometry.distance(a, b));
    }

    @Test
    void distanceToItselfIsZero() {
        var p = new Point(1.5, -2.5);
        assertEquals(0.0, Geometry.distance(p, p));
    }
}
`,
		},
	},
	{
		// Gradle's layout (the downloaded build.gradle.kts builds it as it
		// is): the program in src/main/kotlin, kotlin.test tests in
		// src/test/kotlin. The real kotlinc, compiled to WebAssembly, checks
		// it and builds it for Kotlin/Wasm (WASI), which Run and Test run in
		// the browser (packs/kotlin/README.md).
		id: 'kotlin',
		label: 'Kotlin',
		monacoLanguages: ['kotlin'],
		settings: {},
		entry: 'src/main/kotlin/Main.kt',
		extension: '.kt',
		runs: true,
		tests: true,
		warmRunner: true,
		sample: {
			'src/main/kotlin/Main.kt': `fun main() {
    val a = Point(0.0, 0.0)
    val b = Point(3.0, 4.0)
    println("$a to $b: \${distance(a, b)}")
    println(b.norm())
}
`,
			'src/main/kotlin/Geometry.kt': `import kotlin.math.hypot

/** A point in the plane. */
data class Point(val x: Double, val y: Double) {
    /** Distance from the origin. */
    fun norm(): Double = hypot(x, y)
}

/** Euclidean distance between two points. */
fun distance(a: Point, b: Point): Double = hypot(a.x - b.x, a.y - b.y)
`,
			'src/test/kotlin/GeometryTest.kt': `import kotlin.test.Test
import kotlin.test.assertEquals

class GeometryTest {
    @Test
    fun normOfThreeFourIsFive() {
        assertEquals(5.0, Point(3.0, 4.0).norm())
    }

    @Test
    fun distanceIsSymmetric() {
        val a = Point(1.0, 2.0)
        val b = Point(-2.0, 6.0)
        assertEquals(distance(a, b), distance(b, a))
        assertEquals(5.0, distance(a, b))
    }

    @Test
    fun distanceToItselfIsZero() {
        val p = Point(1.5, -2.5)
        assertEquals(0.0, distance(p, p))
    }
}
`,
		},
	},
	{
		// Cabal's layout (the downloaded haskell-project.cabal builds it as
		// it is): the program's modules at the root, an hspec suite in
		// tests/Spec.hs. GHC 9.14 checks and runs it in the browser
		// (packs/haskell/README.md).
		id: 'haskell',
		label: 'Haskell',
		monacoLanguages: ['haskell'],
		settings: {},
		entry: 'Main.hs',
		extension: '.hs',
		runs: true,
		tests: true,
		warmRunner: true,
		sample: {
			'Main.hs': `module Main (main) where

import Geometry

main :: IO ()
main = do
  let a = Point 0 0
      b = Point 3 4
  putStrLn (show a ++ " to " ++ show b ++ ": " ++ show (distance a b))
  print (norm b)
  mapM_ (print . area) [Circle 1, Square 2]
`,
			'Geometry.hs': `-- | Points and shapes in the plane.
module Geometry
  ( Point (..)
  , norm
  , distance
  , Shape (..)
  , area
  ) where

-- | A point in the plane.
data Point = Point {px :: Double, py :: Double}
  deriving (Eq)

instance Show Point where
  show (Point x y) = "(" ++ show x ++ ", " ++ show y ++ ")"

-- | Distance from the origin.
norm :: Point -> Double
norm (Point x y) = sqrt (x * x + y * y)

-- | Euclidean distance between two points.
distance :: Point -> Point -> Double
distance a b = norm (Point (px a - px b) (py a - py b))

-- | A shape, told apart by its constructor.
data Shape = Circle Double | Square Double
  deriving (Show)

-- | The area of a shape; the cases cover every constructor.
area :: Shape -> Double
area (Circle r) = pi * r * r
area (Square side) = side * side
`,
			'tests/Spec.hs': `module Main (main) where

import Geometry
import Test.Hspec

main :: IO ()
main = hspec $ do
  describe "norm" $
    it "is 5 at (3, 4)" $
      norm (Point 3 4) \`shouldBe\` 5

  describe "distance" $ do
    it "is symmetric" $ do
      let a = Point 1 2
          b = Point (-2) 6
      distance a b \`shouldBe\` distance b a

    it "is 0 from a point to itself" $
      distance (Point 7 (-3)) (Point 7 (-3)) \`shouldBe\` 0

  describe "area" $
    it "of a square of side 3 is 9" $
      area (Square 3) \`shouldBe\` 9
`,
		},
	},
	{
		// The go command's layout: a module (go.mod) whose packages are its
		// directories, tests beside the code they test. go.env holds the
		// target, which the pack's runner reads and the go command does not
		// (packs/go/README.md): WebAssembly in the browser by default, or
		// Linux on one of three architectures under QEMU.
		id: 'go',
		label: 'Go',
		monacoLanguages: ['go'],
		settings: {},
		entry: 'main.go',
		extension: '.go',
		runs: true,
		tests: true,
		sample: {
			'go.mod': `module example.com/geometry

go 1.27
`,
			'go.env': `# The target Run and Test build for. With nothing set it is WebAssembly
# (GOOS=wasip1, GOARCH=wasm), run in the browser. A Linux target runs
# under QEMU: uncomment both lines, with GOARCH one of amd64, arm64 or
# riscv64.
# GOOS=linux
# GOARCH=arm64
`,
			'main.go': `// Command geometry prints the distance between two points.
package main

import (
	"fmt"

	"example.com/geometry/point"
)

func main() {
	a := point.Point{X: 0, Y: 0}
	b := point.Point{X: 3, Y: 4}
	fmt.Printf("%v to %v: %v\\n", a, b, point.Distance(a, b))
	fmt.Println(b.Norm())
}
`,
			'point/point.go': `// Package point is about points in the plane.
package point

import (
	"fmt"
	"math"
)

// Point is a point in the plane.
type Point struct {
	X, Y float64
}

// Norm is the distance from the origin.
func (p Point) Norm() float64 {
	return math.Hypot(p.X, p.Y)
}

// String writes p as (x, y).
func (p Point) String() string {
	return fmt.Sprintf("(%g, %g)", p.X, p.Y)
}

// Distance is the Euclidean distance between a and b.
func Distance(a, b Point) float64 {
	return Point{a.X - b.X, a.Y - b.Y}.Norm()
}
`,
			'point/point_test.go': `package point

import (
	"fmt"
	"testing"
	"testing/quick"
)

func TestNorm(t *testing.T) {
	tests := []struct {
		p    Point
		want float64
	}{
		{Point{0, 0}, 0},
		{Point{3, 4}, 5},
		{Point{-3, 4}, 5},
	}
	for _, tt := range tests {
		if got := tt.p.Norm(); got != tt.want {
			t.Errorf("%v.Norm() = %v, want %v", tt.p, got, tt.want)
		}
	}
}

// A property: quick.Check tries it on 100 random pairs of points.
func TestDistanceIsSymmetric(t *testing.T) {
	symmetric := func(a, b Point) bool { return Distance(a, b) == Distance(b, a) }
	if err := quick.Check(symmetric, nil); err != nil {
		t.Error(err)
	}
}

func ExampleDistance() {
	fmt.Println(Distance(Point{0, 0}, Point{3, 4}))
	// Output: 5
}
`,
		},
	},
	{
		// zig init's layout without build.zig: main.zig is the root, and
		// `zig test main.zig` runs the tests of every file it uses. zig.env
		// holds the target and the optimize mode, which the pack's runner
		// reads and Download's build.zig takes as its defaults
		// (packs/zig/README.md).
		id: 'zig',
		label: 'Zig',
		monacoLanguages: ['zig'],
		settings: {},
		entry: 'main.zig',
		extension: '.zig',
		runs: true,
		tests: true,
		sample: {
			'zig.env': `# The target Run and Test build for. With nothing set it is WebAssembly
# (wasm32-wasi), run in the browser; TARGET=x86_64-linux builds an x86-64
# Linux program and runs it under QEMU. OPTIMIZE is Debug (the default),
# ReleaseSafe, ReleaseFast or ReleaseSmall.
# TARGET=x86_64-linux
# OPTIMIZE=ReleaseSafe
`,
			'main.zig': `const std = @import("std");
const geometry = @import("geometry.zig");

pub fn main(init: std.process.Init) !void {
    var buffer: [1024]u8 = undefined;
    var stdout_writer: std.Io.File.Writer = .init(.stdout(), init.io, &buffer);
    const out = &stdout_writer.interface;

    const a: geometry.Point = .{ .x = 0, .y = 0 };
    const b: geometry.Point = .{ .x = 3, .y = 4 };
    try out.print("{f} to {f}: {d}\\n", .{ a, b, geometry.distance(a, b) });
    try out.print("{d}\\n", .{b.norm()});
    try out.flush();
}

test {
    // \`zig test main.zig\` runs the tests of the files main.zig uses.
    _ = geometry;
}
`,
			'geometry.zig': `//! Points in the plane.
const std = @import("std");

/// A point in the plane.
pub const Point = struct {
    x: f64,
    y: f64,

    /// Distance from the origin.
    pub fn norm(self: Point) f64 {
        return std.math.hypot(self.x, self.y);
    }

    /// Writes the point as (x, y), for \`{f}\` in a format string.
    pub fn format(self: Point, writer: *std.Io.Writer) std.Io.Writer.Error!void {
        try writer.print("({d}, {d})", .{ self.x, self.y });
    }
};

/// Euclidean distance between two points.
pub fn distance(a: Point, b: Point) f64 {
    const d: Point = .{ .x = a.x - b.x, .y = a.y - b.y };
    return d.norm();
}

test "the norm of (3, 4) is 5" {
    const p: Point = .{ .x = 3, .y = 4 };
    try std.testing.expectEqual(5.0, p.norm());
}

test "distance is symmetric, for 100 random pairs of points" {
    var prng: std.Random.DefaultPrng = .init(42);
    const random = prng.random();
    for (0..100) |_| {
        const a: Point = .{ .x = random.float(f64) * 200 - 100, .y = random.float(f64) * 200 - 100 };
        const b: Point = .{ .x = random.float(f64) * 200 - 100, .y = random.float(f64) * 200 - 100 };
        try std.testing.expectEqual(distance(a, b), distance(b, a));
    }
}
`,
		},
	},
];

/** The language with this id; the ids are a closed set, so it always exists. */
export function languageOf(id: LanguageId): Language {
	const language = LANGUAGES.find((l) => l.id === id);
	if (!language) throw new Error(`unknown language ${id}`);
	return language;
}

/** Narrows a stored or typed string to a language id. */
export function isLanguageId(value: unknown): value is LanguageId {
	return LANGUAGES.some((l) => l.id === value);
}

/**
 * The languages as the picker lists them: one plain list, by name. It once
 * had sections (Scripting, Web, Compiled, JVM, Functional), which Ambrus
 * asked to remove; a name is found by its first letter. A function, so
 * importing this module sorts nothing (editor-start.test.mjs).
 */
export function pickerLanguages(): Language[] {
	return [...LANGUAGES].sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}
